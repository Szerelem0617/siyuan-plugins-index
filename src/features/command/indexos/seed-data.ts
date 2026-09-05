import commandsData from "../registry/builtin";

// ════════════════════════════════════════════════════════════════════
// 种子数据（唯一定义点）
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
    /** 手动交互命令 JSON 数组字符串 */
    manual?: string;
    /** 自动条件触发脚本（TypeScript DSL） */
    auto?: string;
    /** 命令侧核心字段模式（JSON 数组） */
    schema?: string;
    /** 兼容旧字段 */
    iconMenu?: string;
    conditional?: string;
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
        await dispatch("index.insertContentBelow", {
            insertType: "p",
            data: "[Permanent Init] Inserted at {{time}}",
            id: "{{block_id}}",
            _saveOutputs: ["createdblock"]
        });
    }
}`;

const defaultTaskConditional = `// [打上标签时] -> ☑ 转换为任务
// [移除标签时] -> ☑ 清空任务状态
// [任务完成时] -> 🎆 视觉特效 (烟花)

async ({ dispatch, state, eventName }) => {
    if (eventName === "tag_created") {
        await dispatch("index.setBlockAttribute", { attrs: "global.task: pending" });
    }
    if (eventName === "tag_removed") {
        await dispatch("index.setBlockAttribute", { attrs: "global.task: " });
    }
    if (eventName === "task_completed") {
        await dispatch("index.visualEffect", { type: "fireworks" });
    }
}`;

const defaultProjectConditional = `// 名称: #project 级联任务标记
// 事件: block_created

async ({ dispatch, state, eventName }) => {
    if (["block_created"].includes(eventName)) {
        // [Scope: subtree, Filter: list]
        await dispatch("index.addSupertag", {
            id: "{{id}}",
            tag: "task"
        });
    }
} `;

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
            auto: defaultTaskConditional,
            schema: JSON.stringify([
                { name: "status", label: "状态", type: "select", options: [{ id: "opt_todo", name: "Todo", color: "1" }, { id: "opt_doing", name: "Doing", color: "4" }, { id: "opt_done", name: "Done", color: "8" }] },
                { name: "priority", label: "优先级", type: "select", options: [{ id: "opt_p0", name: "P0", color: "2" }, { id: "opt_p1", name: "P1", color: "3" }, { id: "opt_p2", name: "P2", color: "4" }, { id: "opt_p3", name: "P3", color: "7" }] },
                { name: "due", label: "截止时间", type: "date" }
            ])
        },
        {
            rowID: "20260821113000-project",
            supertag: "project",
            manual: JSON.stringify([
                { id: "index.addSupertag", showInSlash: true, showInMenu: true, showInButton: false, showInVirtualButton: false }
            ]),
            auto: defaultProjectConditional,
            schema: JSON.stringify([
                { name: "status", label: "状态", type: "select", options: [{ id: "opt_plan", name: "Planning", color: "7" }, { id: "opt_prog", name: "In Progress", color: "4" }, { id: "opt_comp", name: "Completed", color: "8" }] },
                { name: "progress", label: "进度", type: "number" }
            ])
        },
        {
            rowID: "20260721140000-composite",
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

export const BUILTIN_SUPERTAGS = new Set(["task", "composite", "permanent", "project"]);
