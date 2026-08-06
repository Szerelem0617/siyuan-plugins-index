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
    paramMapping: string;
    /** 单选入口（顶栏等"只选一个"的位置）；空 = 不注册 */
    uiEntry: string;
    /** 多选入口（按钮 / 命令面板等），逗号分隔 */
    uiEntries: string;
}

export interface SeedSupertagRow {
    rowID: string;
    supertag: string;
    /** 逗号分隔的命令 ID / 名称，写入 AV 的 Icon Menu 列 */
    iconMenu: string;
    /** 条件触发脚本（与 AV Conditional 列同格式） */
    conditional: string;
}

const UI_SINGLE_LABELS: Record<string, string> = {
    topbar: "顶栏右"
};

/** "UI 入口" 单选列的可选位置（与 top-bar.ts 的位置映射一致） */
export const UI_ENTRY_OPTIONS = [
    "顶栏右",
    "顶栏左",
    "底栏右",
    "底栏左",
    "侧栏左",
    "侧栏右"
];

const UI_MULTI_LABELS: Record<string, string> = {
    inline: "行内按钮",
    palette: "快捷命令"
};

/** Layer 2 种子行：从 commands.json 的 seed 字段派生 */
export function getSeedCommandRows(): SeedCommandRow[] {
    const rows: SeedCommandRow[] = [];
    for (const cmd of (commandsData as any).commands) {
        const s = cmd.seed;
        if (!s) continue;
        const mapped: string[] = [];
        let single = "";
        if (s.uiEntries) {
            for (const code of s.uiEntries) {
                const sLabel = UI_SINGLE_LABELS[code];
                const mLabel = UI_MULTI_LABELS[code];
                if (sLabel) single = sLabel;
                if (mLabel) mapped.push(mLabel);
            }
        }
        rows.push({
            rowID: s.rowID,
            label: s.label,
            commandID: cmd.id,
            paramMapping: s.paramMapping || "",
            uiEntry: single,
            uiEntries: mapped.join(", ")
        });
    }
    return rows;
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

/** Layer 3 种子行：内置 Supertag 及其绑定 */
export function getSeedSupertagRows(): SeedSupertagRow[] {
    return [
        { rowID: "20260526204605-v11e2ta", supertag: "task", iconMenu: "", conditional: defaultTaskConditional },
        { rowID: "20260721140000-pipeline", supertag: "pipeline", iconMenu: "", conditional: defaultPipelineConditional },
        { rowID: "20260721140000-permanent", supertag: "permanent", iconMenu: "plugin-index.command.safeUpdateBlock", conditional: defaultPermanentConditional }
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
        { name: "UI 入口", type: "select", icon: "iconLayout" },
        { name: "按钮 & 命令面板", type: "mSelect", icon: "iconPlay" },
        { name: "Param Mapping", type: "text", icon: "iconList" },
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
        relationCmdIds: ["api.block.insert", "plugin-index.command.safeUpdateBlock"]
    },
    {
        typeLabel: "permanent",
        iconMenuCmdIds: ["plugin-index.command.safeUpdateBlock"],
        relationCmdIds: ["api.block.insert", "plugin-index.command.safeUpdateBlock"]
    }
];

export const BUILTIN_SUPERTAGS = new Set(["task", "pipeline", "permanent"]);
