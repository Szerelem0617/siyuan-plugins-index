/**
 * pipeline/engine.ts
 * Pipeline 执行引擎（双轨：command 步骤 + script 步骤）
 *
 * 优先级：#1 步骤 params（manual）> #2 pipeline 全局默认（auto）>
 *         #3 Command-DB paramMapping（commandDb）> 变量解析内嵌 > schema 默认
 */

import { dispatchCommand, parseParam, type CommandContext, type DispatchResult } from "../command-dispatcher";
import { COMMAND_BINDINGS } from "../registration";
import type { PipelineConfig } from "./types";

export interface PipelineRuntimeState {
    /** 变量池（含 stepN.key 出参、全局默认、上下文 vars） */
    vars: Record<string, any>;
    stepIndex: number;
    stepResults: Record<string, DispatchResult>;
}

/** 按 commandRef 在 COMMAND_BINDINGS 中反查 paramMapping（Command-DB 配置） */
export function findCommandDbParamMapping(commandRef: string): string {
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRef);
    return binding?.paramMapping || "";
}

/** 步骤出参写入变量池（stepN.key），供后续步骤以 {{stepN.key}} 引用 */
function exportStepOutputs(state: PipelineRuntimeState, stepIndex: number, result: DispatchResult) {
    const prefix = `step${stepIndex}.`;
    if (result.id) {
        state.vars[`${prefix}id`] = result.id;
        state.vars[`${prefix}createdblock`] = result.id;
        state.vars[`${prefix}last_id`] = result.id;
    }
    if (result.value !== undefined) {
        state.vars[`${prefix}value`] = result.value;
        if (typeof result.value === "object" && result.value !== null) {
            for (const [k, v] of Object.entries(result.value)) {
                state.vars[`${prefix}${k}`] = v;
            }
        }
    }
    state.stepResults[stepIndex] = result;
}

/**
 * 执行整条 pipeline。
 * @param config      pipeline 配置（JSON 模型）
 * @param context     命令上下文（blockEl / protyleEl / vars）
 * @param entryParams 该复合命令行 Param Mapping 列的全局默认参数（#2 auto 层）
 */
export async function runPipeline(
    config: PipelineConfig,
    context: CommandContext,
    entryParams?: string | Record<string, unknown> | null
): Promise<{ success: boolean; state: PipelineRuntimeState; failedStep?: number }> {
    const state: PipelineRuntimeState = {
        vars: { ...(context.vars || {}), ...parseParam(entryParams) },
        stepIndex: 0,
        stepResults: {}
    };

    for (let i = 0; i < config.steps.length; i++) {
        const step = config.steps[i];
        state.stepIndex = i;

        if (step.enabled === false) {
            console.log(`[Pipeline] step${i} disabled, skip`);
            continue;
        }
        if (step.delayMs) {
            await new Promise(resolve => setTimeout(resolve, step.delayMs));
        }

        const stepCtx: CommandContext = { ...context, vars: { ...context.vars, ...state.vars } };
        try {
            const type = step.type || "command";
            let result: DispatchResult;
            if (type === "script") {
                result = await executePipelineScript(step.code || "", stepCtx, state);
            } else {
                result = await dispatchCommand(step.commandRef || "", null, stepCtx, {
                    manual: step.params || {},
                    commandDb: findCommandDbParamMapping(step.commandRef || "")
                });
            }

            if (!result.success) {
                console.error(`[Pipeline] step${i} failed:`, result.detail);
                return { success: false, state, failedStep: i };
            }
            exportStepOutputs(state, i, result);
            context.vars = { ...context.vars, ...state.vars };
        } catch (err) {
            console.error(`[Pipeline] step${i} threw:`, err);
            return { success: false, state, failedStep: i };
        }
    }
    return { success: true, state };
}

/** script 步骤：与 supertag-sandbox 相同的脚本约定（async ({ dispatch, state, ... }) => {...}） */
async function executePipelineScript(code: string, context: CommandContext, state: PipelineRuntimeState): Promise<DispatchResult> {
    try {
        const dispatch = async (commandId: string, params?: any): Promise<DispatchResult> => {
            const res = await dispatchCommand(commandId, null, context, {
                manual: params || {},
                commandDb: findCommandDbParamMapping(commandId)
            });
            if (res.id && !state.vars.createdblock) {
                state.vars.createdblock = res.id;
                state.vars.last_id = res.id;
            }
            return res;
        };
        const delay = (ms: number | string) => {
            let numMs = typeof ms === "number" ? ms : 0;
            if (typeof ms === "string") {
                if (ms.endsWith("s")) numMs = parseFloat(ms) * 1000;
                else if (ms.endsWith("m")) numMs = parseFloat(ms) * 60 * 1000;
                else numMs = parseFloat(ms);
            }
            return new Promise(resolve => setTimeout(resolve, numMs));
        };

        let body = code.trim();
        if (body.startsWith("async ({") || body.startsWith("async (") || body.startsWith("({")) {
            body = `return (${body})(arguments[0]);`;
        } else if (body.startsWith("async function") || body.startsWith("function")) {
            body = `return (${body})(arguments[0]);`;
        } else {
            body = `return (async ({ dispatch, state, delay, context, eventName }) => {\n${body}\n})(arguments[0]);`;
        }

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction("env", body);
        const env = {
            dispatch,
            state: { vars: state.vars },
            delay,
            context,
            eventName: ""
        };
        const output = await fn(env);
        return { success: true, method: "custom", detail: "script step ok", value: output };
    } catch (err) {
        console.error("[Pipeline] script step error:", err);
        return { success: false, method: "custom", detail: String(err) };
    }
}
