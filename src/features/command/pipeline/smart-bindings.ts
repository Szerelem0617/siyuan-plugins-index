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

import { commandRegistry } from "../registry/command-registry";

/** 出参在参数池中的名字：用户配置的别名 (outputMapping) 优先，其次为 schema.default (如 createdblock)，最后用规范 key */
export function outputName(commandRef: string, canonicalKey: string): string {
    try {
        // 1. 优先从 COMMAND_BINDINGS (即 Command-DB 真实数据源) 获取用户在 Output 列保存的名
        for (const binding of Object.values(COMMAND_BINDINGS)) {
            if (binding.commandRef === commandRef && binding.outputMapping) {
                const parsed = JSON.parse(binding.outputMapping);
                if (parsed && typeof parsed === "object" && parsed[canonicalKey]) {
                    return String(parsed[canonicalKey]);
                }
            }
        }

        // 2. 只有当 Command-DB 中未修改/为空时，才降级读取 commandRegistry 内置 Schema 默认别名 (如 createdblock)
        const def = commandRegistry.getCommand(commandRef);
        if (def && def.outputs) {
            const outSchema = def.outputs.find(o => o.key === canonicalKey);
            if (outSchema && outSchema.default) {
                return String(outSchema.default);
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
 * 检索 Supertag 在 tag_created 事件阶段可能产生的全局出参变量池
 */
export function getTagCreatedOutputPool(): { commandRef: string; canonicalKey: string; varName: string }[] {
    const pool: { commandRef: string; canonicalKey: string; varName: string }[] = [];
    const tagCreatedCmds = [
        "plugin-index.command.insertBlockBelow",
        "api.block.insert"
    ];

    for (const cmdId of tagCreatedCmds) {
        const def = commandRegistry.getCommand(cmdId);
        if (def && def.outputs) {
            for (const out of def.outputs) {
                const varName = outputName(cmdId, out.key);
                pool.push({ commandRef: cmdId, canonicalKey: out.key, varName });
            }
        }
    }
    return pool;
}

/**
 * 为某个命令生成建议绑定（只填空参数），引用使用参数池名字 {{<别名或key>}}。
 * 具备 tag_created 出参全局感知能力。
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
        let matched = false;
        // 1. 优先从同序列的前置步骤搜寻
        for (let i = stepIndex - 1; i >= 0; i--) {
            const prev = commands[i];
            const prevDef = registry.getCommand(prev.commandRef);
            const outKey = suggestBinding(prevDef, schema.key, schema.type);
            if (outKey) {
                result[schema.key] = `{{${outputName(prev.commandRef, outKey)}}}`;
                matched = true;
                break;
            }
        }
        // 2. 若前置未匹配到，触发 tag_created 出参全局感应 (如 createdblock)
        if (!matched && (schema.key === "id" || schema.type === "blockid")) {
            const pool = getTagCreatedOutputPool();
            if (pool.length > 0) {
                result[schema.key] = `{{${pool[0].varName}}}`;
            }
        }
    }
    return result;
}
