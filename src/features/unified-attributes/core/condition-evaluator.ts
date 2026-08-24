/**
 * condition-evaluator.ts
 *
 * 统一条件断言 (Condition/Predicate) 求值引擎
 * 适用于：
 * 1. 触发器前置门禁断言 (Auto Trigger Early-Guard)
 * 2. 虚拟按钮动态显隐 (Virtual Button Condition)
 * 3. 复合指令 IF 节点分支判定 (Composite Command IF Step)
 *
 * 特性：
 * - 纯内存求值，微秒级（<0.1ms）完成计算；
 * - 拒绝冗余，不写无意义的函数兜底（如 isEmpty 已废弃，统一使用 == '' 与 != ''）；
 * - 深度支持：文本包含/反向包含/前缀/后缀/正则，属性等值/不等/集合包含/数值比对，以及 && / || 复合逻辑。
 */

export interface ConditionContext {
    id?: string;
    attrs?: Record<string, string>;
    content?: string;
    markdown?: string;
    tags?: string[];
    type?: string;
    subType?: string;
}

/**
 * 通用条件求值入口
 */
export function evaluateCondition(conditionStr: string | undefined, ctx: ConditionContext): boolean {
    if (!conditionStr || !conditionStr.trim()) return true;

    const trimmed = conditionStr.trim();

    // 1. 处理顶级 OR (|| 或 或)
    const orClauses = splitLogicalClauses(trimmed, ["||", " 或 "]);
    if (orClauses.length > 1) {
        return orClauses.some(c => evaluateCondition(c, ctx));
    }

    // 2. 处理顶级 AND (&& 或 ＆＆ 或 与 或 英文逗号/中文逗号)
    const andClauses = splitLogicalClauses(trimmed, ["&&", "＆＆", " 与 ", ",", "，"]);
    for (const clause of andClauses) {
        if (!evaluateSingleClause(clause, ctx)) {
            return false;
        }
    }
    return true;
}

/**
 * 辅助函数：安全分割逻辑运算符（避免切分字符串引号内部的内容）
 */
function splitLogicalClauses(expr: string, operators: string[]): string[] {
    const results: string[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";
    let parenDepth = 0;

    let i = 0;
    while (i < expr.length) {
        const char = expr[i];

        if (inQuotes) {
            if (char === quoteChar && expr[i - 1] !== "\\") {
                inQuotes = false;
            }
            current += char;
            i++;
            continue;
        }

        if (char === '"' || char === "'" || char === "`") {
            inQuotes = true;
            quoteChar = char;
            current += char;
            i++;
            continue;
        }

        if (char === "(") parenDepth++;
        else if (char === ")") parenDepth--;

        if (parenDepth === 0) {
            let matchedOp: string | null = null;
            for (const op of operators) {
                if (expr.startsWith(op, i)) {
                    matchedOp = op;
                    break;
                }
            }

            if (matchedOp) {
                if (current.trim()) results.push(current.trim());
                current = "";
                i += matchedOp.length;
                continue;
            }
        }

        current += char;
        i++;
    }

    if (current.trim()) results.push(current.trim());
    return results.length > 0 ? results : [expr];
}

function normalizeVal(val: string): string {
    return val.trim().replace(/^['"`‘’“”]|['"`‘’“”]$/g, "").trim();
}

function getAttrVal(key: string, ctx: ConditionContext): string {
    const cleanKey = key.trim();
    if (cleanKey === "content" || cleanKey === "markdown" || cleanKey === "text") {
        return ctx.content || ctx.markdown || "";
    }
    if (cleanKey === "type") return ctx.type || "";
    if (cleanKey === "subtype" || cleanKey === "subType") return ctx.subType || "";
    if (cleanKey === "id") return ctx.id || "";
    if (cleanKey === "supertags" || cleanKey === "custom-supertags" || cleanKey === "tags") {
        if (ctx.tags && ctx.tags.length > 0) return JSON.stringify(ctx.tags);
    }

    const attrs = ctx.attrs || {};
    if (attrs[cleanKey] !== undefined) return attrs[cleanKey];
    if (attrs[`custom-${cleanKey}`] !== undefined) return attrs[`custom-${cleanKey}`];
    const stripped = cleanKey.replace(/^custom-/, "");
    if (attrs[stripped] !== undefined) return attrs[stripped];
    return "";
}

/**
 * 求值单个原子表达式
 */
function evaluateSingleClause(clause: string, ctx: ConditionContext): boolean {
    let c = clause.trim();
    if (!c) return true;

    // 括号剥离
    if (c.startsWith("(") && c.endsWith(")")) {
        c = c.slice(1, -1).trim();
    }

    // 归一化全角运算符
    c = c.replace(/！=/g, "!=").replace(/＝＝/g, "==");

    // 检查整体否定 !
    if (c.startsWith("!") && !c.startsWith("!=")) {
        return !evaluateSingleClause(c.slice(1).trim(), ctx);
    }

    const contentStr = ctx.content || ctx.markdown || "";

    // 1. content/text 文本前缀匹配: content starts_with 'BUG:' 或 content 开头为 'TODO:'
    const startsMatch = c.match(/^(?:content|text|markdown)\s+(?:starts_with|开头为|startswith)\s+(.+)$/i);
    if (startsMatch) {
        const target = normalizeVal(startsMatch[1]);
        return contentStr.startsWith(target);
    }

    // 2. content/text 文本后缀匹配: content ends_with '!!!' 或 content 结尾为 '!!!'
    const endsMatch = c.match(/^(?:content|text|markdown)\s+(?:ends_with|结尾为|endswith)\s+(.+)$/i);
    if (endsMatch) {
        const target = normalizeVal(endsMatch[1]);
        return contentStr.endsWith(target);
    }

    // 3. content/text 文本正则匹配: content matches '^\[P[0-2]\]' 或 content 正则 '/pattern/i'
    const regexMatch = c.match(/^(?:content|text|markdown)\s+(?:matches|正则|match)\s+(.+)$/i);
    if (regexMatch) {
        let patternStr = normalizeVal(regexMatch[1]);
        let flags = "";
        if (patternStr.startsWith("/") && patternStr.lastIndexOf("/") > 0) {
            const lastSlash = patternStr.lastIndexOf("/");
            flags = patternStr.slice(lastSlash + 1);
            patternStr = patternStr.slice(1, lastSlash);
        }
        try {
            const re = new RegExp(patternStr, flags);
            return re.test(contentStr);
        } catch (_) {
            return false;
        }
    }

    // 4. content/text 反向不包含匹配: content not_includes 'xxx' 或 content 不包含 'xxx'
    const notIncludesMatch = c.match(/^(?:content|text|markdown)\s+(?:not_includes|不包含|!includes)\s+(.+)$/i);
    if (notIncludesMatch) {
        const target = normalizeVal(notIncludesMatch[1]);
        return !contentStr.includes(target);
    }

    // 5. content/text 包含匹配: content includes 'xxx' 或 content 包含 'xxx'
    const includesMatch = c.match(/^(?:content|text|markdown)\s+(?:includes|包含)\s+(.+)$/i);
    if (includesMatch) {
        const target = normalizeVal(includesMatch[1]);
        return contentStr.includes(target);
    }

    // 6. 属性集合包含: key in ('a', 'b') 或 key not in ('a', 'b')
    const notInMatch = c.match(/^(.+?)\s+not\s+in\s*\((.+?)\)$/i);
    if (notInMatch) {
        const key = notInMatch[1].trim();
        const items = notInMatch[2].split(",").map(normalizeVal);
        const actual = getAttrVal(key, ctx);
        return !items.includes(actual);
    }

    const inMatch = c.match(/^(.+?)\s+in\s*\((.+?)\)$/i);
    if (inMatch) {
        const key = inMatch[1].trim();
        const items = inMatch[2].split(",").map(normalizeVal);
        const actual = getAttrVal(key, ctx);
        return items.includes(actual);
    }

    // 7. 属性包含 (用于 supertags/tags 等数组串检查: supertags includes 'task')
    const attrIncludesMatch = c.match(/^([a-zA-Z0-9_\-]+)\s+(?:includes|包含)\s+(.+)$/i);
    if (attrIncludesMatch) {
        const key = attrIncludesMatch[1].trim();
        const target = normalizeVal(attrIncludesMatch[2]);
        const actual = getAttrVal(key, ctx);
        return actual.toLowerCase().includes(target.toLowerCase());
    }

    // 8. 数值大于等于/小于等于比较: >=, <=, >, <
    const numOpMatch = c.match(/^([a-zA-Z0-9_\-]+)\s*(>=|<=|>|<)\s*(.+)$/);
    if (numOpMatch) {
        const key = numOpMatch[1].trim();
        const op = numOpMatch[2].trim();
        const expectedNum = Number(normalizeVal(numOpMatch[3]));
        const actualNum = Number(getAttrVal(key, ctx));

        if (!isNaN(expectedNum) && !isNaN(actualNum)) {
            if (op === ">=") return actualNum >= expectedNum;
            if (op === "<=") return actualNum <= expectedNum;
            if (op === ">") return actualNum > expectedNum;
            if (op === "<") return actualNum < expectedNum;
        }
    }

    // 9. 不等判断: key != 'val' 或 key <> 'val'
    if (c.includes("!=") || c.includes("<>")) {
        const sep = c.includes("!=") ? "!=" : "<>";
        const [k, v] = c.split(sep).map(s => s.trim());
        const expected = normalizeVal(v);
        const actual = getAttrVal(k, ctx);
        if (expected === "" || expected === "null" || expected === "undefined") {
            return actual !== "";
        }
        return actual !== expected;
    }

    // 10. 等于判断: key == 'val' 或 key = 'val'
    if (c.includes("==") || c.includes("=")) {
        const [k, v] = c.includes("==") ? c.split("==").map(s => s.trim()) : c.split("=").map(s => s.trim());
        const expected = normalizeVal(v);
        const actual = getAttrVal(k, ctx);
        if (expected === "" || expected === "null" || expected === "undefined") {
            return actual === "";
        }
        return actual === expected;
    }

    // 11. 单变量真值判断 (如 is_archived 或 key_name)
    const val = getAttrVal(c, ctx);
    return Boolean(val && val !== "false" && val !== "0");
}

/** 常用预设显示与前置条件胶囊 */
export const PRESET_CONDITIONS = [
    { label: "未完成状态", filter: "status != 'done'" },
    { label: "待处理状态", filter: "status == 'pending'" },
    { label: "包含 TODO", filter: "content includes 'TODO'" },
    { label: "包含 BUG", filter: "content starts_with 'BUG:'" },
    { label: "高优先级", filter: "priority == 'high'" },
    { label: "未归档", filter: "archived != 'true'" }
];
