/**
 * pipeline/pipeline-io-infer.ts
 *
 * 负责自动从 Pipeline 步骤脚本中智能推导 Input（形参入参）与 Output（终态出参）
 */

import { commandRegistry } from "../registry/command-registry";
import type { RuleScript } from "./script-dsl";

export interface PipelineInferredIO {
    input: Record<string, string>;
    output: Record<string, string>;
}

const SYSTEM_BUILTINS = new Set([
    "block_id", "root_id", "parent_id", "date", "time", "cycle"
]);

export function inferPipelineIO(rule: RuleScript): PipelineInferredIO {
    const input: Record<string, string> = {};
    const output: Record<string, string> = {};
    const knownOutputs = new Set<string>();

    if (!rule || !rule.commands) {
        return { input, output };
    }

    for (const cmd of rule.commands) {
        const def = commandRegistry.getCommand(cmd.commandRef) || commandRegistry.findByNameOrId(cmd.commandRef);
        
        // 1. 收集各步骤命令定义中的标准出参
        if (def && def.outputs && Array.isArray(def.outputs)) {
            for (const out of def.outputs) {
                const outKey = out.key;
                const defaultToken = String(out.default || `var.${outKey}`);
                const formattedToken = defaultToken.includes("{{") ? defaultToken : `{{${defaultToken}}}`;
                output[outKey] = formattedToken;
                knownOutputs.add(outKey);
                knownOutputs.add(defaultToken.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").replace(/^var\./, ""));
            }
        }

        // 2. 扫描入参字符串，提取所有引用的外部变量作为 Pipeline Input
        for (const [pKey, pVal] of Object.entries(cmd.params || {})) {
            if (typeof pVal === "string" && pVal.includes("{{")) {
                const matches = pVal.matchAll(/\{\{([^}]+)\}\}/g);
                for (const m of matches) {
                    const rawInner = m[1].trim();

                    // 处理 {{input.xxx}}
                    if (rawInner.startsWith("input.")) {
                        const inputKey = rawInner.slice(6).trim();
                        if (inputKey) input[inputKey] = "";
                        continue;
                    }

                    // 处理 {{prompt:xxx}}
                    if (rawInner.startsWith("prompt:") || rawInner.startsWith("interactive:")) {
                        const promptLabel = rawInner.split(":")[1]?.trim() || pKey;
                        input[promptLabel] = "";
                        continue;
                    }

                    // 排除系统内置变量与上游已产生的 var.xxx 变量
                    const cleanName = rawInner.replace(/^var\./, "").split(":")[0].trim();
                    if (!SYSTEM_BUILTINS.has(cleanName) && !knownOutputs.has(cleanName) && !rawInner.startsWith("cycle")) {
                        input[cleanName] = "";
                    }
                }
            }
        }
    }

    return { input, output };
}
