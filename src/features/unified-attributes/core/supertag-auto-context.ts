import { commandRegistry } from "../../command/registry/command-registry";
import { COMMAND_BINDINGS, SUPERTAG_REGISTRY } from "../../command/registration";
import { parseConditionalString } from "./supertag-trigger";

export interface AutoContextMatch {
    matched: boolean;
    paramKey?: string;
    token?: string; // 原汁原味的带括号变量表达式，如 "{{var.supertags}}" 或 "{{var.createdblock}}"
    sourceCommand?: string;
}

/**
 * 直接获取出参配置中原汁原味的变量表达式 token (例如 "{{var.createdblock}}")
 */
export function getCommandOutputToken(commandRefOrId: string, outputKey: string, schemaDefault?: string): string {
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRefOrId || b.label === commandRefOrId);
    if (binding && binding.outputMapping) {
        try {
            const raw = binding.outputMapping.trim();
            if (raw.startsWith("{")) {
                const parsed = JSON.parse(raw);
                if (parsed[outputKey]) {
                    const val = String(parsed[outputKey]).trim();
                    if (val.startsWith("{{")) return val;
                    const bare = val.replace(/^var\./, "").trim();
                    return `{{var.${bare}}}`;
                }
            } else if (raw) {
                if (raw.startsWith("{{")) return raw;
                const bare = raw.replace(/^var\./, "").trim();
                return `{{var.${bare}}}`;
            }
        } catch (_) {}
    }
    const def = schemaDefault || outputKey;
    return def.startsWith("{{") ? def : `{{var.${def.replace(/^var\./, "")}}}`;
}

/**
 * 单一真理源：获取指定 Supertag 的 Conditional 脚本字符串
 */
export function getSupertagConditionalScript(supertagLabel: string, explicitConditionalVal?: string): string {
    if (explicitConditionalVal && explicitConditionalVal.trim() !== "") {
        return explicitConditionalVal;
    }
    const cleanTag = (supertagLabel || "").replace(/#/g, "").trim().toLowerCase();
    if (!cleanTag) return "";

    const regMatch = SUPERTAG_REGISTRY.find(item => {
        const tag = (item.typeTag || "").replace(/#/g, "").trim().toLowerCase();
        return (tag === cleanTag || tag.includes(cleanTag) || cleanTag.includes(tag)) && Boolean(item.conditionalScript);
    });
    if (regMatch?.conditionalScript) {
        return regMatch.conditionalScript;
    }

    try {
        const { getSeedConditionalScript } = require("../../command/indexos/seed-data");
        return getSeedConditionalScript(cleanTag);
    } catch (_) {
        return "";
    }
}

/**
 * 从 Supertag 的 Conditional 规则中直接提取出参 token 池
 */
export function getSupertagOutputPool(conditionalStr: string): { key: string; token: string; type: string }[] {
    const pool: { key: string; token: string; type: string }[] = [];
    console.log(`[AutoContext-Debug] getSupertagOutputPool input conditionalStr:`, conditionalStr ? (conditionalStr.slice(0, 80) + "...") : "<empty>");
    if (!conditionalStr) return pool;

    const commandRefs: string[] = [];

    // 1. 结构化注释规则解析
    try {
        const rules = parseConditionalString(conditionalStr);
        const createdRules = rules.filter(r => !r.event || r.event === "tag_created");
        for (const r of createdRules) {
            for (const c of r.commands) {
                if (c.labelOrId && !commandRefs.includes(c.labelOrId)) {
                    commandRefs.push(c.labelOrId);
                }
            }
        }
    } catch (_) {}

    // 2. 原生 JS 动态脚本正则抓取 dispatch("commandId", ...) 兼容双重转义引号
    const dispatchRegex = /dispatch\s*\(\s*["'\s]*([a-zA-Z0-9._-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = dispatchRegex.exec(conditionalStr)) !== null) {
        const extractedCmdId = match[1]?.trim();
        if (extractedCmdId && !commandRefs.includes(extractedCmdId)) {
            commandRefs.push(extractedCmdId);
        }
    }
    console.log(`[AutoContext-Debug] getSupertagOutputPool parsed commandRefs from script:`, commandRefs);

    // 3. 提取所有被调用命令在 Command-DB 中映射的真实 token
    for (const ref of commandRefs) {
        const cmdDef = commandRegistry.findByNameOrId(ref) || commandRegistry.getCommand(ref);
        console.log(`[AutoContext-Debug] Looking up command '${ref}': found=${Boolean(cmdDef)}, outputs=${JSON.stringify(cmdDef?.outputs || [])}`);
        if (cmdDef && cmdDef.outputs && Array.isArray(cmdDef.outputs)) {
            for (const out of cmdDef.outputs) {
                const token = getCommandOutputToken(cmdDef.id, out.key, out.default);
                if (!pool.some(p => p.token === token)) {
                    pool.push({
                        key: out.key,
                        token,
                        type: out.type || "string"
                    });
                }
                // 补充 blockid 别名 token (如 var.createdblock)，确保不同语法引用的统一解析
                if (out.key === "id" || out.type === "blockid") {
                    const aliases = ["{{var.createdblock}}", "{{var.id}}", "{{var.last_id}}"];
                    for (const alias of aliases) {
                        if (!pool.some(p => p.token === alias)) {
                            pool.push({
                                key: out.key,
                                token: alias,
                                type: "blockid"
                            });
                        }
                    }
                }
            }
        }
    }

    console.log(`[AutoContext-Debug] Final pool computed:`, pool);
    return pool;
}

/**
 * 单一真理源：分析指定 Supertag 下某条命令的 Auto-Context 匹配信息
 */
export function getSupertagAutoContextInfo(
    supertagLabel: string,
    commandId: string,
    explicitConditionalVal?: string
): Record<string, AutoContextMatch> {
    const conditionalStr = getSupertagConditionalScript(supertagLabel, explicitConditionalVal);
    const result: Record<string, AutoContextMatch> = {};
    const cmdDef = commandRegistry.getCommand(commandId);
    if (!cmdDef || !cmdDef.params) {
        console.log(`[AutoContext-Debug] getSupertagAutoContextInfo cmdDef not found or has no params for: ${commandId}`);
        return result;
    }

    const pool = getSupertagOutputPool(conditionalStr);
    console.log(`[AutoContext-Debug] Tag #${supertagLabel} for cmd ${commandId} pool size=${pool.length}:`, pool);

    if (pool.length === 0) return result;

    for (const param of cmdDef.params) {
        const isBlockIdParam = param.key === "id" || param.type === "blockid";
        if (isBlockIdParam) {
            const matchedOut = pool.find(p => p.type === "blockid" || p.token.includes("block") || p.key.includes("block")) || pool[0];
            if (matchedOut) {
                result[param.key] = {
                    matched: true,
                    paramKey: param.key,
                    token: matchedOut.token,
                    sourceCommand: "tag_created"
                };
            }
        } else if (param.key === "enabled") {
            const matchedOut = pool.find(p => p.type === "boolean" || p.token.includes("boolean") || p.key.includes("boolean"));
            if (matchedOut) {
                result[param.key] = {
                    matched: true,
                    paramKey: param.key,
                    token: matchedOut.token,
                    sourceCommand: "tag_created"
                };
            }
        }
    }

    return result;
}
