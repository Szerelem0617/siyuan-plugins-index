/**
 * block-filter.ts
 * 块过滤条件 (Block Filter) 求值引擎
 * 用于 Virtual Button 虚拟悬浮按钮等组件的条件感知动态展示
 *
 * 支持语法：
 * 1. 属性相等判断: custom-status == pending 或 status == 'pending'
 * 2. 属性不等判断: custom-status != done
 * 3. 内容包含判断: content includes '[ ]' 或 content includes '待办'
 * 4. 空值函数: isEmpty(custom-status) / isNotEmpty(custom-status)
 * 5. 复合条件: 支持 && 或逗号分隔多个条件
 */

export interface BlockFilterContext {
    id: string;
    attrs: Record<string, string>;
    content?: string;
    type?: string;
}

export function evaluateBlockFilter(filterStr: string | undefined, ctx: BlockFilterContext): boolean {
    if (!filterStr || !filterStr.trim()) return true;

    const trimmed = filterStr.trim();
    // 分割 && 或逗号
    const clauses = trimmed.split(/&&|,/).map(s => s.trim()).filter(Boolean);

    for (const clause of clauses) {
        if (!evaluateSingleClause(clause, ctx)) {
            return false;
        }
    }
    return true;
}

function normalizeVal(val: string): string {
    return val.trim().replace(/^['"`]|['"`]$/g, "");
}

function getAttrVal(key: string, attrs: Record<string, string>): string {
    const cleanKey = key.trim();
    if (attrs[cleanKey] !== undefined) return attrs[cleanKey];
    if (attrs[`custom-${cleanKey}`] !== undefined) return attrs[`custom-${cleanKey}`];
    const stripped = cleanKey.replace(/^custom-/, "");
    if (attrs[stripped] !== undefined) return attrs[stripped];
    return "";
}

function evaluateSingleClause(clause: string, ctx: BlockFilterContext): boolean {
    const c = clause.trim();
    if (!c) return true;

    // 1. isEmpty(key)
    const emptyMatch = c.match(/^isEmpty\((.+?)\)$/i);
    if (emptyMatch) {
        const key = emptyMatch[1].trim();
        const val = getAttrVal(key, ctx.attrs);
        return !val;
    }

    // 2. isNotEmpty(key)
    const notEmptyMatch = c.match(/^isNotEmpty\((.+?)\)$/i);
    if (notEmptyMatch) {
        const key = notEmptyMatch[1].trim();
        const val = getAttrVal(key, ctx.attrs);
        return Boolean(val);
    }

    // 3. content includes 'xxx'
    const includesMatch = c.match(/^content\s+includes\s+(.+)$/i);
    if (includesMatch) {
        const target = normalizeVal(includesMatch[1]);
        return (ctx.content || "").includes(target);
    }

    // 4. key != value
    if (c.includes("!=")) {
        const [k, v] = c.split("!=").map(s => s.trim());
        const expected = normalizeVal(v);
        const actual = getAttrVal(k, ctx.attrs);
        return actual !== expected;
    }

    // 5. key == value or key = value
    if (c.includes("==") || c.includes("=")) {
        const [k, v] = c.includes("==") ? c.split("==").map(s => s.trim()) : c.split("=").map(s => s.trim());
        const expected = normalizeVal(v);
        const actual = getAttrVal(k, ctx.attrs);
        return actual === expected;
    }

    // 兜底：如果只是单独一个 key 名，判断其是否存在且非空
    const val = getAttrVal(c, ctx.attrs);
    return Boolean(val && val !== "false" && val !== "0");
}

export const evaluateCondition = evaluateBlockFilter;

/** 常用预设显示条件胶囊 (Condition) */
export const PRESET_CONDITIONS = [
    { label: "待办未完成", filter: "content includes '[ ]'" },
    { label: "待处理状态", filter: "custom-status == 'pending'" },
    { label: "高优先级", filter: "custom-priority == 'high'" },
    { label: "未归档", filter: "custom-archived != 'true'" },
    { label: "状态为空", filter: "isEmpty(custom-status)" }
];

export const PRESET_BLOCK_FILTERS = PRESET_CONDITIONS;
