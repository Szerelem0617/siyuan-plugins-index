export const NOTEBOOK_NAME = "IndexOS";
export const NOTEBOOK_ICON = "1f42c"; // 🐬

import commandsData from "../registry/builtin";

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

/** Layer 2 种子行：从 commands.json 的 seed/seeds 字段派生 */
export function getSeedCommandRows(): SeedCommandRow[] {
    const rows: SeedCommandRow[] = [];
    for (const cmd of (commandsData as any).commands) {
        const seeds = Array.isArray(cmd.seeds) ? cmd.seeds : (cmd.seed ? [cmd.seed] : []);
        if (seeds.length === 0) continue;
        const hasParams = cmd.params && Array.isArray(cmd.params) && cmd.params.length > 0;
        const hasOutputs = cmd.outputs && Array.isArray(cmd.outputs) && cmd.outputs.length > 0;

        for (let i = 0; i < seeds.length; i++) {
            const s = seeds[i];
            let inputMapping = (s.inputMapping || s.paramMapping || "").trim();
            if (!inputMapping && hasParams) {
                inputMapping = "{}";
            }

            let outputMapping = (s.outputMapping || "").trim();
            if (!outputMapping && hasOutputs) {
                outputMapping = "{}";
            }

            const commandID = (s.commandID || (i === 0 ? cmd.id : `${cmd.id}-${i}`)).trim();
            const rowID = (s.rowID || `20260821000000-${cmd.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 7)}${i}`).trim();
            const label = (s.label || cmd.name || cmd.id).trim();

            rows.push({
                rowID,
                label,
                commandID,
                inputMapping,
                outputMapping
            });
        }
    }
    return rows;
}

const defaultPipelineConditional = `// [打上标签时] -> ➕ 在下方新建内容, 📝 更新块内容

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        const step1 = await dispatch("index.insertContentBelow", { insertType: "p", data: "[Pipeline Step 1] Time: {{time}}", id: "{{block_id}}" });
        const createdId = step1?.id || state.vars?.createdblock;
        if (createdId) {
            await dispatch("index.safeUpdateBlock", { id: createdId, dataType: "markdown", data: "[Pipeline Step 2] Updated newly created block at {{time}}" });
        }
    }
}`;

const defaultPermanentConditional = `// [打上标签时] -> ➕ 在下方新建内容

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        await dispatch("index.insertContentBelow", { insertType: "p", data: "[Permanent Init] Inserted at {{time}}", id: "{{block_id}}" });
    }
}`;

const defaultTaskConditional = `// [打上标签时] -> ☑ 转换为任务
// [移除标签时] -> ☑ 转换为任务
// [任务完成时] -> 🎆 视觉特效 (烟花)

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created" || eventName === "tag_removed") {
        await dispatch("index.setBlockAttribute-1");
    }
    if (eventName === "task_completed") {
        await dispatch("index.visualEffect", { type: "fireworks" });
    }
}`;

const defaultProjectConditional = `// 名称: #project 级联任务标记
// 事件: block_created, block_content_changed

async ({ dispatch, state, eventName }) => {
    if (["block_created", "block_content_changed"].includes(eventName)) {
        // [Scope: subtree, Filter: todo]
        await dispatch("index.addSupertag", {
            tag: "task"
        });
    }
}`;

/** Layer 3 种子行：内置 Supertag 及其绑定 */
export function getSeedSupertagRows(): SeedSupertagRow[] {
    return [
        {
            rowID: "20260526204605-v11e2ta",
            supertag: "task",
            manual: JSON.stringify([
                { id: "index.setBlockAttribute", showInSlash: true, showInMenu: true, showInButton: false, showInVirtualButton: false },
                { id: "index.visualEffect", showInSlash: true, showInMenu: true, showInButton: false, showInVirtualButton: false }
            ]),
            auto: defaultTaskConditional
        },
        {
            rowID: "20260821113000-project",
            supertag: "project",
            manual: JSON.stringify([
                { id: "index.addSupertag", showInSlash: true, showInMenu: true, showInButton: false, showInVirtualButton: false }
            ]),
            auto: defaultProjectConditional
        },
        {
            rowID: "20260721140000-pipeline",
            supertag: "composite",
            manual: JSON.stringify([
                { id: "index.insertContentBelow", showInSlash: true, showInMenu: true, showInButton: false, showInVirtualButton: false },
                { id: "index.safeUpdateBlock", showInSlash: true, showInMenu: true, showInButton: false, showInVirtualButton: false }
            ]),
            auto: defaultPipelineConditional
        },
        {
            rowID: "20260721140000-permanent",
            supertag: "permanent",
            manual: JSON.stringify([
                { id: "index.safeUpdateBlock", showInSlash: true, showInMenu: true, showInButton: false, showInVirtualButton: false }
            ]),
            auto: defaultPermanentConditional
        }
    ];
}

/** 未实例化时按 cleanTag 查找内置 Auto / Conditional 脚本 */
export function getSeedConditionalScript(cleanTag: string): string {
    const tag = cleanTag.replace(/^#/, "").trim().toLowerCase();
    const row = getSeedSupertagRows().find(r => r.supertag.toLowerCase() === tag);
    return row?.auto || row?.conditional || "";
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
        { name: "Composite", type: "text", icon: "iconCode" }
    ]
};

export const TYPE_DB_CONFIG: DbPageConfig = {
    title: "supertag-db",
    attrName: "custom-index-supertag-db",
    markdown: `该页面由 IndexOS 自动生成。这里是系统的 Layer 3，用于将逻辑工厂中的复合命令绑定到特定的 Supertag 上，并配置参数映射与关联数据库。**主键（第一列）即为需要绑定的 Supertag 名称（如 project 或 任何标签名）。**\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>\n`,
    expectedColName: "Manual",
    columns: [
        { name: "Manual", type: "text", icon: "iconMenu" },
        { name: "Auto", type: "text", icon: "iconPlay" },
        { name: "related_av", type: "text", icon: "iconDatabase" }
    ]
};

export const DATA_DBS_CONFIG = {
    title: "data-dbs",
    attrName: "custom-index-data-dbs"
};

export const BUILTIN_SUPERTAGS = new Set(["task", "pipeline", "permanent", "project"]);
