/**
 * pipeline/pipeline-auto-context.ts
 *
 * Pipeline 专属 Auto-Context 智能推荐引擎（无硬编码，完全从 Command-DB / 注册表动态抓取）
 */

import type { CommandDef } from "../registry/command-registry";
import { commandRegistry } from "../registry/command-registry";
import { COMMAND_BINDINGS } from "../registration";

export interface OutputEndpoint {
    key: string;
    label: string;
    type: string;
}

/**
 * 规范化变量 Token：防止二重包裹，永远收敛生成干净统一的 {{var.xxx}}
 */
export function formatVarToken(raw: string): string {
    if (!raw) return "";
    let clean = String(raw).trim();
    while (/^\{\{\s*/.test(clean) || /\s*\}\}$/.test(clean) || /^var\./i.test(clean)) {
        clean = clean.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").replace(/^var\./i, "").trim();
    }
    if (!clean) return "";
    return `{{var.${clean}}}`;
}

/**
 * 从 Command-DB 最新配置或注册表中获取命令出参的真实 Token
 */
export function getPipelineOutputToken(commandRefOrId: string, outputKey: string, schemaDefault?: string): string {
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRefOrId || b.label === commandRefOrId);
    if (binding && binding.outputMapping) {
        try {
            const raw = binding.outputMapping.trim();
            if (raw.startsWith("{")) {
                const parsed = JSON.parse(raw);
                if (parsed[outputKey]) return formatVarToken(String(parsed[outputKey]));
            } else if (raw) {
                return formatVarToken(raw);
            }
        } catch (_) {}
    }

    const defStr = schemaDefault || outputKey;
    return formatVarToken(defStr);
}

/** 获取命令定义的真实出参端点列表 */
export function outputsOf(def: CommandDef | undefined): OutputEndpoint[] {
    if (def && def.outputs && def.outputs.length > 0) {
        return def.outputs.map(o => ({ key: o.key, label: o.label || o.key, type: o.type || "text" }));
    }
    return [];
}

/** 出参在参数池中的标准名字 */
export function outputName(commandRef: string, canonicalKey: string): string {
    return getPipelineOutputToken(commandRef, canonicalKey);
}

/** 入参 schema 与出参端点类型兼容校验 */
function typeCompatible(output: OutputEndpoint, paramType: string | undefined, paramKey: string): boolean {
    if (output.type === paramType) return true;
    if (output.type === "blockid" && /id|block/i.test(paramKey)) return true;
    return false;
}

/** 为单个入参在前序命令中寻找建议出参 */
export function suggestBinding(prevDef: CommandDef | undefined, paramKey: string, paramType?: string): string | null {
    const outs = outputsOf(prevDef);
    if (outs.length === 0) return null;
    const compatible = outs.filter(o => typeCompatible(o, paramType, paramKey));
    const pool = compatible.length > 0 ? compatible : outs.filter(o => o.type === "blockid" && /id|block/i.test(paramKey));
    if (pool.length === 0) return null;
    const lower = paramKey.toLowerCase();
    const byName = pool.find(o =>
        o.key.toLowerCase() === lower
        || lower.includes(o.key.toLowerCase())
        || o.key.toLowerCase().includes(lower)
    );
    return (byName || pool[0]).key;
}

/**
 * 动态检索 Pipeline 中可能产生的创块/出参变量池 (白盒抓取，零硬编码数组)
 */
export function getTagCreatedOutputPool(): { commandRef: string; canonicalKey: string; varName: string; token: string }[] {
    const pool: { commandRef: string; canonicalKey: string; varName: string; token: string }[] = [];
    
    // 动态抓取注册表中所有包含 outputs 出参定义的命令（如 insertBlockBelow）
    const allCmds = commandRegistry.getAllCommands();
    for (const cmdDef of allCmds) {
        if (cmdDef.outputs && Array.isArray(cmdDef.outputs) && cmdDef.outputs.length > 0) {
            for (const out of cmdDef.outputs) {
                const token = getPipelineOutputToken(cmdDef.id, out.key, out.default);
                pool.push({
                    commandRef: cmdDef.id,
                    canonicalKey: out.key,
                    varName: token.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, ""),
                    token
                });
            }
        }
    }
    return pool;
}

/**
 * 为 Pipeline 中的某个命令生成建议绑定 (只针对空参数)，100% 动态白盒
 */
export function buildPipelineAutoContextBindings(
    commands: { commandRef: string }[],
    stepIndex: number,
    registry: { getCommand(id: string): CommandDef | undefined }
): Record<string, string> {
    const result: Record<string, string> = {};
    const def = registry.getCommand(commands[stepIndex].commandRef);
    if (!def || !def.params) return result;

    for (const schema of def.params) {
        let matched = false;
        // 1. 优先从同一序列的前置步骤搜寻
        for (let i = stepIndex - 1; i >= 0; i--) {
            const prev = commands[i];
            const prevDef = registry.getCommand(prev.commandRef);
            const outKey = suggestBinding(prevDef, schema.key, schema.type);
            if (outKey) {
                result[schema.key] = getPipelineOutputToken(prev.commandRef, outKey);
                matched = true;
                break;
            }
        }
        // 2. 若前置未匹配到且是 id 类型入参，尝试从所有创块/ID 出参中抓取
        if (!matched && (schema.key === "id" || schema.type === "blockid")) {
            const pool = getTagCreatedOutputPool();
            const idMatch = pool.find(p => p.token.includes("block") || p.canonicalKey.includes("block")) || pool[0];
            if (idMatch) {
                result[schema.key] = idMatch.token;
            }
        }
    }
    return result;
}

// 导出别名保持兼容
export const buildSmartBindings = buildPipelineAutoContextBindings;
