export const NOTEBOOK_NAME = "IndexOS";
export const NOTEBOOK_ICON = "1f42c"; // 🐬

import commandsData from "../registry/commands.json";

// ════════════════════════════════════════════════════════════════════
// 种子数据（唯一定义点）
//
// 设计规则：
//   1. 未实例化时，运行时读这里的 TS 常量（不再有 sys_command_db / sys_type_db 表）。
//   2. 实例化时，constructCommandStorage 把这些常量一次性物化到思源 AV 中。
//   3. 实例化之后，种子数据不再参与任何运行时路径，数据源是思源 AV。
//   4. 种子常量只读，运行时禁止写入。
// ════════════════════════════════════════════════════════════════════

export interface SeedCommandRow {
    rowID: string;
    label: string;
    commandID: string;
    inputMapping: string;
    outputMapping: string;
}

export interface SeedSupertagRow {
    rowID: string;
    supertag: string;
    /** 逗号分隔的命令 ID / 名称，写入 AV 的 Icon Menu 列 */
    iconMenu: string;
    /** 条件触发脚本（与 AV Conditional 列同格式） */
    conditional: string;
}

/** Layer 2 种子行：从 commands.json 的 seed 字段派生 */
export function getSeedCommandRows(): SeedCommandRow[] {
    const rows: SeedCommandRow[] = [];
    for (const cmd of (commandsData as any).commands) {
        const s = cmd.seed;
        if (!s) continue;
        const hasOutputs = cmd.outputs && Array.isArray(cmd.outputs) && cmd.outputs.length > 0;
        const outputMapping = s.outputMapping || (hasOutputs ? "{}" : "");
        rows.push({
            rowID: s.rowID,
            label: s.label,
            commandID: cmd.id,
            inputMapping: s.inputMapping || s.paramMapping || "",
            outputMapping
        });
    }
    return rows;
}

const defaultPipelineConditional = `// [打上标签时] -> ➕ 在下方插入块, 📝 安全更新块内容

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        const step1 = await dispatch("plugin-index.command.insertBlockBelow", { insertType: "p", data: "[Pipeline Step 1] Time: {{time}}", id: "{{block_id}}" });
        const createdId = step1?.id || state.vars?.createdblock;
        if (createdId) {
            await dispatch("plugin-index.command.safeUpdateBlock", { id: createdId, dataType: "markdown", data: "[Pipeline Step 2] Updated newly created block at {{time}}" });
        }
    }
}`;

const defaultPermanentConditional = `// [打上标签时] -> ➕ 在下方插入块

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        await dispatch("plugin-index.command.insertBlockBelow", { insertType: "p", data: "[Permanent Init] Inserted at {{time}}", id: "{{block_id}}" });
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

/** Layer 3 种子行：内置 Supertag 及其绑定 */
export function getSeedSupertagRows(): SeedSupertagRow[] {
    return [
        { rowID: "20260526204605-v11e2ta", supertag: "task", iconMenu: "", conditional: defaultTaskConditional },
        { rowID: "20260721140000-pipeline", supertag: "pipeline", iconMenu: "", conditional: defaultPipelineConditional },
        { rowID: "20260721140000-permanent", supertag: "permanent", iconMenu: JSON.stringify({ menu: [{ id: "plugin-index.command.safeUpdateBlock" }], button: [] }), conditional: defaultPermanentConditional }
    ];
}

/** 未实例化时按 cleanTag 查找内置 Conditional 脚本 */
export function getSeedConditionalScript(cleanTag: string): string {
    const tag = cleanTag.replace(/^#/, "").trim().toLowerCase();
    return getSeedSupertagRows().find(r => r.supertag.toLowerCase() === tag)?.conditional || "";
}

export interface ColumnMeta {
    name: string;
    type: string;
    icon: string;
}

export interface DbPageConfig {
    title: string;
    attrName: string;
    markdown: string;
    expectedColName: string;
    columns: ColumnMeta[];
}

export const COMMAND_DB_CONFIG: DbPageConfig = {
    title: "command-db",
    attrName: "custom-index-command-db",
    markdown: `该页面由 IndexOS 自动生成。这里是系统的 Layer 2，用于编排复合指令和参数流转。\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>\n`,
    expectedColName: "Command ID",
    columns: [
        { name: "Command ID", type: "text", icon: "iconCode" },
        { name: "Input", type: "text", icon: "iconList" },
        { name: "Output", type: "text", icon: "iconCheck" },
        { name: "Pipeline 定义", type: "text", icon: "iconCode" }
    ]
};

export const TYPE_DB_CONFIG: DbPageConfig = {
    title: "supertag-db",
    attrName: "custom-index-supertag-db",
    markdown: `该页面由 IndexOS 自动生成。这里是系统的 Layer 3，用于将逻辑工厂中的复合命令绑定到特定的 Supertag 上，并配置参数映射。**主键（第一列）即为需要绑定的 Supertag 名称（如 project 或 任何类名）。**\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>\n`,
    expectedColName: "Icon menu & button",
    columns: [
        { name: "Icon menu & button", type: "text", icon: "iconMenu" },
        { name: "Conditional", type: "text", icon: "iconPlay" }
    ]
};

export const DATA_DBS_CONFIG = {
    title: "data-dbs",
    attrName: "custom-index-data-dbs"
};

export interface DefaultRelationRule {
    typeLabel: string;
    iconMenuCmdIds: string[];
    relationCmdIds: string[];
}

export const DEFAULT_RELATION_BINDINGS: DefaultRelationRule[] = [
    {
        typeLabel: "task",
        iconMenuCmdIds: [],
        relationCmdIds: ["plugin-index.command.turnIntoTask", "plugin-index.effect.fireworks"]
    },
    {
        typeLabel: "pipeline",
        iconMenuCmdIds: [],
        relationCmdIds: ["plugin-index.command.insertBlockBelow", "plugin-index.command.safeUpdateBlock"]
    },
    {
        typeLabel: "permanent",
        iconMenuCmdIds: ["plugin-index.command.safeUpdateBlock"],
        relationCmdIds: ["plugin-index.command.insertBlockBelow", "plugin-index.command.safeUpdateBlock"]
    }
];

export const BUILTIN_SUPERTAGS = new Set(["task", "pipeline", "permanent"]);
