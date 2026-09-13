import { getSqliteEngine, saveDatabaseToDisk, registerFriendlyTableName } from "../../sqlite/sqlite-manager";
import commandsData from "../registry/builtin";
import { getSeedCommandRows, getSeedSupertagRows } from "./seed-data";
import { plugin } from "../../../shared/utils";

const TABLE_REGISTRY = "sys_registry_db";
const TABLE_COMMANDS = "command-db";
const TABLE_SUPERTAGS = "supertag-db";
const STORAGE_KEY = "indexos-meta.json";

/**
 * ⚡ IndexOS SQL-First 统一元数据底座
 *
 * 1. sys_registry_db: Layer 1 命令定义的 SQLite 查询缓存/镜像。
 * 2. command-db: Layer 2 命令绑定表，直接在 SQLite 内存就绪，并与插件 storage 保持双向持久化。
 * 3. supertag-db: Layer 3 超级标签绑定表，直接在 SQLite 内存就绪，并与插件 storage 保持双向持久化。
 *
 * 核心特性：无论用户是否在思源中执行“将数据存到思源”，内存 SQLite 始终具备完整可用状态，
 * 所有通过界面进行的增删改均可直接生效并持久化。
 */
let initSystemTablesPromise: Promise<void> | null = null;

export async function initSystemTables(): Promise<void> {
    if (initSystemTablesPromise) return initSystemTablesPromise;

    initSystemTablesPromise = (async () => {
        const { db } = await getSqliteEngine();

    // 1. Layer 1 注册表
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_REGISTRY} (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        dispatch TEXT,
        params TEXT,
        constraints TEXT,
        meta TEXT
    );`);

    try {
        db.run(`DELETE FROM ${TABLE_REGISTRY} WHERE meta LIKE '%builtin%' OR meta IS NULL`);
    } catch (_) { /* ignore */ }

    const stmt = db.prepare(`INSERT OR REPLACE INTO ${TABLE_REGISTRY} (id, name, description, dispatch, params, constraints, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const cmd of (commandsData as any).commands) {
        stmt.run([
            cmd.id,
            cmd.name,
            cmd.description || "",
            JSON.stringify(cmd.dispatch),
            JSON.stringify(cmd.params),
            JSON.stringify(cmd.constraints),
            JSON.stringify(cmd.meta)
        ]);
    }
    stmt.free();

    // 2. Layer 2 命令分身表 (command-db)
    db.run(`CREATE TABLE IF NOT EXISTS "${TABLE_COMMANDS}" (
        rowID TEXT PRIMARY KEY,
        "主键" TEXT,
        "Command ID" TEXT,
        "Input" TEXT,
        "Output" TEXT,
        "Composite" TEXT DEFAULT '',
        _updated INTEGER
    );`);

    try {
        const pragma = db.exec(`PRAGMA table_info("${TABLE_COMMANDS}");`);
        const cols = (pragma[0]?.values || []).map((v: any) => String(v[1]));
        if (!cols.includes("Composite")) {
            db.run(`ALTER TABLE "${TABLE_COMMANDS}" ADD COLUMN "Composite" TEXT DEFAULT '';`);
        }
    } catch (_) {}

    // 3. Layer 3 超级标签绑定表 (supertag-db)
    db.run(`CREATE TABLE IF NOT EXISTS "${TABLE_SUPERTAGS}" (
        rowID TEXT PRIMARY KEY,
        "主键" TEXT,
        "Manual" TEXT,
        "Auto" TEXT,
        "Related av" TEXT,
        "Schema" TEXT DEFAULT '[]',
        _updated INTEGER
    );`);

    try {
        const pragma = db.exec(`PRAGMA table_info("${TABLE_SUPERTAGS}");`);
        const cols = (pragma[0]?.values || []).map((v: any) => String(v[1]));
        if (!cols.includes("Schema")) {
            db.run(`ALTER TABLE "${TABLE_SUPERTAGS}" ADD COLUMN "Schema" TEXT DEFAULT '[]';`);
        }
    } catch (_) {}

    // 4. 尝试从本地插件持久化配置 (indexos-meta.json) 载入数据
    let loadedMeta: any = null;
    try {
        if (plugin?.loadData) {
            loadedMeta = await plugin.loadData(STORAGE_KEY);
        }
    } catch (e) {
        console.warn("[SystemTables] Failed to load meta from plugin storage:", e);
    }

    // 填充 command-db
    const cmdCountRes = db.exec(`SELECT count(*) FROM "${TABLE_COMMANDS}"`);
    const cmdCount = cmdCountRes[0]?.values[0]?.[0] || 0;
    if (cmdCount === 0) {
        if (loadedMeta?.commands && Array.isArray(loadedMeta.commands) && loadedMeta.commands.length > 0) {
            const insCmd = db.prepare(`INSERT OR REPLACE INTO "${TABLE_COMMANDS}" (rowID, "主键", "Command ID", "Input", "Output", "Composite", _updated) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const r of loadedMeta.commands) {
                insCmd.run([
                    r.rowID,
                    r.label || r["主键"] || "",
                    r.commandID || r["Command ID"] || "",
                    r.inputMapping || r["Input"] || "{}",
                    r.outputMapping || r["Output"] || "{}",
                    r.composite || r["Composite"] || "",
                    r._updated || Date.now()
                ]);
            }
            insCmd.free();
        } else {
            // 用 seed-data 初始化
            const seedCmds = getSeedCommandRows();
            const insCmd = db.prepare(`INSERT OR REPLACE INTO "${TABLE_COMMANDS}" (rowID, "主键", "Command ID", "Input", "Output", "Composite", _updated) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const r of seedCmds) {
                insCmd.run([r.rowID, r.label, r.commandID, r.inputMapping || "{}", r.outputMapping || "{}", (r as any).composite || "", Date.now()]);
            }
            insCmd.free();
        }
    }

    // 填充 supertag-db
    const tagCountRes = db.exec(`SELECT count(*) FROM "${TABLE_SUPERTAGS}"`);
    const tagCount = tagCountRes[0]?.values[0]?.[0] || 0;
    if (tagCount === 0) {
        if (loadedMeta?.supertags && Array.isArray(loadedMeta.supertags) && loadedMeta.supertags.length > 0) {
            const insTag = db.prepare(`INSERT OR REPLACE INTO "${TABLE_SUPERTAGS}" (rowID, "主键", "Manual", "Auto", "Related av", "Schema", _updated) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const r of loadedMeta.supertags) {
                insTag.run([
                    r.rowID,
                    r.supertag || r["主键"] || "",
                    r.manual || r["Manual"] || "",
                    r.auto || r["Auto"] || "",
                    r.relatedAv || r["Related av"] || "",
                    r.schema || r["Schema"] || "[]",
                    r._updated || Date.now()
                ]);
            }
            insTag.free();
        } else {
            // 用 seed-data 初始化
            const seedTags = getSeedSupertagRows();
            const insTag = db.prepare(`INSERT OR REPLACE INTO "${TABLE_SUPERTAGS}" (rowID, "主键", "Manual", "Auto", "Related av", "Schema", _updated) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const r of seedTags) {
                insTag.run([r.rowID, r.supertag, r.manual || "", r.auto || r.conditional || "", "", r.schema || "[]", Date.now()]);
            }
            insTag.free();
        }
    }

    await saveDatabaseToDisk();
    })();

    return initSystemTablesPromise;
}

/**
 * 将当前 SQLite 内存中的 command-db 与 supertag-db 状态持久化到插件 Storage
 */
export async function saveMetaToStorage() {
    try {
        const { db } = await getSqliteEngine();
        const cmdRes = db.exec(`SELECT rowID, "主键", "Command ID", "Input", "Output", "Composite", _updated FROM "${TABLE_COMMANDS}"`);
        const tagRes = db.exec(`SELECT rowID, "主键", "Manual", "Auto", "Related av", "Schema", _updated FROM "${TABLE_SUPERTAGS}"`);

        const commands = (cmdRes[0]?.values || []).map((v: any[]) => ({
            rowID: String(v[0] || ""),
            label: String(v[1] || ""),
            commandID: String(v[2] || ""),
            inputMapping: String(v[3] || "{}"),
            outputMapping: String(v[4] || "{}"),
            composite: String(v[5] || ""),
            _updated: Number(v[6] || Date.now())
        }));

        const supertags = (tagRes[0]?.values || []).map((v: any[]) => ({
            rowID: String(v[0] || ""),
            supertag: String(v[1] || ""),
            manual: String(v[2] || ""),
            auto: String(v[3] || ""),
            relatedAv: String(v[4] || ""),
            schema: String(v[5] || "[]"),
            _updated: Number(v[6] || Date.now())
        }));

        if (plugin?.saveData) {
            await plugin.saveData(STORAGE_KEY, { commands, supertags, version: "2.0.0", updatedAt: Date.now() });
        }
        await saveDatabaseToDisk();
    } catch (err) {
        console.error("[SystemTables] Failed to save meta to storage:", err);
    }
}

/**
 * Returns the table names for other modules to use.
 */
export function getSystemTableNames() {
    return {
        registry: TABLE_REGISTRY,
        commands: TABLE_COMMANDS,
        supertags: TABLE_SUPERTAGS
    };
}
