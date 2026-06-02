import { post } from "../../shared/api-client/request";
import { plugin } from "../../shared/utils";

let dbInstance: any = null;
let SQL_ENGINE: any = null;
const STORAGE_DB_PATH = "/data/storage/petal/siyuan-plugins-index/index-os.sqlite";
export let instantiatedAvIdsCache: Set<string> = new Set();

// ─── On-Demand Table TTL Cache ───
export const tableSyncTimes = new Map<string, number>();
const TTL_MS = 3000; // 3 seconds TTL

// ─── Friendly Table Name Map ───
const friendlyTableNameMap = new Map<string, string>();

export function registerFriendlyTableName(friendlyName: string, avId: string) {
    const cleanName = friendlyName.replace(/["'\`]/g, "").trim();
    friendlyTableNameMap.set(cleanName, avId);
    friendlyTableNameMap.set(cleanName.replace(/\s+/g, "_"), avId);
    friendlyTableNameMap.set(cleanName.replace(/[^a-zA-Z0-9]/g, "_"), avId);
    console.log(`[SQLiteManager] Registered friendly table name mapping: "${cleanName}" -> "${avId}"`);
}

export function resolveTableAvId(tableName: string): string | null {
    const cleanName = tableName.replace(/["'\`]/g, "").trim();
    if (friendlyTableNameMap.has(cleanName)) {
        return friendlyTableNameMap.get(cleanName)!;
    }
    if (cleanName.startsWith("av_")) {
        return tableNameToAvId(cleanName);
    }
    return null;
}

// ─── AV Type → SQLite Type Mapping ───
const AV_TYPE_TO_SQLITE: Record<string, string> = {
    text: "TEXT",
    number: "REAL",
    select: "TEXT",
    mSelect: "TEXT",   // JSON array
    date: "INTEGER",   // Unix ms timestamp
    checkbox: "INTEGER",
    url: "TEXT",
    email: "TEXT",
    phone: "TEXT",
    relation: "TEXT",  // JSON array of block IDs
    rollup: "TEXT",    // Computed, read-only
    block: "TEXT",     // Primary key binding
    mAsset: "TEXT",    // JSON array
    template: "TEXT",  // Computed, read-only
    created: "INTEGER",
    updated: "INTEGER",
};

// Columns that are NEVER writable back to AV
const READONLY_TYPES = new Set(["rollup", "block", "template", "created", "updated"]);

// ─── Schema Types ───
export interface AVColumnSchema {
    avId: string;
    colName: string;   // Safe SQLite column name
    keyId: string;     // AV original key ID
    keyName: string;   // AV original column name
    keyType: string;   // AV column type
    writable: boolean;
    options: string | null; // JSON for select options
}

export interface SyncResult {
    success: boolean;
    rowCount?: number;
    message?: string;
    unchanged?: boolean;
}

export interface SavedQuery {
    id: string;
    name: string;
    sql: string;
    created: string;
}

// ═══════════════════════════════════════════
//  Engine Initialization
// ═══════════════════════════════════════════

export async function getSqliteEngine() {
    if (dbInstance) return { db: dbInstance, SQL: SQL_ENGINE };

    try {
        if (!(window as any).initSqlJs) {
            const pluginId = plugin?.id || "siyuan-plugins-index";
            const scriptUrl = `/plugins/${pluginId}/sql-wasm.js`;

            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = scriptUrl;
                script.onload = resolve;
                script.onerror = () => reject(new Error(`Failed to load ${scriptUrl}`));
                document.head.appendChild(script);
            });
        }

        const initSqlJs = (window as any).initSqlJs;
        SQL_ENGINE = await initSqlJs({
            locateFile: (file: string) => `/plugins/${plugin?.id || "siyuan-plugins-index"}/${file}`
        });

        dbInstance = new SQL_ENGINE.Database();
        console.log("[SQLiteManager] In-memory DB Initialized.");

        // Initialize system tables
        _initSystemTables(dbInstance);

        // Clear cache since we started clean in memory
        instantiatedAvIdsCache = new Set();
        
        return { db: dbInstance, SQL: SQL_ENGINE };
    } catch (e) {
        throw e;
    }
}

/**
 * Convert Attribute View ID to a valid SQL table name (unquoted).
 * e.g., "20251021232406-u4zvv9w" -> "av_20251021232406_u4zvv9w"
 */
export function avIdToTableName(avId: string): string {
    return `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * Convert SQL table name back to the Attribute View ID.
 * e.g., "av_20251021232406_u4zvv9w" -> "20251021232406-u4zvv9w"
 */
export function tableNameToAvId(tableName: string): string {
    if (tableName.startsWith("av_")) {
        const raw = tableName.slice(3);
        if (raw.length > 14 && raw[14] === "_") {
            return raw.slice(0, 14) + "-" + raw.slice(15);
        }
        return raw.replace("_", "-");
    }
    return tableName;
}

function _initSystemTables(db: any) {
    // Core metadata (upgraded from original)
    db.run(`CREATE TABLE IF NOT EXISTS _meta (
        id TEXT PRIMARY KEY,
        type TEXT,
        updated TEXT,
        data_hash TEXT,
        row_count INTEGER DEFAULT 0,
        col_count INTEGER DEFAULT 0
    );`);

    // Schema migration check for _meta table
    try {
        const res = db.exec("PRAGMA table_info(_meta)");
        if (res.length > 0) {
            const columns = res[0].values.map((v: any) => v[1]);
            if (!columns.includes("data_hash")) {
                db.run("ALTER TABLE _meta ADD COLUMN data_hash TEXT;");
                console.log("[SQLiteManager] Upgraded _meta schema: added data_hash column");
            }
            if (!columns.includes("row_count")) {
                db.run("ALTER TABLE _meta ADD COLUMN row_count INTEGER DEFAULT 0;");
                console.log("[SQLiteManager] Upgraded _meta schema: added row_count column");
            }
            if (!columns.includes("col_count")) {
                db.run("ALTER TABLE _meta ADD COLUMN col_count INTEGER DEFAULT 0;");
                console.log("[SQLiteManager] Upgraded _meta schema: added col_count column");
            }
        }
    } catch (e) {
        console.warn("[SQLiteManager] Failed to check/migrate _meta columns:", e);
    }

    // Schema registry — stores AV column metadata
    db.run(`CREATE TABLE IF NOT EXISTS _av_schema (
        av_id TEXT NOT NULL,
        col_name TEXT NOT NULL,
        key_id TEXT NOT NULL,
        key_name TEXT NOT NULL,
        key_type TEXT NOT NULL,
        writable INTEGER DEFAULT 1,
        options TEXT,
        col_order INTEGER DEFAULT 0,
        PRIMARY KEY (av_id, col_name)
    );`);

    // Saved queries
    db.run(`CREATE TABLE IF NOT EXISTS _saved_queries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sql TEXT NOT NULL,
        created TEXT NOT NULL
    );`);
}

// ═══════════════════════════════════════════
//  Disk Persistence
// ═══════════════════════════════════════════

export async function saveDatabaseToDisk() {
    // No-op under on-demand in-memory architecture
}

// ═══════════════════════════════════════════
//  AV Instantiation (Phase 1 — Enhanced)
// ═══════════════════════════════════════════

/**
 * Compute a lightweight content hash for change detection.
 * Uses serialized cell value contents of all rows to detect modifications.
 */
function _computeDataHash(keyValues: any[]): string {
    let hash = 0;
    const dataToHash = keyValues.map(kv => ({
        id: kv.key.id,
        name: kv.key.name,
        type: kv.key.type,
        values: kv.values?.map((v: any) => {
            const cellVal = v.text?.content || 
                            v.number?.content || 
                            v.checkbox?.checked || 
                            v.date?.content || 
                            JSON.stringify(v.mSelect || v.mOption || v.mAsset || v.relation || []);
            return {
                blockID: v.blockID || "",
                content: cellVal
            };
        })
    }));
    const str = JSON.stringify(dataToHash);
    
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(36);
}

/**
 * Map AV type to the best SQLite column type
 */
function _getSqliteType(avType: string): string {
    return AV_TYPE_TO_SQLITE[avType] || "TEXT";
}

/**
 * Extract options list for select/mSelect type columns
 */
function _extractSelectOptions(kv: any): string | null {
    const options = kv.key.options;
    if (!options || !Array.isArray(options)) return null;
    return JSON.stringify(options.map((o: any) => ({
        name: o.name || o.content,
        color: o.color
    })));
}

export async function instantiateAV(avID: string, force: boolean = false): Promise<SyncResult> {
    const { db } = await getSqliteEngine();
    const res = await post("/api/av/getAttributeView", { id: avID });
    
    // Debug: Check if the response is actually valid
    if (!res || (res.code && res.code !== 0)) {
        console.error(`[SQLiteManager] API Error for ${avID}:`, res);
        return { success: false, message: `API Error: ${res?.msg || "Unknown"}` };
    }

    const av = res.av || res;
    const keyValues = av.keyValues || [];
    
    if (keyValues.length === 0) return { success: false, message: "Empty/No columns" };

    // ── Incremental Sync: Check if data has changed ──
    if (!force) {
        const newHash = _computeDataHash(keyValues);
        try {
            const hashRes = db.exec(`SELECT data_hash FROM _meta WHERE id = ?`, [avID]);
            if (hashRes.length > 0 && hashRes[0].values.length > 0) {
                const oldHash = hashRes[0].values[0][0];
                if (oldHash === newHash) {
                    return { success: true, rowCount: 0, unchanged: true };
                }
            }
        } catch (e) {
            // First sync or _meta schema outdated — proceed with full sync
        }
    }

    // 1. 映射列头 (增加去重逻辑)
    const usedNames = new Set(["rowID", "_itemID"]);
    const columns = keyValues.map((kv: any, idx: number) => {
        let baseName = kv.key.name.replace(/[\s\-\+\*\/\\\{\}\[\]\(\)\,\.\;\:\'\"\`\?\!\@\#\$\%\^\&\*\=\|]/g, '_') || "unnamed";
        let safeName = baseName;
        
        // If the name resolves to only underscores (e.g. "__") or is empty, or is duplicate, append key ID suffix
        if (usedNames.has(safeName) || safeName.replace(/_/g, '') === "") {
            safeName = `${baseName}_${kv.key.id.slice(-4)}`;
        }
        
        // 万一还是重名（极端情况），使用自增序号
        let counter = 1;
        while (usedNames.has(safeName)) {
            safeName = `${baseName}_${counter}`;
            counter++;
        }

        usedNames.add(safeName);
        return {
            id: kv.key.id,
            name: safeName,
            originalName: kv.key.name,
            type: kv.key.type,
            sqliteType: _getSqliteType(kv.key.type),
            writable: !READONLY_TYPES.has(kv.key.type),
            options: _extractSelectOptions(kv),
            order: idx
        };
    });

    // 2. 清理旧数据并重新建表（使用正确的类型映射）
    const tableName = avIdToTableName(avID);
    db.run(`DROP TABLE IF EXISTS ${tableName};`); 
    
    const colDefs = columns.map(c => `"${c.name}" ${c.sqliteType}`).join(", ");
    db.run(`CREATE TABLE ${tableName} (rowID TEXT PRIMARY KEY, "_itemID" TEXT, ${colDefs});`);

    // 2.5 写入 Schema 元数据
    db.run(`DELETE FROM _av_schema WHERE av_id = ?;`, [avID]);
    for (const col of columns) {
        db.run(
            `INSERT INTO _av_schema (av_id, col_name, key_id, key_name, key_type, writable, options, col_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [avID, col.name, col.id, col.originalName, col.type, col.writable ? 1 : 0, col.options, col.order]
        );
    }

    // 3. 行归类数据平铺
    const rowMap = new Map<string, any>();
    // 预先建立 ID 到 安全列名 的映射，防止在循环中重复计算
    const idToSafeName = new Map<string, string>();
    columns.forEach(c => idToSafeName.set(c.id, c.name));

    // First scan KeyTypeBlock column values to map row item IDs to actual Siyuan block IDs
    const itemIdToBlockId = new Map<string, string>();
    keyValues.forEach((kv: any) => {
        if (kv.key.type === "block") {
            kv.values?.forEach((v: any) => {
                const itemId = v.blockID || v.blockId || v.itemID || v.itemId || "";
                const boundBlockId = v.block?.id || "";
                if (itemId && boundBlockId) {
                    itemIdToBlockId.set(itemId, boundBlockId);
                }
            });
        }
    });

    keyValues.forEach((kv: any) => {
        const colSafeName = idToSafeName.get(kv.key.id);
        const colId = kv.key.id;
        
        if (!colSafeName) return;

        kv.values?.forEach((v: any) => {
            try {
                const itemId = v.blockID || v.blockId || v.itemID || v.itemId || "";
                if (!itemId) return;

                const rowId = itemIdToBlockId.get(itemId) || itemId;

                if (!rowMap.has(rowId)) rowMap.set(rowId, { rowID: rowId, _itemID: itemId });
                const item = rowMap.get(rowId);

                let val: any = null;
                // 增强型值提取逻辑，增加防护与 Debug
                if (v.block) {
                    val = v.block.content;
                } else if (v.text) {
                    val = v.text.content;
                } else if (v.number) {
                    val = v.number.isNotEmpty ? v.number.content : null;
                } else if (v.mSelect || v.mOption) {
                    const options = v.mSelect || v.mOption || [];
                    const contents = options.map((o: any) => o?.content).filter(Boolean);
                    val = contents.length > 0 ? JSON.stringify(contents) : null;
                } else if (v.url) {
                    val = v.url.content;
                } else if (v.email) {
                    val = v.email.content;
                } else if (v.phone) {
                    val = v.phone.content;
                } else if (v.checkbox) {
                    val = v.checkbox.checked ? 1 : 0;
                } else if (v.date) {
                    val = v.date.isNotEmpty ? v.date.content : null;
                } else if (v.relation) {
                    // --- Relation Debug Segment ---
                    const relContents = v.relation.contents || [];
                    let relIds = relContents.map((rc: any) => {
                        if (!rc) return null;
                        return rc.block?.id || rc.blockID || rc.content || (rc.Block ? rc.Block.ID : null);
                    }).filter(Boolean);
                    if (relIds.length === 0 && (v.relation.blockIDs || v.relation.blockIds)) {
                        relIds = (v.relation.blockIDs || v.relation.blockIds || []).filter(Boolean);
                    }
                    val = relIds.length > 0 ? JSON.stringify(relIds) : null;
                } else if (v.rollup) {
                    const rollupContents = v.rollup.contents || [];
                    const rollupVals = rollupContents.map((rc: any) => rc?.content || "").filter(Boolean);
                    val = rollupVals.length > 1 ? JSON.stringify(rollupVals) : (rollupVals[0] || null);
                } else if (v.mAsset) {
                    val = (v.mAsset && v.mAsset.length > 0) ? JSON.stringify(v.mAsset) : null;
                } else {
                    val = v.content || null;
                }

                item[colSafeName] = val;
            } catch (cellMetaError) {
                console.error(`[SQLite-Debug] Cell Process Error. Col: ${kv.key.name}(${colId}), Row: ${v.blockID}`, cellMetaError, v);
            }
        });
    });

    // 4. 批量执行插入
    const rows = Array.from(rowMap.values());
    
    db.run("BEGIN TRANSACTION;");
    for (const row of rows) {
        try {
            const fields = ["rowID", "_itemID", ...columns.map(c => c.name)];
            const placeholders = fields.map(() => "?").join(", ");
            const values = fields.map(f => {
                const v = row[f];
                return (v === undefined || v === null) ? null : v;
            });
            
            db.run(`INSERT INTO ${tableName} (${fields.map(f => `"${f}"`).join(", ")}) VALUES (${placeholders});`, values);
        } catch (rowInsertError) {
            console.error(`[SQLite-Debug] Row Insert Failed. Data:`, row, rowInsertError);
        }
    }
    db.run("COMMIT;");

    // 5. 更新 _meta（含 hash 和统计信息）
    const dataHash = _computeDataHash(keyValues);
    db.run(
        `INSERT OR REPLACE INTO _meta (id, type, updated, data_hash, row_count, col_count) VALUES (?, 'av', ?, ?, ?, ?);`,
        [avID, new Date().toISOString(), dataHash, rows.length, columns.length]
    );
    instantiatedAvIdsCache.add(avID);
    await saveDatabaseToDisk();

    return { success: true, rowCount: rows.length };
}

// ═══════════════════════════════════════════
//  Query Engine
// ═══════════════════════════════════════════

export function preprocessSql(sql: string): string {
    let processed = sql;
    
    // 1. Match Siyuan IDs (e.g. 20260527224659-golv5xy, with or without quotes)
    const rawIdRegex = /["'`]?(\d{14}-[a-zA-Z0-9]{7})["'`]?/g;
    processed = processed.replace(rawIdRegex, (match, id) => {
        return `"${avIdToTableName(id)}"`;
    });
    
    // 2. Match friendly names (e.g. Command-DB, "Command-DB")
    for (const [friendlyName, avId] of friendlyTableNameMap.entries()) {
        const escapedFriendly = friendlyName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const friendlyRegex = new RegExp(`["\`']?${escapedFriendly}["\`']?`, 'gi');
        processed = processed.replace(friendlyRegex, `"${avIdToTableName(avId)}"`);
    }
    
    return processed;
}

export async function runQuery(sql: string, params?: any[]): Promise<{ columns: string[], values: any[][] }> {
    const processedSql = preprocessSql(sql);

    // 0. Auto-redirect write SQLs
    const isWrite = /^\s*(update|insert|delete|create|alter|drop|replace)\b/i.test(processedSql);
    if (isWrite) {
        console.log(`[SQLiteManager] Redirecting write SQL to executeWritableSql: "${processedSql.slice(0, 50)}..."`);
        const writeRes = await executeWritableSql(processedSql);
        return {
            columns: ["success", "affectedRows", "message"],
            values: [[
                writeRes.success ? 1 : 0,
                writeRes.updatedRows || writeRes.deletedRowsCount || (writeRes.insertedId ? 1 : 0),
                writeRes.message || ""
            ]]
        };
    }

    // 1. Intercept read table queries to trigger on-demand instantiation
    const tableNameMatches = processedSql.match(/["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?/g) || [];
    for (const rawName of tableNameMatches) {
        const cleanName = rawName.replace(/["'\`]/g, "").trim();
        const avID = resolveTableAvId(cleanName);
        if (avID && avID.length >= 15) {
            const lastSync = tableSyncTimes.get(avID) || 0;
            if (Date.now() - lastSync > TTL_MS) {
                try {
                    console.log(`[SQLiteManager] On-demand instantiating AV: ${cleanName} (${avID})`);
                    await instantiateAV(avID, true);
                    tableSyncTimes.set(avID, Date.now());
                } catch (e) {
                    console.error(`[SQLiteManager] Failed to auto-instantiate table ${cleanName}:`, e);
                }
            }
        }
    }

    const { db } = await getSqliteEngine();
    const res = db.exec(processedSql, params);
    return res.length > 0 ? { columns: res[0].columns, values: res[0].values } : { columns: [], values: [] };
}

export async function executeWritableSql(sql: string): Promise<any> {
    const processedSql = preprocessSql(sql);
    const { db } = await getSqliteEngine();
    
    // ─── 1. UPDATE Statement ───
    const updateMatch = processedSql.match(/^\s*UPDATE\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s+SET\s+(.+?)\s+WHERE\s+(.+?)\s*$/is);
    if (updateMatch) {
        const tableName = updateMatch[1];
        const setClause = updateMatch[2];
        const whereClause = updateMatch[3];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        // Parse WHERE condition to get target row IDs
        const rowIDs: string[] = [];
        const singleIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s*=\s*['"`]([a-zA-Z0-9_\-]+)['"`]\s*$/i);
        const inIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s+IN\s*\((.+?)\)\s*$/i);
        
        if (singleIdMatch) {
            rowIDs.push(singleIdMatch[1]);
        } else if (inIdMatch) {
            const rawIds = inIdMatch[1].split(",");
            for (const rawId of rawIds) {
                rowIDs.push(rawId.trim().replace(/^['"`]|['"`]$/g, ""));
            }
        } else {
            // Complex/arbitrary WHERE condition: query in-memory table
            console.log(`[SQLiteManager] Complex WHERE clause detected: "${whereClause}". Running in-memory filter query...`);
            
            // 1. Ensure the memory table is instantiated and fully up-to-date with Siyuan.
            await instantiateAV(avID, true);
            
            // 2. Query matching rowIDs from memory DB
            const dbTable = avIdToTableName(avID);
            const cleanWhere = whereClause.trim().replace(/;+$/, "");
            const querySql = `SELECT rowID FROM "${dbTable}" WHERE ${cleanWhere};`;
            try {
                const res = db.exec(querySql);
                if (res.length > 0 && res[0].values.length > 0) {
                    for (const row of res[0].values) {
                        rowIDs.push(String(row[0]));
                    }
                }
            } catch (err: any) {
                throw new Error(`Failed to evaluate WHERE clause on in-memory table: ${err.message || err}`);
            }
        }
        
        const assignments = parseSetClause(setClause);
        let schema = await getAVSchema(avID);
        if (schema.length === 0) {
            await instantiateAV(avID, true);
            schema = await getAVSchema(avID);
        }
        
        // Clear TTL cache for this AV
        tableSyncTimes.delete(avID);
        
        const values: any[] = [];
        const dbTable = avIdToTableName(avID);
        for (const [colName, val] of Object.entries(assignments)) {
            const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
            if (!colSchema) throw new Error(`Column '${colName}' not found in table schema.`);
            
            for (const rowID of rowIDs) {
                let itemID = rowID;
                try {
                    const itemIDRes = db.exec(`SELECT "_itemID" FROM ${dbTable} WHERE rowID = ?`, [rowID]);
                    if (itemIDRes.length > 0 && itemIDRes[0].values.length > 0) {
                        itemID = String(itemIDRes[0].values[0][0]);
                    }
                } catch (e) {
                    // fallback to rowID
                }
                
                let cellValue: any = null;
                const kt = colSchema.keyType;
                if (kt === "checkbox") {
                    cellValue = { type: "checkbox", checkbox: { checked: Boolean(val) } };
                } else if (kt === "number") {
                    cellValue = { type: "number", number: { content: val === null ? "" : String(val), isNotEmpty: val !== null } };
                } else if (kt === "relation") {
                    let blockIDs: string[] = [];
                    if (typeof val === "string" && val.startsWith("[")) {
                        try { blockIDs = JSON.parse(val); } catch { blockIDs = [val]; }
                    } else if (Array.isArray(val)) {
                        blockIDs = val;
                    } else if (val) {
                        blockIDs = [val];
                    }
                    cellValue = { type: "relation", relation: { blockIDs } };
                } else if (kt === "select") {
                    cellValue = { type: "select", select: { content: val === null ? "" : String(val) } };
                } else if (kt === "mSelect") {
                    let contents: string[] = [];
                    if (typeof val === "string" && val.startsWith("[")) {
                        try { contents = JSON.parse(val); } catch { contents = [val]; }
                    } else if (Array.isArray(val)) {
                        contents = val;
                    } else if (val) {
                        contents = [val];
                    }
                    cellValue = { type: "mSelect", mSelect: contents.map(c => ({ content: c, color: "" })) };
                } else {
                    cellValue = { type: kt, [kt]: { content: val === null ? "" : String(val) } };
                }
                
                values.push({
                    keyID: colSchema.keyId,
                    itemID: itemID,
                    value: cellValue
                });
            }
        }
        
        if (values.length > 0) {
            console.log(`[SQLiteManager] Executing Siyuan batch UPDATE on AV ${avID} with ${values.length} cell updates.`);
            const res = await post("/api/av/batchSetAttributeViewBlockAttrs", { avID, values });
            return { success: true, updatedRows: rowIDs.length, message: `Successfully updated ${rowIDs.length} rows` };
        }
        return { success: true, updatedRows: 0, message: "No rows updated" };
    }
    
    // ─── 2. INSERT Statement ───
    const insertMatch = processedSql.match(/^\s*INSERT\s+INTO\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s*\((.+?)\)\s*VALUES\s*\((.+?)\)/is);
    if (insertMatch) {
        const tableName = insertMatch[1];
        const colsClause = insertMatch[2];
        const valsClause = insertMatch[3];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        const colNames = colsClause.split(",").map(c => c.trim().replace(/["'\`]/g, ""));
        const rawVals = parseValuesClause(valsClause);
        if (colNames.length !== rawVals.length) {
            throw new Error(`Column count (${colNames.length}) does not match value count (${rawVals.length}).`);
        }
        
        let schema = await getAVSchema(avID);
        if (schema.length === 0) {
            await instantiateAV(avID, true);
            schema = await getAVSchema(avID);
        }
        
        // Generate new Siyuan block ID
        // @ts-ignore
        const newRowID = window.Lute?.NewNodeID?.() || `row_${Date.now()}`;
        
        console.log(`[SQLiteManager] Inserting new detached row ${newRowID} to AV ${avID}`);
        await post("/api/av/addAttributeViewBlocks", {
            avID: avID,
            srcs: [{ itemID: newRowID, id: "", isDetached: true }]
        });
        
        // Clear TTL cache
        tableSyncTimes.delete(avID);
        
        const values: any[] = [];
        for (let idx = 0; idx < colNames.length; idx++) {
            const colName = colNames[idx];
            const val = rawVals[idx];
            const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
            if (!colSchema) continue;
            
            let cellValue: any = null;
            const kt = colSchema.keyType;
            if (kt === "checkbox") {
                cellValue = { type: "checkbox", checkbox: { checked: Boolean(val) } };
            } else if (kt === "number") {
                cellValue = { type: "number", number: { content: val === null ? "" : String(val), isNotEmpty: val !== null } };
            } else if (kt === "relation") {
                let blockIDs: string[] = [];
                if (typeof val === "string" && val.startsWith("[")) {
                    try { blockIDs = JSON.parse(val); } catch { blockIDs = [val]; }
                } else if (Array.isArray(val)) {
                    blockIDs = val;
                } else if (val) {
                    blockIDs = [val];
                }
                cellValue = { type: "relation", relation: { blockIDs } };
            } else if (kt === "select") {
                cellValue = { type: "select", select: { content: val === null ? "" : String(val) } };
            } else if (kt === "mSelect") {
                let contents: string[] = [];
                if (typeof val === "string" && val.startsWith("[")) {
                    try { contents = JSON.parse(val); } catch { contents = [val]; }
                } else if (Array.isArray(val)) {
                    contents = val;
                } else if (val) {
                    contents = [val];
                }
                cellValue = { type: "mSelect", mSelect: contents.map(c => ({ content: c, color: "" })) };
            } else {
                cellValue = { type: kt, [kt]: { content: val === null ? "" : String(val) } };
            }
            
            values.push({
                keyID: colSchema.keyId,
                itemID: newRowID,
                value: cellValue
            });
        }
        
        if (values.length > 0) {
            await post("/api/av/batchSetAttributeViewBlockAttrs", { avID, values });
        }
        return { success: true, insertedId: newRowID, message: newRowID };
    }
    
    // ─── 3. DELETE Statement ───
    const deleteMatch = processedSql.match(/^\s*DELETE\s+FROM\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s+WHERE\s+(.+?)\s*$/is);
    if (deleteMatch) {
        const tableName = deleteMatch[1];
        const whereClause = deleteMatch[2];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        const rowIDs: string[] = [];
        const singleIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s*=\s*['"`]([a-zA-Z0-9_\-]+)['"`]\s*$/i);
        const inIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s+IN\s*\((.+?)\)\s*$/i);
        
        if (singleIdMatch) {
            rowIDs.push(singleIdMatch[1]);
        } else if (inIdMatch) {
            const rawIds = inIdMatch[1].split(",");
            for (const rawId of rawIds) {
                rowIDs.push(rawId.trim().replace(/^['"`]|['"`]$/g, ""));
            }
        } else {
            // Complex/arbitrary WHERE condition: query in-memory table
            console.log(`[SQLiteManager] Complex WHERE clause detected for DELETE: "${whereClause}". Running in-memory filter query...`);
            
            // 1. Ensure the memory table is instantiated and fully up-to-date with Siyuan.
            await instantiateAV(avID, true);
            
            // 2. Query matching rowIDs from memory DB
            const dbTable = avIdToTableName(avID);
            const cleanWhere = whereClause.trim().replace(/;+$/, "");
            const querySql = `SELECT rowID FROM "${dbTable}" WHERE ${cleanWhere};`;
            try {
                const res = db.exec(querySql);
                if (res.length > 0 && res[0].values.length > 0) {
                    for (const row of res[0].values) {
                        rowIDs.push(String(row[0]));
                    }
                }
            } catch (err: any) {
                throw new Error(`Failed to evaluate WHERE clause on in-memory table: ${err.message || err}`);
            }
        }
        
        // Clear TTL cache
        tableSyncTimes.delete(avID);
        
        if (rowIDs.length > 0) {
            console.log(`[SQLiteManager] Deleting rows ${rowIDs} from AV ${avID}`);
            const res = await post("/api/av/removeAttributeViewBlocks", { avID, srcIDs: rowIDs });
            return { success: true, deletedRowsCount: rowIDs.length, message: `Successfully deleted ${rowIDs.length} rows` };
        }
        return { success: true, deletedRowsCount: 0, message: "No rows deleted" };
    }

    throw new Error(`Unsupported Writable SQL Statement. Only UPDATE, INSERT, and DELETE statements targeting specific row IDs are supported.`);
}

function parseSetClause(setStr: string): Record<string, any> {
    const result: Record<string, any> = {};
    let i = 0;
    let currentKey = "";
    let currentValue = "";
    let inQuote = false;
    let quoteChar = "";
    let isValueMode = false;

    while (i < setStr.length) {
        const char = setStr[i];
        if (inQuote) {
            if (char === quoteChar) {
                inQuote = false;
            } else {
                currentValue += char;
            }
        } else {
            if (char === "'" || char === '"' || char === "`") {
                inQuote = true;
                quoteChar = char;
            } else if (char === "=" && !isValueMode) {
                isValueMode = true;
            } else if (char === "," && isValueMode) {
                result[currentKey.trim()] = parsePrimitiveValue(currentValue.trim());
                currentKey = "";
                currentValue = "";
                isValueMode = false;
            } else {
                if (isValueMode) {
                    currentValue += char;
                } else {
                    currentKey += char;
                }
            }
        }
        i++;
    }
    if (currentKey.trim()) {
        result[currentKey.trim()] = parsePrimitiveValue(currentValue.trim());
    }
    return result;
}

function parseValuesClause(valStr: string): any[] {
    const result: any[] = [];
    let i = 0;
    let currentValue = "";
    let inQuote = false;
    let quoteChar = "";
    
    while (i < valStr.length) {
        const char = valStr[i];
        if (inQuote) {
            if (char === quoteChar) {
                inQuote = false;
            } else {
                currentValue += char;
            }
        } else {
            if (char === "'" || char === '"' || char === "`") {
                inQuote = true;
                quoteChar = char;
            } else if (char === ",") {
                result.push(parsePrimitiveValue(currentValue.trim()));
                currentValue = "";
            } else {
                currentValue += char;
            }
        }
        i++;
    }
    if (currentValue.trim()) {
        result.push(parsePrimitiveValue(currentValue.trim()));
    }
    return result;
}

function parsePrimitiveValue(valStr: string): any {
    if (valStr.toLowerCase() === "true") return true;
    if (valStr.toLowerCase() === "false") return false;
    if (valStr.toLowerCase() === "null") return null;
    if (!isNaN(Number(valStr)) && valStr !== "") return Number(valStr);
    return valStr.replace(/^['"`]|['"`]$/g, "");
}

// ═══════════════════════════════════════════
//  Schema & Metadata Queries
// ═══════════════════════════════════════════

export async function getInstantiatedIds(): Promise<Set<string>> {
    const { db } = await getSqliteEngine();
    try {
        const res = db.exec("SELECT id FROM _meta WHERE type = 'av'");
        return new Set(res[0]?.values.map((v: any) => v[0]) || []);
    } catch { return new Set(); }
}

/**
 * Get full schema info for an instantiated AV
 */
export async function getAVSchema(avID: string): Promise<AVColumnSchema[]> {
    const { db } = await getSqliteEngine();
    try {
        const res = db.exec(
            `SELECT av_id, col_name, key_id, key_name, key_type, writable, options FROM _av_schema WHERE av_id = ? ORDER BY col_order`,
            [avID]
        );
        if (!res.length) return [];
        return res[0].values.map((row: any) => ({
            avId: row[0],
            colName: row[1],
            keyId: row[2],
            keyName: row[3],
            keyType: row[4],
            writable: row[5] === 1,
            options: row[6]
        }));
    } catch { return []; }
}

/**
 * Get sync metadata for all instantiated AVs
 */
export async function getSyncMetadata(): Promise<Record<string, { updated: string; rowCount: number; colCount: number }>> {
    const { db } = await getSqliteEngine();
    try {
        const res = db.exec("SELECT id, updated, row_count, col_count FROM _meta WHERE type = 'av'");
        if (!res.length) return {};
        const result: Record<string, any> = {};
        res[0].values.forEach((row: any) => {
            result[row[0]] = { updated: row[1], rowCount: row[2] || 0, colCount: row[3] || 0 };
        });
        return result;
    } catch { return {}; }
}

// ═══════════════════════════════════════════
//  Saved Queries
// ═══════════════════════════════════════════

export async function saveQuery(name: string, sql: string): Promise<string> {
    const { db } = await getSqliteEngine();
    // @ts-ignore
    const id = window.Lute?.NewNodeID?.() || `q_${Date.now()}`;
    db.run(
        `INSERT OR REPLACE INTO _saved_queries (id, name, sql, created) VALUES (?, ?, ?, ?);`,
        [id, name, sql, new Date().toISOString()]
    );
    await saveDatabaseToDisk();
    return id;
}

export async function getSavedQueries(): Promise<SavedQuery[]> {
    const { db } = await getSqliteEngine();
    try {
        const res = db.exec("SELECT id, name, sql, created FROM _saved_queries ORDER BY created DESC");
        if (!res.length) return [];
        return res[0].values.map((row: any) => ({
            id: row[0], name: row[1], sql: row[2], created: row[3]
        }));
    } catch { return []; }
}

export async function deleteSavedQuery(id: string): Promise<void> {
    const { db } = await getSqliteEngine();
    db.run(`DELETE FROM _saved_queries WHERE id = ?;`, [id]);
    await saveDatabaseToDisk();
}

// ═══════════════════════════════════════════
//  Export Utilities
// ═══════════════════════════════════════════

/**
 * Export query results as CSV string
 */
export function exportToCSV(queryResult: { columns: string[]; values: any[][] }): string {
    if (!queryResult || !queryResult.columns.length) return "";

    const csvRows: string[] = [];
    // Header
    csvRows.push(queryResult.columns.map(col => _csvEscape(col)).join(","));
    // Rows
    queryResult.values.forEach(row => {
        csvRows.push(row.map(val => _csvEscape(val === null ? "" : String(val))).join(","));
    });
    return csvRows.join("\n");
}

/**
 * Export query results as JSON string
 */
export function exportToJSON(queryResult: { columns: string[]; values: any[][] }): string {
    if (!queryResult || !queryResult.columns.length) return "[]";

    const rows = queryResult.values.map(row => {
        const obj: Record<string, any> = {};
        queryResult.columns.forEach((col, i) => {
            obj[col] = row[i];
        });
        return obj;
    });
    return JSON.stringify(rows, null, 2);
}

/**
 * Trigger a file download in the browser
 */
export function downloadFile(content: string, filename: string, mimeType: string = "text/csv") {
    const blob = new Blob(["\uFEFF" + content], { type: `${mimeType};charset=utf-8` }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function _csvEscape(val: string): string {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
}

export async function checkTableExists(tableName: string): Promise<boolean> {
    try {
        const { db } = await getSqliteEngine();
        const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [tableName]);
        return res.length > 0 && res[0].values.length > 0;
    } catch {
        return false;
    }
}
