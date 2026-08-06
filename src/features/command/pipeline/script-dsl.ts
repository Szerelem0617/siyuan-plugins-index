/**
 * script-dsl.ts
 * 统一规则脚本 DSL：编辑器生成 / 反向解析
 *
 * 三种表面（Conditional 列、全局后台、复合命令）共用同一脚本工件：
 *
 *   // 名称: 创建任务并更新
 *   async ({ dispatch, state, eventName }) => {
 *       await dispatch("api.block.insert", {
 *           "data": "[新任务] {{time}}",
 *           "previousID": "{{block_id}}"
 *       });
 *       await dispatch("plugin-index.command.safeUpdateBlock", {
 *           "id": "{{createdblock}}"
 *       });
 *   }
 *
 * 运行于统一沙箱环境（dispatch / state / delay / context / eventName）。
 * 由于是编辑器生成的固定形态，反向解析（提取 dispatch 调用）是确定性的。
 */

export interface RuleCommand {
    commandRef: string;
    params: Record<string, string>;
}

export interface RuleScript {
    name: string;
    commands: RuleCommand[];
}

/** 生成规则脚本 */
export function generateRuleScript(
    name: string,
    commands: { commandRef: string; params: Record<string, unknown> }[]
): string {
    const lines = commands.map(cmd => {
        const paramsText = JSON.stringify(cmd.params || {}, null, 2);
        return `    await dispatch(${JSON.stringify(cmd.commandRef)}, ${paramsText});`;
    });
    return [
        `// 名称: ${name}`,
        `async ({ dispatch, state, eventName }) => {`,
        ...lines,
        `}`
    ].join("\n");
}

/**
 * 反向解析规则脚本：提取所有 dispatch("id", {json}) 调用。
 * 只解析我们生成/认识的形态；解析失败返回 null。
 */
export function parseRuleScript(text: string): RuleScript | null {
    if (!text || typeof text !== "string" || !text.includes("dispatch(")) return null;

    const nameMatch = text.match(/\/\/\s*名称\s*:\s*(.+)/);
    const name = nameMatch ? nameMatch[1].trim() : "";

    const commands: RuleCommand[] = [];
    const scanRe = /dispatch\(\s*["']([^"']+)["']\s*,\s*/g;
    let scan: RegExpExecArray | null;
    while ((scan = scanRe.exec(text)) !== null) {
        const commandRef = scan[1];
        const braceStart = text.indexOf("{", scanRe.lastIndex);
        if (braceStart === -1) continue;

        // 括号平衡（忽略字符串内的花括号）
        let depth = 0;
        let inStr = false;
        let quote = "";
        let end = -1;
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
                if (depth === 0) { end = j + 1; break; }
            }
        }
        if (end === -1) continue;

        try {
            const parsed = JSON.parse(text.slice(braceStart, end)) as Record<string, unknown>;
            const params: Record<string, string> = {};
            for (const [k, v] of Object.entries(parsed)) params[k] = String(v);
            commands.push({ commandRef, params });
        } catch { /* 非我们生成的形态，跳过 */ }
    }

    if (commands.length === 0) return null;
    return { name, commands };
}
