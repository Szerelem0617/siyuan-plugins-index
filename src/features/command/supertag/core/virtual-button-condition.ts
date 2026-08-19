/**
 * virtual-button-condition.ts
 * 虚拟按钮条件 (Virtual Button Condition) 求值引擎
 * 用于 Virtual Button 虚拟悬浮按钮等组件的条件感知动态展示
 *
 * 支持语法：
 * 1. 属性相等判断: status == 'pending' 或 status = pending (支持中英文 ＝＝ 与 ==)
 * 2. 属性不等判断: status != 'done' 或 status ！= 'done' (支持中英文 ！= 与 != 与 <>)
 * 3. 空值/非空判断: status == '' (空) 或 status != '' (非空)
 * 4. 内容包含判断: content includes '待办' 或 content 包含 '待办'
 * 5. 复合条件: 支持 && 或 ＆＆ 或逗号连接
 */

export interface VirtualButtonConditionContext {
    id: string;
    attrs: Record<string, string>;
    content?: string;
    type?: string;
}

export function evaluateVirtualButtonCondition(conditionStr: string | undefined, ctx: VirtualButtonConditionContext): boolean {
    if (!conditionStr || !conditionStr.trim()) return true;

    const trimmed = conditionStr.trim();
    // 分割 && 或 ＆＆ 或英文逗号/中文逗号
    const clauses = trimmed.split(/&&|＆＆|,|，/).map(s => s.trim()).filter(Boolean);

    for (const clause of clauses) {
        if (!evaluateSingleClause(clause, ctx)) {
            return false;
        }
    }
    return true;
}

function normalizeVal(val: string): string {
    return val.trim().replace(/^['"`‘’“”]|['"`‘’“”]$/g, "").trim();
}

function getAttrVal(key: string, attrs: Record<string, string>): string {
    const cleanKey = key.trim();
    if (attrs[cleanKey] !== undefined) return attrs[cleanKey];
    if (attrs[`custom-${cleanKey}`] !== undefined) return attrs[`custom-${cleanKey}`];
    const stripped = cleanKey.replace(/^custom-/, "");
    if (attrs[stripped] !== undefined) return attrs[stripped];
    return "";
}

function evaluateSingleClause(clause: string, ctx: VirtualButtonConditionContext): boolean {
    let c = clause.trim();
    if (!c) return true;

    // 归一化全角/中文运算符
    c = c.replace(/！=/g, "!=").replace(/＝＝/g, "==");

    // 1. content includes 'xxx' 或 content 包含 'xxx'
    const includesMatch = c.match(/^content\s+(?:includes|包含)\s+(.+)$/i);
    if (includesMatch) {
        const target = normalizeVal(includesMatch[1]);
        return (ctx.content || "").includes(target);
    }

    // 2. key != value (不等于判断，支持 key != '' 或 key != 'done')
    if (c.includes("!=") || c.includes("<>")) {
        const sep = c.includes("!=") ? "!=" : "<>";
        const [k, v] = c.split(sep).map(s => s.trim());
        const expected = normalizeVal(v);
        const actual = getAttrVal(k, ctx.attrs);
        if (expected === "" || expected === "null" || expected === "undefined") {
            return actual !== "";
        }
        return actual !== expected;
    }

    // 3. key == value or key = value (等于判断，支持 key == '' 或 key == 'pending')
    if (c.includes("==") || c.includes("=")) {
        const [k, v] = c.includes("==") ? c.split("==").map(s => s.trim()) : c.split("=").map(s => s.trim());
        const expected = normalizeVal(v);
        const actual = getAttrVal(k, ctx.attrs);
        if (expected === "" || expected === "null" || expected === "undefined") {
            return actual === "";
        }
        return actual === expected;
    }

    // 4. 兼容 isEmpty(key) / isNotEmpty(key)
    const emptyMatch = c.match(/^isEmpty\((.+?)\)$/i);
    if (emptyMatch) {
        return !getAttrVal(emptyMatch[1].trim(), ctx.attrs);
    }
    const notEmptyMatch = c.match(/^isNotEmpty\((.+?)\)$/i);
    if (notEmptyMatch) {
        return Boolean(getAttrVal(notEmptyMatch[1].trim(), ctx.attrs));
    }

    // 5. 兜底：单独 key 名（真值判断）
    const val = getAttrVal(c, ctx.attrs);
    return Boolean(val && val !== "false" && val !== "0");
}

/** 常用预设显示条件胶囊 (Condition) */
export const PRESET_CONDITIONS = [
    { label: "未完成状态", filter: "status != 'done'" },
    { label: "待处理状态", filter: "status == 'pending'" },
    { label: "高优先级", filter: "priority == 'high'" },
    { label: "未归档", filter: "archived != 'true'" },
    { label: "状态为空", filter: "status == ''" },
    { label: "状态非空", filter: "status != ''" }
];
