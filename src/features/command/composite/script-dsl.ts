/**
 * composite/script-dsl.ts
 * 统一规则脚本 DSL：编辑器生成 / 强大鲁棒反向解析与多事件 Tab 支持
 */

export interface RuleCommand {
    commandRef: string;
    params: Record<string, string>;
}

export interface EventScopeFilter {
    scope?: "self" | "inner_blocks" | "current_doc" | "subtree";
    filter?: "all" | "todo" | "doc" | "heading" | "paragraph" | "av";
    condition?: string;
}

export interface RuleScript {
    name: string;
    commands: RuleCommand[];
    /** Conditional 用：触发事件列表（空 = 不限） */
    events?: string[];
    scope?: "self" | "inner_blocks" | "current_doc" | "subtree";
    filter?: "all" | "todo" | "doc" | "heading" | "paragraph" | "av";
    condition?: string;
}

export interface MultiEventRuleScript {
    name: string;
    events: string[];
    eventCommandsMap: Record<string, RuleCommand[]>;
    eventConfigsMap?: Record<string, EventScopeFilter>;
}

/** 辅助函数：从一段 JS 文本中精准提取出所有的 dispatch("cmdId", {...}) 或 dispatch("cmdId") 调用 */
export function parseDispatchCallsFromText(text: string): RuleCommand[] {
    if (!text || typeof text !== "string" || !text.includes("dispatch")) return [];
    const commands: RuleCommand[] = [];
    const dispatchHeadRegex = /dispatch\(\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = dispatchHeadRegex.exec(text)) !== null) {
        const commandRef = match[1];
        const afterMatchIndex = dispatchHeadRegex.lastIndex;
        let params: Record<string, string> = {};

        const nextCommaIndex = text.indexOf(",", afterMatchIndex);
        const nextClosingParen = text.indexOf(")", afterMatchIndex);

        // 如果在遇到右括号之前存在逗号，说明有第二个参数（params 对象）
        if (nextCommaIndex !== -1 && (nextClosingParen === -1 || nextCommaIndex < nextClosingParen)) {
            const braceStart = text.indexOf("{", nextCommaIndex);
            if (braceStart !== -1 && (nextClosingParen === -1 || braceStart < nextClosingParen)) {
                let depth = 0, inStr = false, quote = "", end = -1;
                for (let j = braceStart; j < text.length; j++) {
                    const ch = text[j];
                    if (inStr) {
                        if (ch === "\\") { j++; continue; }
                        if (ch === quote) inStr = false;
                        continue;
                    }
                    if (ch === '"' || ch === "'" || ch === "`") { inStr = true; quote = ch; continue; }
                    if (ch === "{") depth++;
                    else if (ch === "}") {
                        depth--;
                        if (depth === 0) { end = j; break; }
                    }
                }
                if (end !== -1) {
                    try {
                        const jsonStr = text.slice(braceStart, end + 1);
                        params = JSON.parse(jsonStr);
                    } catch (_) {}
                }
            }
        }
        commands.push({ commandRef, params });
    }
    return commands;
}

/** 生成多事件分支规则脚本 (每个事件 Tab 专属逻辑) */
export function generateMultiEventRuleScript(
    name: string,
    eventCommandsMap: Record<string, { commandRef: string; params: Record<string, unknown> }[]>,
    eventConfigsMap?: Record<string, EventScopeFilter>
): string {
    const events = Object.keys(eventCommandsMap);
    if (events.length === 0) return "";

    const head: string[] = [];
    if (name.trim()) head.push(`// 名称: ${name}`);
    head.push(`// 事件: ${events.join(", ")}`);

    const blocks: string[] = [];
    for (const [ev, cmds] of Object.entries(eventCommandsMap)) {
        if (!cmds || cmds.length === 0) continue;
        const cfg = eventConfigsMap?.[ev];
        const hasScope = cfg?.scope && cfg.scope !== "self";
        const hasFilter = cfg?.filter && cfg.filter !== "all";
        const hasCond = cfg?.condition && cfg.condition.trim().length > 0;
        let metaComment = "";
        if (hasScope || hasFilter || hasCond) {
            const parts = [
                `Scope: ${cfg?.scope || "self"}`,
                `Filter: ${cfg?.filter || "all"}`
            ];
            if (hasCond) {
                parts.push(`Condition: ${cfg?.condition?.trim()}`);
            }
            metaComment = `        // [${parts.join(", ")}]\n`;
        }

        const lines = cmds.map(cmd => {
            const hasParams = cmd.params && Object.keys(cmd.params).length > 0;
            if (hasParams) {
                const paramsText = JSON.stringify(cmd.params || {}, null, 2);
                return `        await dispatch(${JSON.stringify(cmd.commandRef)}, ${paramsText});`;
            } else {
                return `        await dispatch(${JSON.stringify(cmd.commandRef)});`;
            }
        });
        blocks.push(`    if (${JSON.stringify([ev])}.includes(eventName)) {\n${metaComment}${lines.join("\n")}\n    }`);
    }

    if (blocks.length === 0) {
        return generateRuleScript(name, [], events);
    }

    const body = [
        `async ({ dispatch, state, eventName }) => {`,
        blocks.join("\n\n"),
        `}`
    ];

    return [...head, ...body].join("\n");
}

/** 单序列生成规程（兼容原有逻辑） */
export function generateRuleScript(
    name: string,
    commands: { commandRef: string; params: Record<string, unknown> }[],
    events?: string[]
): string {
    const lines = commands.map(cmd => {
        const hasParams = cmd.params && Object.keys(cmd.params).length > 0;
        if (hasParams) {
            const paramsText = JSON.stringify(cmd.params || {}, null, 2);
            return `    await dispatch(${JSON.stringify(cmd.commandRef)}, ${paramsText});`;
        } else {
            return `    await dispatch(${JSON.stringify(cmd.commandRef)});`;
        }
    });

    const head: string[] = [];
    if (name.trim()) head.push(`// 名称: ${name}`);
    if (events && events.length > 0) head.push(`// 事件: ${events.join(", ")}`);

    const body = events && events.length > 0
        ? [
            `async ({ dispatch, state, eventName }) => {`,
            `    if (${JSON.stringify(events)}.includes(eventName)) {`,
            ...lines.map(l => `        ${l.trim()}`),
            `    }`,
            `}`
        ]
        : [
            `async ({ dispatch, state, eventName }) => {`,
            ...lines,
            `}`
        ];
    return [...head, ...body].join("\n");
}

/**
 * 反向解析规则脚本为多事件映射 (支持多事件 Tab 解包)
 */
export function parseMultiEventRuleScript(text: string): MultiEventRuleScript | null {
    if (!text || typeof text !== "string" || !text.includes("dispatch")) return null;

    const nameMatch = text.match(/\/\/\s*名称\s*:\s*(.+)/);
    const name = nameMatch ? nameMatch[1].trim() : "";

    // 1. 提取事件列表
    const eventsSet = new Set<string>();
    const eventsMatch = text.match(/\/\/\s*事件\s*:\s*(.+)/);
    if (eventsMatch) {
        eventsMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean).forEach(e => eventsSet.add(e));
    }
    const includesMatch = text.matchAll(/\[([^\]]+)\]\.includes\(eventName\)/g);
    for (const m of includesMatch) {
        try {
            const arr = JSON.parse(`[${m[1]}]`);
            if (Array.isArray(arr)) arr.forEach(e => eventsSet.add(String(e)));
        } catch (_) {}
    }
    const eventEqMatches = text.matchAll(/eventName\s*===\s*["']([^"']+)["']/g);
    for (const m of eventEqMatches) {
        eventsSet.add(m[1]);
    }

    const events = Array.from(eventsSet);
    const eventCommandsMap: Record<string, RuleCommand[]> = {};
    const eventConfigsMap: Record<string, EventScopeFilter> = {};

    // 针对每个事件提取其专属的 dispatch 调用与 Scope / Filter
    for (const ev of events) {
        let blockText = text;
        
        // 查找属于该事件的分支 if 语句: e.g. if (["block_content_changed"].includes(eventName)) { ... }
        // 或 if (eventName === "block_content_changed") { ... }
        const ifRegex = new RegExp(`if\\s*\\([^)]*["'\`]${ev}["'\`][^)]*\\)\\s*\\{`, "g");
        const match = ifRegex.exec(text);
        
        if (match) {
            const braceStart = match.index + match[0].length - 1; // 刚好指向匹配的 '{'
            let depth = 0, inStr = false, quote = "", end = -1;
            for (let j = braceStart; j < text.length; j++) {
                const ch = text[j];
                if (inStr) {
                    if (ch === "\\") { j++; continue; }
                    if (ch === quote) inStr = false;
                    continue;
                }
                if (ch === '"' || ch === "'" || ch === "`") { inStr = true; quote = ch; continue; }
                if (ch === "{") depth++;
                else if (ch === "}") {
                    depth--;
                    if (depth === 0) { end = j; break; }
                }
            }
            if (end !== -1) {
                blockText = text.slice(braceStart, end + 1);
            }
        } else if (events.length === 1) {
            // 如果单事件且没有分支 if 语句，则整个函数体都是它的
            blockText = text;
        }

        eventCommandsMap[ev] = parseDispatchCallsFromText(blockText);

        const metaMatch = blockText.match(/\/\/\s*\[Scope:\s*([a-zA-Z_]+)(?:,\s*Filter:\s*([a-zA-Z_]+))?(?:,\s*Condition:\s*([^\]]+))?\]/i);
        if (metaMatch) {
            eventConfigsMap[ev] = {
                scope: (metaMatch[1] as any) || "self",
                filter: (metaMatch[2] as any) || "all",
                condition: metaMatch[3] ? metaMatch[3].trim() : undefined
            };
        } else if (events.length === 1) {
            const globalMatch = text.match(/\/\/\s*\[Scope:\s*([a-zA-Z_]+)(?:,\s*Filter:\s*([a-zA-Z_]+))?(?:,\s*Condition:\s*([^\]]+))?\]/i);
            if (globalMatch) {
                eventConfigsMap[ev] = {
                    scope: (globalMatch[1] as any) || "self",
                    filter: (globalMatch[2] as any) || "all",
                    condition: globalMatch[3] ? globalMatch[3].trim() : undefined
                };
            }
        }
    }

    return {
        name,
        events,
        eventCommandsMap,
        eventConfigsMap
    };
}

export function parseRuleScript(text: string): RuleScript | null {
    if (!text || typeof text !== "string" || !text.includes("dispatch")) return null;

    const nameMatch = text.match(/\/\/\s*名称\s*:\s*(.+)/);
    const extractedName = nameMatch ? nameMatch[1].trim() : "";

    const multi = parseMultiEventRuleScript(text);
    if (multi && multi.events.length > 0) {
        const allCmds: RuleCommand[] = [];
        for (const cmds of Object.values(multi.eventCommandsMap)) {
            cmds.forEach(c => allCmds.push(c));
        }
        return {
            name: extractedName || multi.name,
            commands: allCmds,
            events: multi.events
        };
    }

    const directCmds = parseDispatchCallsFromText(text);
    return {
        name: extractedName || (multi ? multi.name : ""),
        commands: directCmds,
        events: []
    };
}
