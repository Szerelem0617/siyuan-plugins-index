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
        On_Create TEXT
    );`);

    try {
        db.run(`ALTER TABLE ${TABLE_TYPES} ADD COLUMN On_Create TEXT;`);
    } catch (_) { /* ignore */ }

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
        const defaultCmds: any[] = [];
        for (const cmd of (commandsData as any).commands) {
            if (cmd.seed) {
                const s = cmd.seed;
                defaultCmds.push([
                    s.rowID,
                    s.label,
                    cmd.id,
                    s.paramMapping || "",
                    s.topBar !== undefined ? s.topBar : 0,
                    s.inlineButton !== undefined ? s.inlineButton : 0,
                    s.commandPalette !== undefined ? s.commandPalette : 1
                ]);
            }
        }
        const stmt = db.prepare(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, Top_Bar, Inline_Button, Command_Palette) VALUES (?, ?, ?, ?, ?, ?, ?)`);
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
                const fireworksCmd = (commandsData as any).commands.find((c: any) => c.id === 'plugin-index.effect.fireworks');
                if (fireworksCmd && fireworksCmd.seed) {
                    const s = fireworksCmd.seed;
                    db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, Top_Bar, Inline_Button, Command_Palette) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                            [s.rowID, s.label, fireworksCmd.id, s.paramMapping || "", s.topBar || 0, s.inlineButton || 1, s.commandPalette || 1]);
                }
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
                const toastCmd = (commandsData as any).commands.find((c: any) => c.id === 'siyuan.ui.toast');
                if (toastCmd && toastCmd.seed) {
                    const s = toastCmd.seed;
                    db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, Top_Bar, Inline_Button, Command_Palette) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                            [s.rowID, s.label, toastCmd.id, s.paramMapping || "", s.topBar || 0, s.inlineButton || 1, s.commandPalette || 1]);
                }
            }
        } catch (e) {
            console.error("[SQLite-Init] Failed to ensure siyuan.ui.toast seeded:", e);
        }
    }

    const typeCount = db.exec(`SELECT count(*) FROM ${TABLE_TYPES}`)[0].values[0][0];
    if (typeCount === 0) {
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Block_Icon_Menu, Current_Page_Menu, On_Create) VALUES (?, ?, ?, ?, ?)`, 
            ["20260526204605-7hun58a", "#Project", "🌐 全局关系图", "", ""]);
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Block_Icon_Menu, Current_Page_Menu, On_Create) VALUES (?, ?, ?, ?, ?)`, 
            ["20260526204605-v11e2ta", "#Person", "🎆 烟花, 💬 消息提示", "", "🎆 烟花, 💬 消息提示"]);
    } else {
        try {
            db.run(`UPDATE ${TABLE_TYPES} SET On_Create = '🎆 烟花, 💬 消息提示' WHERE supertag = '#Person' AND (On_Create IS NULL OR On_Create = '')`);
        } catch (_) { /* ignore */ }
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
