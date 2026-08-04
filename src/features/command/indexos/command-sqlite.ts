import { getSqliteEngine, saveDatabaseToDisk } from "../../sqlite/sqlite-manager";
import commandsData from "../registry/commands.json";

const TABLE_REGISTRY = "sys_registry_db";
const TABLE_COMMANDS = "sys_command_db";
const TABLE_TYPES = "sys_type_db";

/**
 * ⚠️【系统架构关键警告 - 只读模板与备份表 Read-Only System Backup Tables】
 * 
 * 1. TABLE_COMMANDS ("sys_command_db") 和 TABLE_TYPES ("sys_type_db") 是【只读系统模板与备份表】！
 * 2. 这两张表仅用于系统初次启动时的默认种子数据与“未实例化”时的只读降级回退；
 * 3. 当用户点击“实例化”后，真正被修改、配置、持久化的数据在思源【属性视图 (Attribute View / Command-DB / Supertag-DB)】中；
 * 4. ⚠️ 严禁在运行时代码中手写 UPDATE / DELETE / INSERT 去修改这两张系统表！所有运行时写操作必须通过属性视图 AV 接口或 updateCellValue() 执行！
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
        UI_Entries TEXT,
        Background_Exec TEXT
    );`);
    try {
        db.run(`ALTER TABLE ${TABLE_COMMANDS} ADD COLUMN Background_Exec TEXT;`);
    } catch (_) { /* ignore */ }

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

        const DEFAULT_TOAST_BG_EXEC = `// [Cron:*/1 * * * *] -> 执行 💬 消息提示\nif (triggerType === 'cron') {\n    await dispatch('siyuan.ui.toast');\n}`;

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
                    db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, UI_Entries, Background_Exec) 
                            VALUES (?, ?, ?, ?, ?, ?)`, 
                            [s.rowID, s.label, toastCmd.id, s.paramMapping || "", mapped.join(", "), DEFAULT_TOAST_BG_EXEC]);
                }
            } else {
                // 如果已存在但 Background_Exec 为空，自动升级填入默认参数
                db.run(`UPDATE ${TABLE_COMMANDS} SET Background_Exec = ? WHERE Command_ID = 'siyuan.ui.toast' AND (Background_Exec IS NULL OR Background_Exec = '')`, [DEFAULT_TOAST_BG_EXEC]);
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

        // Ensure api.block.update exists in TABLE_COMMANDS
        try {
            const checkUpdateExists = db.exec(`SELECT count(*) FROM ${TABLE_COMMANDS} WHERE Command_ID = 'api.block.update'`);
            const updateCount = checkUpdateExists?.[0]?.values?.[0]?.[0] || 0;
            if (Number(updateCount) === 0) {
                const updateCmd = (commandsData as any).commands.find((c: any) => c.id === 'api.block.update');
                if (updateCmd && updateCmd.seed) {
                    const s = updateCmd.seed;
                    db.run(`INSERT INTO ${TABLE_COMMANDS} (rowID, label, Command_ID, Param_Mapping, UI_Entries) 
                            VALUES (?, ?, ?, ?, ?)`, 
                            [s.rowID, s.label, updateCmd.id, s.paramMapping || "{}", "快捷命令"]);
                }
            }
        } catch (e) {
            console.error("[SQLite-Init] Failed to ensure api.block.update seeded:", e);
        }

        // Ensure Param_Mapping has {} for parametric commands
        try {
            db.run(`UPDATE ${TABLE_COMMANDS} SET Param_Mapping = '{}' WHERE Command_ID IN ('siyuan.ui.toast', 'plugin-index.command.turnIntoTask') AND (Param_Mapping IS NULL OR Param_Mapping = '')`);
        } catch (_) { /* ignore */ }
    }

    const defaultPipelineConditional = `// [打上标签时] -> ⚡ API 插入块测试, 📝 安全更新块内容

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        const step1 = await dispatch("api.block.insert", { dataType: "markdown", data: "[Pipeline Step 1] Time: {{time}}", previousID: "{{block_id}}" });
        const createdId = step1?.id || state.vars?.createdblock;
        if (createdId) {
            await dispatch("plugin-index.command.safeUpdateBlock", { id: createdId, dataType: "markdown", data: "[Pipeline Step 2] Updated newly created block at {{time}}" });
        }
    }
}`;

    const defaultPermanentConditional = `// [打上标签时] -> ⚡ API 插入块测试

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        await dispatch("api.block.insert", { dataType: "markdown", data: "[Permanent Init] Inserted at {{time}}", previousID: "{{block_id}}" });
    }
}`;

    const defaultTaskConditional = `// [打上标签时] -> ☑ 转换为任务
// [移除标签时] -> ☑ 转换为任务
// [任务完成时] -> 🎆 烟花

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created" || eventName === "tag_removed") {
        await dispatch("plugin-index.command.turnIntoTask");
    }
    if (eventName === "task_completed") {
        await dispatch("plugin-index.effect.fireworks");
    }
}`;

    const typeCount = db.exec(`SELECT count(*) FROM ${TABLE_TYPES}`)[0].values[0][0];

    if (typeCount === 0) {
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Icon_Menu, Conditional) VALUES (?, ?, ?, ?)`, 
            ["20260526204605-v11e2ta", "task", "", defaultTaskConditional]);
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Icon_Menu, Conditional) VALUES (?, ?, ?, ?)`, 
            ["20260721140000-pipeline", "pipeline", "", defaultPipelineConditional]);
        db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Icon_Menu, Conditional) VALUES (?, ?, ?, ?)`, 
            ["20260721140000-permanent", "permanent", "📝 安全更新块内容", defaultPermanentConditional]);
    } else {
        try {
            // Delete project if exists in seed data
            db.run(`DELETE FROM ${TABLE_TYPES} WHERE supertag = 'project'`);

            db.run(`UPDATE ${TABLE_TYPES} SET supertag = 'task', Conditional = ?, Icon_Menu = '' WHERE supertag IN ('person', '#Person', '#task', 'task')`, [defaultTaskConditional]);
            
            // Ensure pipeline and permanent exist in development
            const checkPipe = db.exec(`SELECT count(*) FROM ${TABLE_TYPES} WHERE supertag = 'pipeline'`);
            if (Number(checkPipe?.[0]?.values?.[0]?.[0] || 0) === 0) {
                db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Icon_Menu, Conditional) VALUES (?, ?, ?, ?)`, 
                    ["20260721140000-pipeline", "pipeline", "", defaultPipelineConditional]);
            } else {
                db.run(`UPDATE ${TABLE_TYPES} SET Conditional = ?, Icon_Menu = '' WHERE supertag = 'pipeline'`, [defaultPipelineConditional]);
            }

            const checkPerm = db.exec(`SELECT count(*) FROM ${TABLE_TYPES} WHERE supertag = 'permanent'`);
            if (Number(checkPerm?.[0]?.values?.[0]?.[0] || 0) === 0) {
                db.run(`INSERT INTO ${TABLE_TYPES} (rowID, supertag, Icon_Menu, Conditional) VALUES (?, ?, ?, ?)`, 
                    ["20260721140000-permanent", "permanent", "📝 安全更新块内容", defaultPermanentConditional]);
            } else {
                db.run(`UPDATE ${TABLE_TYPES} SET Conditional = ?, Icon_Menu = '📝 安全更新块内容' WHERE supertag = 'permanent'`, [defaultPermanentConditional]);
            }
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
