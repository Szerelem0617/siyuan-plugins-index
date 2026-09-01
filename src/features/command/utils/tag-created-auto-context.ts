/**
 * tag-created-auto-context.ts
 *
 * Supertag 专属 tag_created 时序出参自动感知与推荐引擎
 *
 * 核心机制：
 * 1. 静态分析指定 Supertag 的 tag_created 触发器中调用的命令与产出的出参 (Outputs)；
 * 2. 在 Manual 命令配置界面中提供与 composite-auto-context 一致的白盒可见推荐与一键点选 Token 胶囊；
 * 3. 在运行时 (param-resolver)，若 Manual 命令入参留空，自动应用同名/同类型 tag_created 出参 (除非用户显式覆写)。
 */

import { commandRegistry } from "../registry/command-registry";
import { SUPERTAG_REGISTRY } from "../registration";
import { getCompositeOutputToken } from "../composite/composite-auto-context";

export interface TagOutputEndpoint {
    key: string;
    token: string;
    label: string;
    type: string;
    sourceCommand: string;
    sourceCommandId: string;
}

export interface TagAutoContextMatch {
    matched: boolean;
    token?: string;
    label?: string;
    sourceCommand?: string;
}

/**
 * 获取指定 Supertag 的 tag_created 触发器脚本
 */
export function getSupertagCreatedScript(supertagLabel: string): string {
    const cleanTag = (supertagLabel || "").replace(/^#+/, "").trim().toLowerCase();
    if (!cleanTag) return "";

    const regMatch = SUPERTAG_REGISTRY.find(item =>
        item.typeTag.replace(/^#+/, "").trim().toLowerCase() === cleanTag &&
        Boolean(item.conditionalScript)
    );
    if (regMatch?.conditionalScript) {
        return regMatch.conditionalScript;
    }

    try {
        const { getSeedConditionalScript } = require("../indexos/seed-data");
        return getSeedConditionalScript(cleanTag);
    } catch (_) {
        return "";
    }
}

/**
 * 提取指定 Supertag 在 tag_created 阶段产出的全部出参端点池
 */
export function getTagCreatedOutputs(supertagLabel: string): TagOutputEndpoint[] {
    const script = getSupertagCreatedScript(supertagLabel);
    const endpoints: TagOutputEndpoint[] = [];
    if (!script) return endpoints;

    const commandRefs: string[] = [];

    // 1. 正则匹配 dispatch("commandId", ...) 提取调用的命令
    const dispatchRegex = /dispatch\s*\(\s*["'\s]*([a-zA-Z0-9._-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = dispatchRegex.exec(script)) !== null) {
        const cmdId = match[1]?.trim();
        if (cmdId && !commandRefs.includes(cmdId)) {
            commandRefs.push(cmdId);
        }
    }

    // 2. 提取这些命令的官方出参定义
    for (const ref of commandRefs) {
        const cmdDef = commandRegistry.findByNameOrId(ref) || commandRegistry.getCommand(ref);
        if (cmdDef && cmdDef.outputs && Array.isArray(cmdDef.outputs)) {
            for (const out of cmdDef.outputs) {
                const token = getCompositeOutputToken(cmdDef.id, out.key, out.default);
                if (!endpoints.some(e => e.token === token)) {
                    endpoints.push({
                        key: out.key,
                        token,
                        label: `${cmdDef.name}: ${out.key}`,
                        type: out.type || "string",
                        sourceCommand: cmdDef.name,
                        sourceCommandId: cmdDef.id
                    });
                }
            }
        }
    }

    return endpoints;
}

/**
 * 为 Supertag Manual 命令中的某个入参生成智能建议绑定
 */
export function suggestTagCreatedBinding(
    supertagLabel: string,
    paramKey: string,
    paramType?: string,
    currentCommandId?: string
): TagAutoContextMatch {
    let outs = getTagCreatedOutputs(supertagLabel);
    if (outs.length === 0) return { matched: false };

    // 过滤掉当前命令自身产出的出参 (杜绝自身循环自噬)
    if (currentCommandId) {
        const cleanCurrentId = currentCommandId.trim().toLowerCase();
        outs = outs.filter(o => {
            const srcId = (o.sourceCommandId || "").toLowerCase();
            return srcId !== cleanCurrentId && o.sourceCommand.toLowerCase() !== cleanCurrentId;
        });
        if (outs.length === 0) return { matched: false };
    }

    const isBlockId = paramKey === "id" || paramType === "blockid";

    // 1. 优先寻找 blockid / id 匹配
    if (isBlockId) {
        const match = outs.find(o => o.type === "blockid" || o.key.includes("block") || o.key.includes("id") || o.key.includes("card"));
        if (match) {
            return {
                matched: true,
                token: match.token,
                label: match.label,
                sourceCommand: match.sourceCommand
            };
        }
    }

    // 2. 寻找完全同名匹配 (如 status === status)
    const exactNameMatch = outs.find(o => o.key.toLowerCase() === paramKey.toLowerCase());
    if (exactNameMatch) {
        return {
            matched: true,
            token: exactNameMatch.token,
            label: exactNameMatch.label,
            sourceCommand: exactNameMatch.sourceCommand
        };
    }

    // 3. 寻找类型兼容匹配
    if (paramType) {
        const typeMatch = outs.find(o => o.type === paramType);
        if (typeMatch) {
            return {
                matched: true,
                token: typeMatch.token,
                label: typeMatch.label,
                sourceCommand: typeMatch.sourceCommand
            };
        }
    }

    return { matched: false };
}

/**
 * 获取系统中所有同类型出参及常用上下文变量 Token 列表 (用于配置 UI 的一键点选胶囊)
 */
export function getAllCompatibleTokens(
    paramKey: string,
    paramType?: string,
    supertagLabel?: string
): { token: string; label: string; description: string }[] {
    const isBlockIdParam = paramKey === "id" || paramType === "blockid";
    const tokens: { token: string; label: string; description: string }[] = [];

    // 1. 如果处于 Supertag 上下文中，优先排在第一位的是 tag_created 专属推荐
    if (supertagLabel) {
        const tagOuts = getTagCreatedOutputs(supertagLabel);
        for (const out of tagOuts) {
            if ((isBlockIdParam && (out.type === "blockid" || out.key.includes("block") || out.key.includes("id"))) || out.type === paramType) {
                tokens.push({
                    token: out.token,
                    label: `🌟 ${out.token}`,
                    description: `来自 #${supertagLabel} 的 [tag_created] (${out.sourceCommand})`
                });
            }
        }
    }

    // 2. 基础拓扑与环境宏
    if (isBlockIdParam) {
        tokens.push(
            { token: "{{self.id}}", label: "⚡ {{self.id}}", description: "当前触发命令的宿主块 ID" },
            { token: "{{var.createdblock}}", label: "➕ {{var.createdblock}}", description: "前序步骤或 tag_created 创建的块 ID" },
            { token: "{{doc.id}}", label: "📄 {{doc.id}}", description: "当前块所在的顶级文档 ID" },
            { token: "{{parent.id}}", label: "⬆️ {{parent.id}}", description: "当前块的父级块/父页面 ID" },
            { token: "{{prev.id}}", label: "⬅️ {{prev.id}}", description: "紧邻的上一个兄弟块 ID" },
            { token: "{{next.id}}", label: "➡️ {{next.id}}", description: "紧邻的下一个兄弟块 ID" },
            { token: "{{daily_doc.id}}", label: "📅 {{daily_doc.id}}", description: "今日日记文档 ID" }
        );
    } else {
        tokens.push(
            { token: "{{prompt:请输入内容}}", label: "💬 {{prompt:...}}", description: "交互式弹窗提示输入" },
            { token: "{{time}}", label: "🕒 {{time}}", description: "当前系统时间 (HH:mm:ss)" },
            { token: "{{date}}", label: "📅 {{date}}", description: "当前系统日期 (YYYY-MM-DD)" },
            { token: "{{supertag}}", label: "🏷️ {{supertag}}", description: "当前触发的超级标签名" },
            { token: "{{var.supertags}}", label: "📋 {{var.supertags}}", description: "块上挂载的超级标签数组" }
        );
    }

    // 3. 去重
    const seen = new Set<string>();
    return tokens.filter(t => {
        if (seen.has(t.token)) return false;
        seen.add(t.token);
        return true;
    });
}
