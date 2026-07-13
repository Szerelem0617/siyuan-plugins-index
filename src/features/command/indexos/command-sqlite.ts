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
        Requires_Params INTEGER DEFAULT 0,
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

    // 2.5 清理旧的内置命令数据并重新从 commands.json 载入以保证热更新生效
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

    // 3. Check if empty and seed default data
    const cmdCount = db.exec(`SELECT count(*) FROM ${TABLE_COMMANDS}`)[0].values[0][0];
    if (cmdCount === 0) {
        const defaultCmds = [
            // rowID, label, Command_ID, Param_Mapping, Requires_Params, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette
            ["20260526204558-bp28zp8", "🌐 全局关系图", "siyuan.view.graph", "", 0, "Global", 1, 1, 1, 1],
            ["20260526204558-zxrigm8", "📑 复制当前块", "editor.block.duplicate", "", 0, "Sibling", 1, 0, 0, 1],
            ["20260527120000-insert", "⚡ API 插入块测试", "api.block.insert", "{\"dataType\":\"markdown\",\"data\":\"[Auto Insert] Time: {{time}} | Date: {{date}}\"}", 1, "Global", 1, 0, 0, 1],
            ["20260701100000-fireworks", "🎆 烟花", "plugin-index.effect.fireworks", "", 0, "Self", 1, 0, 1, 1],
            ["20260713120000-showmessage", "💬 消息提示", "siyuan.ui.toast", "", 1, "Self", 1, 0, 1, 1]
        ];
        const stmt = db.prepare(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, Requires_Params, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const cmd of defaultCmds) {
            stmt.run(cmd);
        }
        stmt.free();
    } else {
        // Ensure plugin-index.effect.fireworks exists in TABLE_COMMANDS even if the database was already seeded
        try {
            const checkExists = db.exec(`SELECT count(*) FROM ${TABLE_COMMANDS} WHERE Command_ID = 'plugin-index.effect.fireworks'`);
            const existsCount = checkExists?.[0]?.values?.[0]?.[0] || 0;
            if (Number(existsCount) === 0) {
                db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, Requires_Params, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                        ["20260701100000-fireworks", "🎆 烟花", "plugin-index.effect.fireworks", "", 0, "Self", 1, 0, 1, 1]);
            }
        } catch (e) {
            console.error("[SQLite-Init] Failed to ensure plugin-index.effect.fireworks seeded:", e);
        }

        // Clean up old temporary command ID if exists
        try {
            db.run(`DELETE FROM ${TABLE_COMMANDS} WHERE Command_ID IN ('plugin.index.general.showMessage', 'siyuan.general.showMessage', 'plugin.index.effect.fireworks')`);
        } catch (_) { /* ignore */ }

        // Ensure siyuan.ui.toast exists in TABLE_COMMANDS
        try {
            const checkExists = db.exec(`SELECT count(*) FROM ${TABLE_COMMANDS} WHERE Command_ID = 'siyuan.ui.toast'`);
            const existsCount = checkExists?.[0]?.values?.[0]?.[0] || 0;
            if (Number(existsCount) === 0) {
                db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, Requires_Params, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                        ["20260713120000-showmessage", "💬 消息提示", "siyuan.ui.toast", "", 1, "Self", 1, 0, 1, 1]);
            }
        } catch (e) {
            console.error("[SQLite-Init] Failed to ensure siyuan.ui.toast seeded:", e);
        }
    }

    const typeCount = db.exec(`SELECT count(*) FROM ${TABLE_TYPES}`)[0].values[0][0];
    if (typeCount === 0) {
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Block_Icon_Menu, Current_Page_Menu, Enable) VALUES (?, ?, ?, ?, ?)`, 
            ["20260526204605-7hun58a", "#Project", "全局关系图", "", 1]);
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Block_Icon_Menu, Current_Page_Menu, Enable) VALUES (?, ?, ?, ?, ?)`, 
            ["20260526204605-v11e2ta", "#Person", "", "", 1]);
    }

    await saveDatabaseToDisk();
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
