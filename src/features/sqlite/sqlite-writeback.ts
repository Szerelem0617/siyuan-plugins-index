import { post } from "../../shared/api-client/request";
import {
    getSqliteEngine, saveDatabaseToDisk, getAVSchema, recordChange,
    type AVColumnSchema
} from "./sqlite-manager";

// ═══════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════

export interface CellChange {
    rowId: string;
    itemId: string;
    colName: string;
    keyId: string;
    keyType: string;
    oldValue: any;
    newValue: any;
}

export interface MutationResult {
    success: boolean;
    changedCells: number;
    changedRows: number;
    errors: string[];
}

export interface ChangelogEntry {
    id: number;
    avId: string;
    rowId: string;
    colName: string;
    keyId: string;
    oldValue: string | null;
    newValue: string | null;
    timestamp: string;
    synced: number;
}

// SiYuan block ID format: YYYYMMDDHHmmss-xxxxxxx (14 digits, dash, 7 alphanumeric)
const SIYUAN_BLOCK_ID_RE = /^\d{14}-[a-z0-9]{7}$/;

// ═══════════════════════════════════════════
//  Core: Run Mutation (UPDATE with write-back)
// ═══════════════════════════════════════════

/**
 * Execute a SQL UPDATE statement with validation and automatic write-back to SiYuan AV.
 *
 * Flow:
 *   1. Detect target AV table from SQL
 *   2. Snapshot all rows BEFORE mutation
 *   3. Execute UPDATE inside a SAVEPOINT
 *   4. Diff to find changed cells
 *   5. Validate each change against schema
 *   6. If invalid → ROLLBACK SAVEPOINT, return errors
 *   7. If valid → record changelog, push to AV API, RELEASE SAVEPOINT
 */
export async function runMutation(sql: string): Promise<MutationResult> {
    const { db } = await getSqliteEngine();

    // 1. Detect SQL type — only UPDATE is supported
    const sqlType = sql.trim().split(/\s+/)[0].toUpperCase();
    if (sqlType !== "UPDATE") {
        return {
            success: false, changedCells: 0, changedRows: 0,
            errors: [`仅支持 UPDATE 语句的写回操作。当前: ${sqlType}。DELETE/INSERT 暂不支持。`]
        };
    }

    // 2. Detect target AV table
    const avId = _detectTargetAV(sql, db);
    if (!avId) {
        return {
            success: false, changedCells: 0, changedRows: 0,
            errors: ["无法识别目标 AV 表。请确保 UPDATE 语句中的表名是已同步的 AV ID。"]
        };
    }

    // 3. Get schema
    const schema = await getAVSchema(avId);
    if (schema.length === 0) {
        return {
            success: false, changedCells: 0, changedRows: 0,
            errors: [`AV ${avId} 没有 Schema 元数据。请先重新同步该 AV。`]
        };
    }

    // 4. Snapshot rows BEFORE mutation
    const before = _snapshotRows(db, avId);

    // 5. Execute inside SAVEPOINT (allows rollback on validation failure)
    db.run("SAVEPOINT av_mutation;");
    try {
        db.run(sql);
    } catch (e: any) {
        db.run("ROLLBACK TO av_mutation;");
        db.run("RELEASE av_mutation;");
        return {
            success: false, changedCells: 0, changedRows: 0,
            errors: [`SQL 执行错误: ${e.message}`]
        };
    }

    // 6. Snapshot AFTER mutation
    const after = _snapshotRows(db, avId);

    // 7. Diff
    const changes = _diffRows(before, after, schema);

    if (changes.length === 0) {
        db.run("RELEASE av_mutation;");
        return { success: true, changedCells: 0, changedRows: 0, errors: [] };
    }

    // 8. Validate ALL changes
    const errors: string[] = [];
    for (const change of changes) {
        const colSchema = schema.find(s => s.colName === change.colName);
        if (!colSchema) {
            errors.push(`列 "${change.colName}" 不在 Schema 中`);
            continue;
        }
        if (!colSchema.writable) {
            errors.push(`列 "${change.colName}" (${colSchema.keyType}) 为只读，不可修改`);
            continue;
        }
        const valErr = _validateCellValue(change.newValue, colSchema);
        if (valErr) {
            errors.push(`行 ${change.rowId.slice(0, 8)}..., 列 "${change.colName}": ${valErr}`);
        }
    }

    if (errors.length > 0) {
        // Validation failed → rollback SQLite changes
        db.run("ROLLBACK TO av_mutation;");
        db.run("RELEASE av_mutation;");
        return { success: false, changedCells: 0, changedRows: 0, errors };
    }

    // 9. Record changelog (before write-back, so we can rollback if AV push fails)
    for (const change of changes) {
        await recordChange(
            avId, change.rowId, change.colName,
            change.keyId, change.oldValue, change.newValue
        );
    }

    // 10. Write back to AV
    try {
        await _pushToAV(avId, changes, schema);
    } catch (e: any) {
        // AV push failed — SQLite is already updated, changelog records the intent
        // We DON'T rollback SQLite here: the user can retry push or rollback manually
        db.run("RELEASE av_mutation;");
        await saveDatabaseToDisk();
        return {
            success: false,
            changedCells: changes.length,
            changedRows: new Set(changes.map(c => c.rowId)).size,
            errors: [`AV 写回失败: ${e.message}。本地已修改但未同步到思源。可尝试回滚。`]
        };
    }

    // 11. Mark changelog entries as synced
    try {
        db.run(
            `UPDATE _changelog SET synced = 1 WHERE av_id = ? AND synced = 0`,
            [avId]
        );
    } catch (e) {
        // Non-critical
    }

    // 12. Commit
    db.run("RELEASE av_mutation;");
    await saveDatabaseToDisk();

    return {
        success: true,
        changedCells: changes.length,
        changedRows: new Set(changes.map(c => c.rowId)).size,
        errors: []
    };
}

// ═══════════════════════════════════════════
//  AV Table Detection
// ═══════════════════════════════════════════

function _detectTargetAV(sql: string, db: any): string | null {
    // Parse table name from UPDATE "tableName" SET ...
    // Handles both quoted and unquoted table names
    const patterns = [
        /UPDATE\s+"([^"]+)"/i,
        /UPDATE\s+`([^`]+)`/i,
        /UPDATE\s+(\S+)\s+SET/i
    ];

    for (const pattern of patterns) {
        const match = sql.match(pattern);
        if (match && match[1]) {
            const tableName = match[1];
            // Verify this table exists in _meta as an AV
            try {
                const res = db.exec(`SELECT id FROM _meta WHERE id = ? AND type = 'av'`, [tableName]);
                if (res.length > 0 && res[0].values.length > 0) {
                    return tableName;
                }
            } catch (e) { /* continue trying */ }
        }
    }
    return null;
}

// ═══════════════════════════════════════════
//  Row Snapshot & Diff
// ═══════════════════════════════════════════

type RowMap = Map<string, Record<string, any>>;

function _snapshotRows(db: any, avId: string): RowMap {
    const map: RowMap = new Map();
    try {
        const res = db.exec(`SELECT * FROM "${avId}"`);
        if (res.length === 0) return map;
        const cols = res[0].columns;
        res[0].values.forEach((row: any[]) => {
            const obj: Record<string, any> = {};
            cols.forEach((col: string, i: number) => {
                obj[col] = row[i];
            });
            const rowId = obj["rowID"];
            if (rowId) map.set(rowId, obj);
        });
    } catch (e) { /* empty table */ }
    return map;
}

function _diffRows(before: RowMap, after: RowMap, schema: AVColumnSchema[]): CellChange[] {
    const changes: CellChange[] = [];
    const schemaMap = new Map<string, AVColumnSchema>();
    schema.forEach(s => schemaMap.set(s.colName, s));

    for (const [rowId, afterRow] of after.entries()) {
        const beforeRow = before.get(rowId);
        if (!beforeRow) continue; // INSERT case — skip for now

        const itemId = afterRow["_itemID"] || rowId;

        for (const [colName, newVal] of Object.entries(afterRow)) {
            if (colName === "rowID" || colName === "_itemID") continue;

            const oldVal = beforeRow[colName];
            // Compare with loose equality to handle number/string coercion
            if (_valuesEqual(oldVal, newVal)) continue;

            const colSchema = schemaMap.get(colName);
            if (!colSchema) continue;

            changes.push({
                rowId,
                itemId,
                colName,
                keyId: colSchema.keyId,
                keyType: colSchema.keyType,
                oldValue: oldVal,
                newValue: newVal
            });
        }
    }

    return changes;
}

function _valuesEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    // Handle number/string comparison (e.g., 42 vs "42")
    if (typeof a === "number" && typeof b === "string") return a === Number(b);
    if (typeof a === "string" && typeof b === "number") return Number(a) === b;
    return String(a) === String(b);
}

// ═══════════════════════════════════════════
//  Cell Validation
// ═══════════════════════════════════════════

function _validateCellValue(value: any, schema: AVColumnSchema): string | null {
    // NULL is always valid (clears the cell)
    if (value === null || value === undefined) return null;

    switch (schema.keyType) {
        case "text":
        case "url":
        case "email":
        case "phone":
            // Any string is valid
            return null;

        case "number": {
            const num = Number(value);
            if (isNaN(num)) return `值 "${value}" 不是合法数字`;
            return null;
        }

        case "checkbox": {
            const v = Number(value);
            if (v !== 0 && v !== 1) return `Checkbox 值必须为 0 或 1，当前: "${value}"`;
            return null;
        }

        case "date": {
            const ts = Number(value);
            if (isNaN(ts)) return `日期必须为时间戳 (Unix ms)，当前: "${value}"`;
            return null;
        }

        case "select": {
            // Single select — value should be a plain string
            // SiYuan auto-creates options, so we just validate it's non-empty
            if (typeof value !== "string" && typeof value !== "number") {
                return `Select 值必须为字符串`;
            }
            return null;
        }

        case "mSelect": {
            // Multi-select — value should be a JSON array of strings
            if (typeof value === "string") {
                try {
                    const parsed = JSON.parse(value);
                    if (!Array.isArray(parsed)) return `mSelect 值必须为 JSON 数组，例如: ["选项A","选项B"]`;
                    for (const item of parsed) {
                        if (typeof item !== "string") return `mSelect 数组中的每一项必须为字符串`;
                    }
                } catch (e) {
                    return `mSelect 值必须为合法 JSON 数组，例如: ["选项A","选项B"]`;
                }
            }
            return null;
        }

        case "relation": {
            // Relation — value should be a JSON array of SiYuan block IDs, or a single ID
            const str = String(value).trim();

            // Single ID
            if (SIYUAN_BLOCK_ID_RE.test(str)) return null;

            // JSON array of IDs
            try {
                const parsed = JSON.parse(str);
                if (!Array.isArray(parsed)) return `Relation 值必须为块 ID 或 JSON 数组，例如: ["20240101120000-abc1234"]`;
                for (const id of parsed) {
                    if (typeof id !== "string" || !SIYUAN_BLOCK_ID_RE.test(id)) {
                        return `Relation 中的 ID "${id}" 不是合法的思源块 ID 格式 (YYYYMMDDHHmmss-xxxxxxx)`;
                    }
                }
            } catch (e) {
                return `Relation 值必须为合法的块 ID 或 JSON 数组。当前格式不合法。`;
            }
            return null;
        }

        case "mAsset": {
            // Asset — value should be a JSON array
            if (typeof value === "string") {
                try {
                    const parsed = JSON.parse(value);
                    if (!Array.isArray(parsed)) return `mAsset 值必须为 JSON 数组`;
                } catch (e) {
                    return `mAsset 值必须为合法 JSON 数组`;
                }
            }
            return null;
        }

        default:
            return null;
    }
}

// ═══════════════════════════════════════════
//  Value Conversion: SQLite → AV API Format
// ═══════════════════════════════════════════

function _toAVValue(value: any, schema: AVColumnSchema): any {
    // NULL → empty value for the type
    if (value === null || value === undefined) {
        return _emptyAVValue(schema.keyType);
    }

    switch (schema.keyType) {
        case "text":
            return { type: "text", text: { content: String(value) } };

        case "number":
            return { type: "number", number: { content: Number(value), isNotEmpty: true } };

        case "select": {
            const color = _resolveSelectColor(String(value), schema);
            return { type: "mSelect", mSelect: [{ content: String(value), color }] };
        }

        case "mSelect": {
            const items = _parseJsonOrSingle(value);
            return {
                type: "mSelect",
                mSelect: items.map(item => ({
                    content: String(item),
                    color: _resolveSelectColor(String(item), schema)
                }))
            };
        }

        case "date":
            return { type: "date", date: { content: Number(value), isNotEmpty: true } };

        case "checkbox":
            return { type: "checkbox", checkbox: { checked: value === 1 || value === "1" || value === true } };

        case "url":
            return { type: "url", url: { content: String(value) } };

        case "email":
            return { type: "email", email: { content: String(value) } };

        case "phone":
            return { type: "phone", phone: { content: String(value) } };

        case "relation": {
            const ids = _parseBlockIds(value);
            return { type: "relation", relation: { blockIDs: ids, contents: null } };
        }

        case "mAsset": {
            let assets: any[];
            try {
                assets = typeof value === "string" ? JSON.parse(value) : value;
            } catch {
                assets = [{ content: String(value), name: String(value).split("/").pop() }];
            }
            return { type: "mAsset", mAsset: assets };
        }

        default:
            return { type: "text", text: { content: String(value) } };
    }
}

function _emptyAVValue(keyType: string): any {
    switch (keyType) {
        case "text": return { type: "text", text: { content: "" } };
        case "number": return { type: "number", number: { content: 0, isNotEmpty: false } };
        case "select":
        case "mSelect": return { type: "mSelect", mSelect: [] };
        case "date": return { type: "date", date: { content: 0, isNotEmpty: false } };
        case "checkbox": return { type: "checkbox", checkbox: { checked: false } };
        case "url": return { type: "url", url: { content: "" } };
        case "email": return { type: "email", email: { content: "" } };
        case "phone": return { type: "phone", phone: { content: "" } };
        case "relation": return { type: "relation", relation: { blockIDs: [], contents: null } };
        case "mAsset": return { type: "mAsset", mAsset: [] };
        default: return { type: "text", text: { content: "" } };
    }
}

function _resolveSelectColor(content: string, schema: AVColumnSchema): string {
    if (!schema.options) return "1";
    try {
        const options: Array<{ name: string; color: string }> = JSON.parse(schema.options);
        const match = options.find(o => o.name === content);
        return match?.color || "1";
    } catch {
        return "1";
    }
}

function _parseJsonOrSingle(value: any): string[] {
    if (value === null || value === undefined) return [];
    const str = String(value).trim();
    if (!str) return [];
    try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed.map(String);
        return [String(parsed)];
    } catch {
        return [str];
    }
}

function _parseBlockIds(value: any): string[] {
    if (value === null || value === undefined) return [];
    const str = String(value).trim();
    if (!str) return [];

    // Single block ID
    if (SIYUAN_BLOCK_ID_RE.test(str)) return [str];

    // JSON array
    try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed.filter((id: string) => typeof id === "string");
        return [String(parsed)];
    } catch {
        return [str];
    }
}

// ═══════════════════════════════════════════
//  AV API Push
// ═══════════════════════════════════════════

async function _pushToAV(avId: string, changes: CellChange[], schema: AVColumnSchema[]): Promise<void> {
    const schemaMap = new Map<string, AVColumnSchema>();
    schema.forEach(s => schemaMap.set(s.colName, s));

    const values = changes.map(change => {
        const colSchema = schemaMap.get(change.colName)!;
        return {
            keyID: change.keyId,
            itemID: change.itemId,
            value: _toAVValue(change.newValue, colSchema)
        };
    });

    console.log(`[WriteBack] Pushing ${values.length} cell changes to AV ${avId}...`);

    // Batch in chunks of 50 (matching existing pattern in create-db.ts)
    const chunkSize = 50;
    for (let i = 0; i < values.length; i += chunkSize) {
        const chunk = values.slice(i, i + chunkSize);
        await post("/api/av/batchSetAttributeViewBlockAttrs", {
            avID: avId,
            values: chunk
        });
        console.log(`[WriteBack] Chunk ${Math.floor(i / chunkSize) + 1} pushed (${chunk.length} values)`);
    }

    console.log(`[WriteBack] Successfully pushed all changes to AV ${avId}`);
}

// ═══════════════════════════════════════════
//  Rollback
// ═══════════════════════════════════════════

/**
 * Rollback recent changes for an AV by replaying old values.
 * Rolls back BOTH the local SQLite table and writes old values back to AV.
 *
 * @param avId - The AV to rollback
 * @param count - Number of most recent change groups to rollback (default: all unsynced)
 */
export async function rollbackChanges(avId: string, count?: number): Promise<MutationResult> {
    const { db } = await getSqliteEngine();
    const schema = await getAVSchema(avId);
    const schemaMap = new Map<string, AVColumnSchema>();
    schema.forEach(s => schemaMap.set(s.colName, s));

    // Get changelog entries to rollback (most recent first)
    let query = `SELECT id, row_id, col_name, key_id, old_value, new_value, timestamp
                 FROM _changelog WHERE av_id = ? ORDER BY id DESC`;
    const params: any[] = [avId];
    if (count) {
        query += ` LIMIT ?`;
        params.push(count);
    }

    let entries: Array<{ id: number; rowId: string; colName: string; keyId: string; oldValue: any; newValue: any }> = [];
    try {
        const res = db.exec(query, params);
        if (res.length === 0) {
            return { success: true, changedCells: 0, changedRows: 0, errors: ["无可回滚的变更记录"] };
        }
        entries = res[0].values.map((row: any) => ({
            id: row[0], rowId: row[1], colName: row[2], keyId: row[3],
            oldValue: row[4], newValue: row[5]
        }));
    } catch (e) {
        return { success: false, changedCells: 0, changedRows: 0, errors: ["读取变更日志失败"] };
    }

    if (entries.length === 0) {
        return { success: true, changedCells: 0, changedRows: 0, errors: ["无可回滚的变更记录"] };
    }

    // 1. Rollback SQLite table
    for (const entry of entries) {
        try {
            db.run(
                `UPDATE "${avId}" SET "${entry.colName}" = ? WHERE rowID = ?`,
                [entry.oldValue, entry.rowId]
            );
        } catch (e: any) {
            console.error(`[Rollback] SQLite rollback failed for row ${entry.rowId}:`, e);
        }
    }

    // 2. Rollback AV via API
    const avValues: any[] = [];
    for (const entry of entries) {
        const colSchema = schemaMap.get(entry.colName);
        if (!colSchema) continue;

        // Look up _itemID from the table
        let itemId = entry.rowId;
        try {
            const idRes = db.exec(`SELECT "_itemID" FROM "${avId}" WHERE rowID = ?`, [entry.rowId]);
            if (idRes.length > 0 && idRes[0].values.length > 0) {
                itemId = idRes[0].values[0][0] || entry.rowId;
            }
        } catch (e) { /* use rowId as fallback */ }

        avValues.push({
            keyID: entry.keyId,
            itemID: itemId,
            value: _toAVValue(entry.oldValue, colSchema)
        });
    }

    try {
        const chunkSize = 50;
        for (let i = 0; i < avValues.length; i += chunkSize) {
            const chunk = avValues.slice(i, i + chunkSize);
            await post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID: avId,
                values: chunk
            });
        }
    } catch (e: any) {
        return {
            success: false,
            changedCells: entries.length,
            changedRows: new Set(entries.map(e => e.rowId)).size,
            errors: [`AV 回滚写入失败: ${e.message}。本地 SQLite 已回滚。`]
        };
    }

    // 3. Remove rolled-back changelog entries
    const ids = entries.map(e => e.id);
    try {
        db.run(`DELETE FROM _changelog WHERE id IN (${ids.join(",")})`);
    } catch (e) { /* non-critical */ }

    await saveDatabaseToDisk();

    return {
        success: true,
        changedCells: entries.length,
        changedRows: new Set(entries.map(e => e.rowId)).size,
        errors: []
    };
}

// ═══════════════════════════════════════════
//  Changelog Queries
// ═══════════════════════════════════════════

/**
 * Get recent changelog entries, optionally filtered by AV ID
 */
export async function getChangelog(avId?: string, limit: number = 50): Promise<ChangelogEntry[]> {
    const { db } = await getSqliteEngine();
    try {
        let query = `SELECT id, av_id, row_id, col_name, key_id, old_value, new_value, timestamp, synced FROM _changelog`;
        const params: any[] = [];
        if (avId) {
            query += ` WHERE av_id = ?`;
            params.push(avId);
        }
        query += ` ORDER BY id DESC LIMIT ?`;
        params.push(limit);

        const res = db.exec(query, params);
        if (res.length === 0) return [];
        return res[0].values.map((row: any) => ({
            id: row[0], avId: row[1], rowId: row[2], colName: row[3],
            keyId: row[4], oldValue: row[5], newValue: row[6],
            timestamp: row[7], synced: row[8]
        }));
    } catch { return []; }
}

/**
 * Clear all changelog entries for an AV
 */
export async function clearChangelog(avId?: string): Promise<void> {
    const { db } = await getSqliteEngine();
    if (avId) {
        db.run(`DELETE FROM _changelog WHERE av_id = ?`, [avId]);
    } else {
        db.run(`DELETE FROM _changelog`);
    }
    await saveDatabaseToDisk();
}
