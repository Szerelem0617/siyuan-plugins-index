/**
 * pipeline/smart-bindings.ts
 * 智能默认匹配：按前序命令的出参契约为入参生成建议（平坦参数池 + 用户别名优先）
 */

import type { CommandDef } from "../registry/command-registry";
import { COMMAND_BINDINGS } from "../registration";

export interface OutputEndpoint {
    key: string;
    label: string;
    type: string;
}

/** 命令的真实出参端点（只显示声明的 outputs；未声明 = 无出参） */
export function outputsOf(def: CommandDef | undefined): OutputEndpoint[] {
    if (def && def.outputs && def.outputs.length > 0) {
        return def.outputs.map(o => ({ key: o.key, label: o.label || o.key, type: o.type || "text" }));
    }
    return [];
}

/** 出参在参数池中的名字：用户配置的别名（outputMapping）优先，否则用规范 key */
export function outputName(commandRef: string, canonicalKey: string): string {
    try {
        const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRef);
        if (binding) {
            const raw = binding.outputMapping || binding.inputMapping;
            const parsed = JSON.parse(raw || "{}");
            if (parsed && typeof parsed === "object") {
                const map = parsed._outputMapping || parsed;
                if (map && map[canonicalKey]) {
                    return String(map[canonicalKey]);
                }
            }
        }
    } catch { /* ignore */ }
    return canonicalKey;
}

/** 入参 schema 与出参端点是否类型兼容 */
function typeCompatible(output: OutputEndpoint, paramType: string | undefined, paramKey: string): boolean {
    if (output.type === paramType) return true;
    if (output.type === "blockid" && /id|block/i.test(paramKey)) return true;
    return false;
}

/** 为单个入参在前序命令中找建议出参（规范 key；找不到返回 null） */
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
 * 为某个命令生成建议绑定（只填空参数），引用使用参数池名字 {{<别名或key>}}。
 */
export function buildSmartBindings(
    commands: { commandRef: string }[],
    stepIndex: number,
    registry: { getCommand(id: string): CommandDef | undefined }
): Record<string, string> {
    const result: Record<string, string> = {};
    const def = registry.getCommand(commands[stepIndex].commandRef);
    if (!def || !def.params) return result;
    for (const schema of def.params) {
        for (let i = stepIndex - 1; i >= 0; i--) {
            const prev = commands[i];
            const prevDef = registry.getCommand(prev.commandRef);
            const outKey = suggestBinding(prevDef, schema.key, schema.type);
            if (outKey) {
                result[schema.key] = `{{${outputName(prev.commandRef, outKey)}}}`;
                break;
            }
        }
    }
    return result;
}
