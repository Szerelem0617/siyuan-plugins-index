/**
 * pipeline/pipeline-step-schema.ts
 *
 * 负责解析 Pipeline 中各步骤的参数规范与出参定义，
 * 为【外部入参按需暴露】与【出参默认导出/自选过滤】提供清晰的步骤级数据模型。
 */

import { commandRegistry } from "../registry/command-registry";
import type { RuleScript } from "./script-dsl";

export interface StepParamInfo {
    key: string;
    label: string;
    type: string;
    description?: string;
    stepConfigValue: string; // 在步骤编排里配置的值
    defaultValue?: string;
}

export interface StepOutputInfo {
    key: string;
    label: string;
    description?: string;
    canonicalToken: string; // 如 {{var.createdblock}}
}

export interface StepSchemaItem {
    stepIndex: number;
    commandId: string;
    commandName: string;
    params: StepParamInfo[];
    outputs: StepOutputInfo[];
}

export function inspectPipelineSteps(rule: RuleScript | null): StepSchemaItem[] {
    if (!rule || !rule.commands || rule.commands.length === 0) {
        return [];
    }

    return rule.commands.map((cmd, idx) => {
        const def = commandRegistry.getCommand(cmd.commandRef) || commandRegistry.findByNameOrId(cmd.commandRef);
        const commandId = def?.id || cmd.commandRef;
        const commandName = def?.name || commandId;

        const params: StepParamInfo[] = (def?.params || []).map(p => {
            const stepVal = cmd.params?.[p.key] !== undefined ? String(cmd.params[p.key]) : "";
            return {
                key: p.key,
                label: p.label || p.key,
                type: p.type || "string",
                description: p.description,
                stepConfigValue: stepVal,
                defaultValue: p.default !== undefined ? String(p.default) : ""
            };
        });

        const outputs: StepOutputInfo[] = (def?.outputs && Array.isArray(def.outputs) ? def.outputs : []).map(o => {
            const outKey = o.key;
            const defToken = String(o.default || `var.${outKey}`);
            const canonicalToken = defToken.includes("{{") ? defToken : `{{${defToken}}}`;
            return {
                key: outKey,
                label: o.label || outKey,
                description: o.description,
                canonicalToken
            };
        });

        return {
            stepIndex: idx + 1,
            commandId,
            commandName,
            params,
            outputs
        };
    });
}
