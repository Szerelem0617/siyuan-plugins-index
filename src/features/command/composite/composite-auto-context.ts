/**
 * composite/composite-auto-context.ts
 *
 * 复合命令 (Composite) 专属 Auto-Context 智能推荐引擎（无硬编码，完全从 Command-DB / 注册表动态抓取）
 */

import type { CommandDef } from "../registry/command-registry";
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
export function getCompositeOutputToken(commandRefOrId: string, outputKey: string, schemaDefault?: string): string {
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRefOrId || b.methodName === commandRefOrId);
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

export const getPipelineOutputToken = getCompositeOutputToken;

/** 获取命令定义的真实出参端点列表 */
export function outputsOf(def: CommandDef | undefined): OutputEndpoint[] {
    if (def && def.outputs && def.outputs.length > 0) {
        return def.outputs.map(o => ({ key: o.key, label: o.label || o.key, type: o.type || "text" }));
    }
    return [];
}

/** 出参在参数池中的标准名字 */
export function outputName(commandRef: string, canonicalKey: string): string {
    return getCompositeOutputToken(commandRef, canonicalKey);
}

/** 入参 schema 与出参端点类型兼容校验 */
export function typeCompatible(output: OutputEndpoint, paramType: string | undefined, paramKey: string): boolean {
    // 1. 完全相同类型匹配 (例如 blockid === blockid, string === string)
    if (output.type && paramType && output.type === paramType) return true;
    // 2. 完全相同名称匹配 (例如 id === id)
    if (output.key.toLowerCase() === paramKey.toLowerCase()) return true;
    return false;
}

/** 为单个入参在前序命令中寻找建议出参 */
export function suggestBinding(prevDef: CommandDef | undefined, paramKey: string, paramType?: string): string | null {
    const outs = outputsOf(prevDef);
    if (outs.length === 0) return null;
    
    // 1. 优先寻找既匹配类型又同名的出参 (例如 id: blockid -> id: blockid)
    const exactMatch = outs.find(o => o.key.toLowerCase() === paramKey.toLowerCase() && o.type === paramType);
    if (exactMatch) return exactMatch.key;

    // 2. 其次寻找匹配类型的出参 (例如 blockid === blockid)
    const typeMatch = outs.find(o => o.type && paramType && o.type === paramType);
    if (typeMatch) return typeMatch.key;

    // 3. 再次寻找完全同名的出参
    const nameMatch = outs.find(o => o.key.toLowerCase() === paramKey.toLowerCase());
    if (nameMatch) return nameMatch.key;

    return null;
}

/**
 * 为复合命令中的某个步骤生成建议绑定 (只针对空参数)，100% 动态白盒
 */
export function buildCompositeAutoContextBindings(
    commands: { commandRef: string }[],
    stepIndex: number,
    registry: { getCommand(id: string): CommandDef | undefined }
): Record<string, string> {
    const result: Record<string, string> = {};
    const def = registry.getCommand(commands[stepIndex].commandRef);
    if (!def || !def.params) return result;

    for (const schema of def.params) {
        // 从紧邻的前置步骤依次向前搜寻类型兼容或同名的出参
        for (let i = stepIndex - 1; i >= 0; i--) {
            const prev = commands[i];
            const prevDef = registry.getCommand(prev.commandRef);
            const outKey = suggestBinding(prevDef, schema.key, schema.type);
            if (outKey) {
                result[schema.key] = getCompositeOutputToken(prev.commandRef, outKey);
                break;
            }
        }
    }
    return result;
}

export const buildPipelineAutoContextBindings = buildCompositeAutoContextBindings;
export const buildSmartBindings = buildCompositeAutoContextBindings;
