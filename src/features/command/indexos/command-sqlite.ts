import { getSqliteEngine, saveDatabaseToDisk } from "../../sqlite/sqlite-manager";

const TABLE_COMMANDS = "sys_command_db";
const TABLE_TYPES = "sys_type_db";

/**
 * Ensures the system tables exist in SQLite and populates them with default data if empty.
 * In this mode, SQLite IS the source of truth. No SiYuan documents are required.
 */
export async function initSystemTables() {
    const { db } = await getSqliteEngine();
    console.log("[SQLite-IndexOS] Initializing System Tables as Source of Truth...");

    // 1. Create Command Table
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_COMMANDS} (
        id TEXT PRIMARY KEY,
        label TEXT,
        commandID TEXT,
        paramMapping TEXT,
        commandType TEXT,
        targetScope TEXT,
        topBar INTEGER DEFAULT 0,
        inlineButton INTEGER DEFAULT 0,
        commandPalette INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1
    );`);

    // 2. Create Type Table
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_TYPES} (
        supertag TEXT PRIMARY KEY,
        blockIconMenu TEXT,
        pageMenu TEXT,
        enabled INTEGER DEFAULT 1
    );`);

    // 3. Check if empty and seed default data
    const cmdCount = db.exec(`SELECT count(*) FROM ${TABLE_COMMANDS}`)[0].values[0][0];
    if (cmdCount === 0) {
        // console.log("[SQLite-IndexOS] Seeding default commands...");
        const defaultCmds = [
            ["general.graphView", "全局关系图", "general.graphView", "", "Native", "Global", 1, 1, 1],
            ["general.inbox", "收集箱", "general.inbox", "", "Native", "Global", 0, 0, 1],
            ["general.splitLR", "在右侧分屏打开", "general.splitLR", "", "Native", "Global", 0, 1, 1],
            ["editor.general.insertAfter", "下方插入同级块", "editor.general.insertAfter", "", "Native", "Sibling", 0, 0, 1],
            ["editor.general.duplicate", "复制当前块", "editor.general.duplicate", "", "Native", "Sibling", 0, 0, 1],
            ["editor.general.copyBlockRef", "复制块引用", "editor.general.copyBlockRef", "", "Native", "Global", 0, 0, 1]
        ];
        const stmt = db.prepare(`INSERT INTO ${TABLE_COMMANDS} (id, label, commandID, paramMapping, commandType, targetScope, topBar, inlineButton, commandPalette) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const cmd of defaultCmds) {
            stmt.run(cmd);
        }
        stmt.free();
    }

    const typeCount = db.exec(`SELECT count(*) FROM ${TABLE_TYPES}`)[0].values[0][0];
    if (typeCount === 0) {
        // console.log("[SQLite-IndexOS] Seeding default type bindings...");
        db.run(`INSERT INTO ${TABLE_TYPES} (supertag, blockIconMenu, pageMenu) VALUES (?, ?, ?)`,
            ["project", "在右侧分屏打开, 全局关系图", "全局关系图"]);
    }

    await saveDatabaseToDisk();
    console.log("[SQLite-IndexOS] System tables ready.");
}

/**
 * Returns the table names for other modules to use.
 */
export function getSystemTableNames() {
    return {
        commands: TABLE_COMMANDS,
        types: TABLE_TYPES
    };
}
