import { getSqliteEngine, saveDatabaseToDisk } from "../../sqlite/sqlite-manager";
import commandsData from "../registry/commands.json";

const TABLE_REGISTRY = "sys_registry_db";
const TABLE_COMMANDS = "sys_command_db";
const TABLE_TYPES = "sys_type_db";

/**
 * Ensures the system tables exist in SQLite and populates them with default data if empty.
 * In this mode, SQLite IS the source of truth. No SiYuan documents are required.
 */
export async function initSystemTables() {
    const { db } = await getSqliteEngine();
    console.log("[SQLite-IndexOS] Initializing System Tables as Source of Truth...");

    // 0. Create Registry Table (Layer 1)
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_REGISTRY} (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        dispatch TEXT,
        params TEXT,
        constraints TEXT,
        meta TEXT
    );`);

    // 1. Create Command Table aligned with sanitized AV Column names (Layer 2)
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_COMMANDS} (
        rowID TEXT PRIMARY KEY,
        label TEXT,
        Command_ID TEXT,
        Param_Mapping TEXT,
        Command_Type TEXT,
        Target_Scope TEXT,
        Enable INTEGER DEFAULT 1,
        Top_Bar INTEGER DEFAULT 0,
        Inline_Button INTEGER DEFAULT 0,
        Command_Palette INTEGER DEFAULT 0
    );`);

    // 2. Create Type Table aligned with sanitized AV Column names (Layer 3)
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_TYPES} (
        rowID TEXT PRIMARY KEY,
        supertag TEXT,
        Block_Icon_Menu TEXT,
        Current_Page_Menu TEXT,
        Enable INTEGER DEFAULT 1
    );`);

    // 2.5 Check if Registry is empty and seed from JSON
    const registryCount = db.exec(`SELECT count(*) FROM ${TABLE_REGISTRY}`)[0].values[0][0];
    if (registryCount === 0) {
        console.log("[SQLite-IndexOS] Seeding default registry from JSON...");
        const stmt = db.prepare(`INSERT INTO ${TABLE_REGISTRY} (id, name, description, dispatch, params, constraints, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`);
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
    }

    // 3. Check if empty and seed default data
    const cmdCount = db.exec(`SELECT count(*) FROM ${TABLE_COMMANDS}`)[0].values[0][0];
    if (cmdCount === 0) {
        console.log("[SQLite-IndexOS] Seeding default commands...");
        const defaultCmds = [
            // rowID, label, Command_ID, Param_Mapping, Command_Type, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette
            ["20260526204558-bp28zp8", "🌐 全局关系图 (无上下文测试)", "general.graphView", "", "Native", "Global", 1, 1, 1, 1],
            ["20260526204558-6l2h54b", "📥 收集箱 (无上下文测试)", "general.inbox", "", "Native", "Global", 1, 0, 0, 1],
            ["20260526204558-iilvqz3", "🔍 在右侧分屏打开", "general.splitLR", "", "Native", "Global", 1, 0, 1, 1],
            ["20260526204558-6nbjc0b", "⬇️ 下方插入同级块", "editor.general.insertAfter", "", "Native", "Sibling", 1, 0, 0, 1],
            ["20260526204558-zxrigm8", "📑 复制当前块", "editor.general.duplicate", "", "Native", "Sibling", 1, 0, 0, 1],
            ["20260526204558-6y7laha", "🖇️ 复制块引用", "editor.general.copyBlockRef", "", "Native", "Global", 1, 0, 0, 1]
        ];
        const stmt = db.prepare(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, Command_Type, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const cmd of defaultCmds) {
            stmt.run(cmd);
        }
        stmt.free();
    }

    const typeCount = db.exec(`SELECT count(*) FROM ${TABLE_TYPES}`)[0].values[0][0];
    if (typeCount === 0) {
        console.log("[SQLite-IndexOS] Seeding default type bindings...");
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Block_Icon_Menu, Current_Page_Menu, Enable) VALUES (?, ?, ?, ?, ?)`, 
            ["20260526204605-7hun58a", "#Project", "在右侧分屏打开, 全局关系图", "", 1]);
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Block_Icon_Menu, Current_Page_Menu, Enable) VALUES (?, ?, ?, ?, ?)`, 
            ["20260526204605-v11e2ta", "#Person", "", "", 1]);
    }

    await saveDatabaseToDisk();
    console.log("[SQLite-IndexOS] System tables ready.");
}

/**
 * Returns the table names for other modules to use.
 */
export function getSystemTableNames() {
    return {
        registry: TABLE_REGISTRY,
        commands: TABLE_COMMANDS,
        types: TABLE_TYPES
    };
}
