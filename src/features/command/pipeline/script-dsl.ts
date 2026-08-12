/**
 * script-dsl.ts
 * 统一规则脚本 DSL：编辑器生成 / 强大鲁棒反向解析
 */

export interface RuleCommand {
    commandRef: string;
    params: Record<string, string>;
}

export interface RuleScript {
    name: string;
    commands: RuleCommand[];
    /** Conditional 用：触发事件列表（空 = 不限） */
    events?: string[];
}

/** 生成规则脚本；events 非空时生成事件守卫（Conditional 用） */
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
 * 强大鲁棒的反向解析规则脚本：提取事件与所有 dispatch("id", {...}) 调用。
 */
export function parseRuleScript(text: string): RuleScript | null {
    if (!text || typeof text !== "string" || !text.includes("dispatch")) return null;

    const nameMatch = text.match(/\/\/\s*名称\s*:\s*(.+)/);
    const name = nameMatch ? nameMatch[1].trim() : "";

    // 1. 提取事件 (Events)
    const eventsSet = new Set<string>();
    const eventsMatch = text.match(/\/\/\s*事件\s*:\s*(.+)/);
    if (eventsMatch) {
        eventsMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean).forEach(e => eventsSet.add(e));
    }
    const includesMatch = text.match(/\[([^\]]+)\]\.includes\(eventName\)/);
    if (includesMatch) {
        try {
            const arr = JSON.parse(`[${includesMatch[1]}]`);
            if (Array.isArray(arr)) arr.forEach(e => eventsSet.add(String(e)));
        } catch (_) {}
    }
    const eventEqMatches = text.matchAll(/eventName\s*===\s*["']([^"']+)["']/g);
    for (const m of eventEqMatches) {
        eventsSet.add(m[1]);
    }

    // 2. 提取所有的 dispatch(...) 调用
    const commands: RuleCommand[] = [];
    const dispatchRegex = /dispatch\(\s*["']([^"']+)["']\s*(?:,\s*([\s\S]*?))?\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = dispatchRegex.exec(text)) !== null) {
        const commandRef = match[1];
        const rawArgs = match[2];
        let params: Record<string, string> = {};

        if (rawArgs && rawArgs.trim().startsWith("{")) {
            try {
                const braceStart = text.indexOf("{", match.index);
                if (braceStart !== -1) {
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
                        const jsonStr = text.slice(braceStart, end + 1);
                        params = JSON.parse(jsonStr);
                    }
                }
            } catch (_) {
                params = {};
            }
        }
        commands.push({ commandRef, params });
    }

    return {
        name,
        commands,
        events: Array.from(eventsSet)
    };
}
