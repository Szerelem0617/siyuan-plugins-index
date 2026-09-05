/**
 * trigger/parser.ts
 *
 * 触发器 DSL 纯文本与命令管道语法解析器
 */

import { TriggerCommandRef, TriggerRule } from "./types";

export function splitCommands(text: string): string[] {
    const result: string[] = [];
    let current = "";
    let parenDepth = 0;
    let inQuotes = false;
    let quoteChar = "";
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === quoteChar && text[i - 1] !== "\\") {
                inQuotes = false;
            }
            current += char;
        } else {
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
                current += char;
            } else if (char === "(") {
                parenDepth++;
                current += char;
            } else if (char === ")") {
                parenDepth--;
                current += char;
            } else if (char === "," && parenDepth === 0) {
                if (current.trim()) result.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

export function parseSingleCommandCall(rawCmdStr: string): TriggerCommandRef {
    const trimmed = rawCmdStr.trim();
    const match = trimmed.match(/^([^(]+)\s*\((.*)\)$/);
    if (!match) {
        return { labelOrId: trimmed };
    }

    const labelOrId = match[1].trim();
    const argsStr = match[2].trim();
    if (!argsStr) {
        return { labelOrId };
    }

    const args: Record<string, any> = {};
    const argPairs = splitCommands(argsStr);

    for (const pair of argPairs) {
        const colonIdx = pair.indexOf(":");
        const eqIdx = pair.indexOf("=");
        let sepIdx = -1;

        if (colonIdx !== -1 && eqIdx !== -1) sepIdx = Math.min(colonIdx, eqIdx);
        else sepIdx = Math.max(colonIdx, eqIdx);

        if (sepIdx !== -1) {
            const k = pair.slice(0, sepIdx).trim().replace(/^['"]|['"]$/g, "");
            let vStr = pair.slice(sepIdx + 1).trim();

            if ((vStr.startsWith('"') && vStr.endsWith('"')) || (vStr.startsWith("'") && vStr.endsWith("'"))) {
                args[k] = vStr.slice(1, -1);
            } else if (vStr === "true") args[k] = true;
            else if (vStr === "false") args[k] = false;
            else if (!isNaN(Number(vStr)) && vStr !== "") args[k] = Number(vStr);
            else args[k] = vStr;
        } else {
            args["defaultArg"] = pair.replace(/^['"]|['"]$/g, "");
        }
    }

    return { labelOrId, args };
}

export function parseConditionalString(conditionalStr: string): TriggerRule[] {
    if (!conditionalStr || !conditionalStr.trim()) return [];

    const rules: TriggerRule[] = [];
    const lines = conditionalStr.split("\n");

    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("//") || line.startsWith("#") || line === "Conditional" || line === "Auto") continue;

        let event = "tag_created";
        let condition = "";
        let cmdPart = line;

        if (line.includes("->")) {
            const parts = line.split("->");
            const left = parts[0].trim();
            cmdPart = parts.slice(1).join("->").trim();

            if (left.startsWith("[") && left.includes("]")) {
                const match = left.match(/^\[([^\]]+)\]\s*(.*)$/);
                if (match) {
                    const eventCN = match[1].trim();
                    condition = match[2].trim();

                    if (eventCN.includes("移除")) event = "tag_removed";
                    else if (eventCN.includes("新块") || eventCN.includes("新内容") || eventCN.includes("新建")) event = "block_created";
                    else if (eventCN.includes("内容")) event = "block_content_changed";
                    else if (eventCN.includes("属性")) event = "block_attribute_changed";
                    else if (eventCN.includes("完成")) event = "task_completed";
                    else event = "tag_created";
                }
            } else {
                condition = left;
            }
        }

        const rawCmds = splitCommands(cmdPart);
        const commands: TriggerCommandRef[] = rawCmds
            .map(parseSingleCommandCall)
            .filter(c => c.labelOrId && c.labelOrId !== "Conditional" && c.labelOrId !== "Auto");

        if (commands.length > 0) {
            rules.push({ event, condition, commands });
        }
    }

    return rules;
}
