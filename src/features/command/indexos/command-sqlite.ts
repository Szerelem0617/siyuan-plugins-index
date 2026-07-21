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
        UI_Entries TEXT
    );`);

    // 2. Create Type Table aligned with sanitized AV Column names (Layer 3)
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_TYPES} (
        rowID TEXT PRIMARY KEY,
        supertag TEXT,
        Icon_Menu TEXT,
        Conditional TEXT
    );`);

    try {
        db.run(`ALTER TABLE ${TABLE_TYPES} ADD COLUMN Icon_Menu TEXT;`);
    } catch (_) { /* ignore */ }
    try {
        db.run(`ALTER TABLE ${TABLE_TYPES} ADD COLUMN Conditional TEXT;`);
    } catch (_) { /* ignore */ }
    try {
        db.run(`UPDATE ${TABLE_TYPES} SET Icon_Menu = 
            CASE 
                WHEN (Block_Icon_Menu IS NOT NULL AND Block_Icon_Menu != '') AND (Current_Page_Menu IS NOT NULL AND Current_Page_Menu != '') 
                THEN Block_Icon_Menu || ', ' || Current_Page_Menu
                WHEN Block_Icon_Menu IS NOT NULL AND Block_Icon_Menu != '' THEN Block_Icon_Menu
                ELSE Current_Page_Menu 
            END
            WHERE Icon_Menu IS NULL OR Icon_Menu = ''`);
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
                const mapped: string[] = [];
                if (s.uiEntries) {
                    if (s.uiEntries.includes("topbar")) mapped.push("顶栏");
                    if (s.uiEntries.includes("inline")) mapped.push("行内按钮");
                    if (s.uiEntries.includes("palette")) mapped.push("快捷命令");
                }
                defaultCmds.push([
                    s.rowID,
                    s.label,
                    cmd.id,
                    s.paramMapping || "",
                    mapped.join(", ")
                ]);
            }
        }
        const stmt = db.prepare(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, UI_Entries) VALUES (?, ?, ?, ?, ?)`);
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
                    const mapped: string[] = [];
                    if (s.uiEntries) {
                        if (s.uiEntries.includes("topbar")) mapped.push("顶栏");
                        if (s.uiEntries.includes("inline")) mapped.push("行内按钮");
                        if (s.uiEntries.includes("palette")) mapped.push("快捷命令");
                    }
                    db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, UI_Entries) 
                            VALUES (?, ?, ?, ?, ?)`, 
                            [s.rowID, s.label, fireworksCmd.id, s.paramMapping || "", mapped.join(", ")]);
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
                    const mapped: string[] = [];
                    if (s.uiEntries) {
                        if (s.uiEntries.includes("topbar")) mapped.push("顶栏");
                        if (s.uiEntries.includes("inline")) mapped.push("行内按钮");
                        if (s.uiEntries.includes("palette")) mapped.push("快捷命令");
                    }
                    db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, UI_Entries) 
                            VALUES (?, ?, ?, ?, ?)`, 
                            [s.rowID, s.label, toastCmd.id, s.paramMapping || "", mapped.join(", ")]);
                }
            }
        } catch (e) {
            console.error("[SQLite-Init] Failed to ensure siyuan.ui.toast seeded:", e);
        }

        // Ensure plugin-index.command.turnIntoTask exists in TABLE_COMMANDS
        try {
            const checkExists = db.exec(`SELECT count(*) FROM ${TABLE_COMMANDS} WHERE Command_ID = 'plugin-index.command.turnIntoTask'`);
            const existsCount = checkExists?.[0]?.values?.[0]?.[0] || 0;
            if (Number(existsCount) === 0) {
                const turnTaskCmd = (commandsData as any).commands.find((c: any) => c.id === 'plugin-index.command.turnIntoTask');
                if (turnTaskCmd && turnTaskCmd.seed) {
                    const s = turnTaskCmd.seed;
                    db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, UI_Entries) 
                            VALUES (?, ?, ?, ?, ?)`, 
                            [s.rowID, s.label, turnTaskCmd.id, s.paramMapping || "", "快捷命令"]);
                }
            }
        } catch (e) {
            console.error("[SQLite-Init] Failed to ensure turnIntoTask seeded:", e);
        }

    }

    const typeCount = db.exec(`SELECT count(*) FROM ${TABLE_TYPES}`)[0].values[0][0];
    const defaultPersonConditional = `// [打上标签时] -> ☑ 转换为任务
// [任务完成时] -> 🎆 烟花, 💬 消息提示(message="🎉 恭喜！任务完成状态: {{vars.completed}}")

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        await dispatch("plugin-index.command.turnIntoTask");
    }
    if (eventName === "task_completed") {
        await dispatch("plugin-index.effect.fireworks");
        await dispatch("siyuan.ui.toast", { message: "🎉 恭喜！任务完成状态: " + (state.vars.completed || state.vars["index-task"] || "completed") });
    }
}`;

    if (typeCount === 0) {
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Icon_Menu, Conditional) VALUES (?, ?, ?, ?)`, 
            ["20260526204605-7hun58a", "project", "🌐 全局关系图", ""]);
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Icon_Menu, Conditional) VALUES (?, ?, ?, ?)`, 
            ["20260526204605-v11e2ta", "person", "🎆 烟花, 💬 消息提示, ☑ 转换为任务", defaultPersonConditional]);
    } else {
        try {
            // Update person conditional unconditionally to make sure it gets the latest seed rule in development
            db.run(`UPDATE ${TABLE_TYPES} SET Conditional = ? WHERE supertag = 'person'`, [defaultPersonConditional]);
            db.run(`UPDATE ${TABLE_TYPES} SET Icon_Menu = '🎆 烟花, 💬 消息提示, ☑ 转换为任务' WHERE supertag = 'person'`);
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
