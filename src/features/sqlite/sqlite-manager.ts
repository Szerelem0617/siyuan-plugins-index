import { post } from "../../shared/api-client/request";
import { plugin } from "../../shared/utils";
import { executeDML } from "./run-query/dml";
import { executeDDL, type DDLOptions } from "./run-query/ddl";

let dbInstance: any = null;
let SQL_ENGINE: any = null;
export let instantiatedAvIdsCache: Set<string> = new Set();

// ─── On-Demand Table TTL Cache ───
export const tableSyncTimes = new Map<string, number>();

// ─── Friendly Table Name Map ───
export const friendlyTableNameMap = new Map<string, string[]>();
export const avIdToBlockIdMap = new Map<string, string>();

export function registerFriendlyTableName(friendlyName: string, avId: string) {
    const cleanName = friendlyName.replace(/["'\`]/g, "").trim();
    const namesToRegister = [
        cleanName,
        cleanName.replace(/\s+/g, "_"),
        cleanName.replace(/[^a-zA-Z0-9]/g, "_")
    ];
    
    for (const name of namesToRegister) {
        let list = friendlyTableNameMap.get(name) || [];
        if (!list.includes(avId)) {
            list.push(avId);
            friendlyTableNameMap.set(name, list);
        }
    }
}

export function resolveTableAvId(tableName: string): string | null {
    const cleanName = tableName.replace(/["'\`]/g, "").trim();
    if (friendlyTableNameMap.has(cleanName)) {
        const list = friendlyTableNameMap.get(cleanName)!;
        if (list.length > 1) {
            throw new Error(`Table name '${cleanName}' is ambiguous because multiple databases share this name: ${list.join(", ")}. Please use the exact SQLite table name (e.g. av_xxxx_xxxx) instead.`);
        }
        return list[0];
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
            const pluginId = plugin?.name || "siyuan-plugins-index";
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
            locateFile: (file: string) => `/plugins/${plugin?.name || "siyuan-plugins-index"}/${file}`
        });

        dbInstance = new SQL_ENGINE.Database();

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
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    let res: any;
    let av: any;
    let keyValues: any[] = [];

    for (let attempt = 1; attempt <= 6; attempt++) {
        res = await post("/api/av/getAttributeView", { id: avID });
        if (res && (!res.code || res.code === 0)) {
            av = res.av || res;
            if (av && av.name && av.name !== "Unnamed" && av.name !== "Unnamed Database") {
                registerFriendlyTableName(av.name, avID);
            }
            keyValues = av?.keyValues || [];
            
            if (keyValues.length === 0) {
                const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avID });
                const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
                if (currentKeys.length > 0) {
                    keyValues = currentKeys.map((k: any) => ({
                        key: k,
                        values: []
                    }));
                }
            }
        }

        if (keyValues.length > 0) {
            break;
        }

        if (attempt < 6) {
            console.warn(`[SQLiteManager] instantiateAV: keyValues empty/inactive for ${avID} (attempt ${attempt}/6). Waking up view via renderAttributeView and retrying in 800ms...`);
            await post("/api/av/renderAttributeView", { id: avID });
            await sleep(800);
        }
    }

    if (keyValues.length === 0) {
        console.warn(`[SQLiteManager] instantiateAV warning: No columns/keyValues for ${avID} after 6 attempts. Res:`, JSON.stringify(res));
        return { success: false, message: "Empty/No columns" };
    }

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
    
    // Sort friendly names by length descending
    const friendlyNames = Array.from(friendlyTableNameMap.keys()).sort((a, b) => b.length - a.length);
    
    for (const friendlyName of friendlyNames) {
        const avIds = friendlyTableNameMap.get(friendlyName);
        if (!avIds || avIds.length === 0) continue;
        
        // Escape special regex characters in friendlyName
        const escapedName = friendlyName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        // Use lookbehind and lookahead to ensure we only match standalone identifiers
        const regex = new RegExp(`(?<![a-zA-Z0-9_])(["'\`]?)${escapedName}\\1(?![a-zA-Z0-9_])`, 'g');
        
        // Check if the query actually contains this friendlyName
        if (regex.test(processed)) {
            if (avIds.length > 1) {
                throw new Error(`Table name '${friendlyName}' is ambiguous because multiple databases share this name: ${avIds.join(", ")}. Please use the exact SQLite table name (e.g. av_xxxx_xxxx) instead.`);
            }
            const targetTableName = avIdToTableName(avIds[0]);
            // Reset regex search index since we did regex.test
            regex.lastIndex = 0;
            processed = processed.replace(regex, `"${targetTableName}"`);
        }
    }
    
    return processed;
}

export async function runQuery(sql: string, params?: any[], options?: DDLOptions): Promise<{ columns: string[], values: any[][] }> {
    const processedSql = preprocessSql(sql);

    // Intercept query to get views for an AV table
    // Pattern: SELECT [fields] FROM _av_views WHERE av_id = 'xxxx'
    const viewsSelectMatch = processedSql.match(/^\s*SELECT\s+(.+?)\s+FROM\s+["`']?_av_views["`']?\s+WHERE\s+(av_id|table_name)\s*=\s*['"`]?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)['"`]?\s*;?\s*$/i);
    if (viewsSelectMatch) {
        const whereCol = viewsSelectMatch[2].trim().toLowerCase();
        let tableVal = viewsSelectMatch[3].trim();
        
        let avID = tableVal;
        if (whereCol === "table_name") {
            const resolved = resolveTableAvId(tableVal);
            if (resolved) avID = resolved;
        }
        
        console.log(`[SQLiteManager] Intercepted views query for avID: ${avID}`);
        
        try {
            const avData = await post("/api/av/renderAttributeView", { id: avID });
            const viewsList = avData.views || avData.view?.views || [];
            
            const rows = viewsList.map((v: any) => {
                return {
                    id: v.id || "",
                    name: v.name || "",
                    type: v.type || "",
                    layout: v.layout || ""
                };
            });
            
            const columns = ["id", "name", "type", "layout"];
            const values = rows.map((r: any) => [r.id, r.name, r.type, r.layout]);
            
            return { columns, values };
        } catch (e: any) {
            throw new Error(`Failed to fetch views for AV table: ${e.message || e}`);
        }
    }

    // 0. Auto-redirect write SQLs
    const isWrite = /^\s*(update|insert|delete|create|alter|drop|replace)\b/i.test(processedSql);
    if (isWrite) {
        console.log(`[SQLiteManager] Redirecting write SQL to executeWritableSql: "${processedSql.slice(0, 50)}..."`);
        const writeRes = await executeWritableSql(processedSql, options);
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
            try {
                const instRes = await instantiateAV(avID, true);
                if (instRes && !instRes.success) {
                    console.error(`[SQLiteManager] Failed to instantiate table ${cleanName}:`, instRes.message);
                } else {
                    tableSyncTimes.set(avID, Date.now());
                }
            } catch (e) {
                console.error(`[SQLiteManager] Failed to auto-instantiate table ${cleanName}:`, e);
            }
        }
    }

    const { db } = await getSqliteEngine();
    const res = db.exec(processedSql, params);
    if (res.length > 0) {
        return { columns: res[0].columns, values: res[0].values };
    }

    // 0-row fallback: If SELECT returned empty results, query PRAGMA table_info to retrieve column schemas
    for (const rawName of tableNameMatches) {
        const cleanName = rawName.replace(/["'\`]/g, "").trim();
        if (cleanName.startsWith("av_")) {
            try {
                const tableInfo = db.exec(`PRAGMA table_info("${cleanName}")`);
                if (tableInfo.length > 0 && tableInfo[0].values) {
                    const cols = tableInfo[0].values.map((v: any) => String(v[1]));
                    console.log(`[SQLiteManager] Retrieved PRAGMA columns for empty table ${cleanName}:`, cols);
                    return { columns: cols, values: [] };
                }
            } catch (e) {
                console.error(`[SQLiteManager] PRAGMA table_info failed for ${cleanName}:`, e);
            }
        }
    }

    return { columns: [], values: [] };
}

export async function executeWritableSql(sql: string, options?: DDLOptions): Promise<any> {
    const processedSql = preprocessSql(sql);
    const { db } = await getSqliteEngine();
    
    // Check DML statements (including REPLACE INTO / UPSERT INTO)
    const isUpdate = /^\s*UPDATE\b/i.test(processedSql);
    const isInsert = /^\s*INSERT\b/i.test(processedSql);
    const isDelete = /^\s*DELETE\b/i.test(processedSql);
    const isReplace = /^\s*(?:REPLACE|UPSERT)\b/i.test(processedSql);
    
    // 🛡️ 防护规则：禁止写操作作用于系统注册表 (sys_registry_db)
    if (/sys_registry_db/i.test(processedSql)) {
        throw new Error("⚠️ 拒绝写操作：sys_registry_db 为系统注册表，严禁直接写修改。");
    }
    
    if (isUpdate || isInsert || isDelete || isReplace) {
        return executeDML(processedSql, db);
    }
    
    // Check DDL statements
    const isCreate = /^\s*CREATE\b/i.test(processedSql);
    const isAlter = /^\s*ALTER\b/i.test(processedSql);
    const isDrop = /^\s*DROP\b/i.test(processedSql);
    
    if (isCreate || isAlter || isDrop) {
        return executeDDL(processedSql, db, options);
    }
    
    throw new Error(`Unsupported Writable SQL Statement. Only DML (UPDATE, INSERT, DELETE) and DDL (CREATE, ALTER, DROP) statements targeting Siyuan AVs are supported.`);
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
