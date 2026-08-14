/**
 * pipeline/engine.ts
 * 统一规则脚本执行器（RuleEngine）
 *
 * Conditional 列 / 全局后台任务 / 复合命令共用同一脚本工件与同一沙箱环境：
 *   env = { dispatch, state: { vars }, delay, context, eventName }
 *
 * - dispatch()：调用任意已注册命令；成功后把出参（规范 key + 用户别名）写入参数池 state.vars；
 * - state.vars：平坦参数池（用户别名为键），模板 {{name}} / {{block_id}} 等环境变量照常解析；
 * - 优先级：#1 脚本内联参数（manual）> #3 Command-DB paramMapping > 变量解析内嵌。
 */

import { dispatchCommand, type CommandContext, type DispatchResult } from "../command-dispatcher";
import { COMMAND_BINDINGS } from "../registration";

/** 按 commandRef 在 COMMAND_BINDINGS 中反查 inputMapping（Command-DB 配置） */
export function findCommandDbInputMapping(commandRef: string): string {
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRef);
    return binding?.inputMapping || "";
}

/** 兼容保留旧方法名 */
export const findCommandDbParamMapping = findCommandDbInputMapping;

/** 解析 outputMapping 里的用户出参别名（{ 规范key: 别名 }） */
function parseOutputMapping(commandRef: string): Record<string, string> {
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRef);
    const raw = binding?.outputMapping;
    try {
        const parsed = JSON.parse(raw || "{}");
        if (parsed && typeof parsed === "object") {
            return parsed as Record<string, string>;
        }
    } catch { /* ignore */ }
    return {};
}

/** dispatch 成功后把出参写入参数池（规范 key + var.用户别名） */
function exportToPool(vars: Record<string, any>, commandId: string, res: DispatchResult) {
    if (res.id) {
        vars.id = res.id;
        vars["var.id"] = res.id;
    }
    if (res.value !== undefined) {
        if (typeof res.value === "object" && res.value !== null) {
            for (const [k, v] of Object.entries(res.value)) {
                vars[k] = v;
                vars[`var.${k}`] = v;
            }
        } else {
            vars.value = res.value;
            vars["var.value"] = res.value;
        }
    }
    const mapping = parseOutputMapping(commandId);
    for (const [canonical, alias] of Object.entries(mapping)) {
        if (alias && vars[canonical] !== undefined) {
            vars[`var.${alias}`] = vars[canonical];
        }
    }
}

export interface RuleRunResult {
    success: boolean;
    vars: Record<string, any>;
    detail?: string;
}

/**
 * 执行统一规则脚本。
 * @param script    脚本正文（编辑器生成的 DSL 或手写 TS）
 * @param context   命令上下文（blockEl / protyleEl / vars）
 * @param eventName 触发事件名（Conditional 使用，如 tag_created）
 */
export async function runRuleScript(
    script: string,
    context: CommandContext,
    eventName = ""
): Promise<RuleRunResult> {
    try {
        const vars: Record<string, any> = { ...(context.vars || {}) };

        const dispatch = async (commandId: string, params?: any): Promise<DispatchResult> => {
            if (params && params.delayMs) {
                const ms = Number(params.delayMs);
                if (!isNaN(ms) && ms > 0) {
                    console.log(`[RuleEngine] Step ${commandId} 预设延时 ${ms} ms...`);
                    await delay(ms);
                }
            }
            const commandDb = findCommandDbInputMapping(commandId);
            const res = await dispatchCommand(commandId, null, { ...context, vars }, {
                manual: params || {},
                commandDb
            });
            if (res.success) {
                exportToPool(vars, commandId, res);
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

        let body = script.trim();
        // 剥离首部可能存在的单行或多行注释（如 // 名称: xxx 或 /* ... */）
        const strippedBody = body.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "").trim();

        if (
            strippedBody.startsWith("async ({") ||
            strippedBody.startsWith("async (") ||
            strippedBody.startsWith("({") ||
            strippedBody.startsWith("async function") ||
            strippedBody.startsWith("function")
        ) {
            body = `return (${strippedBody})(arguments[0]);`;
        } else {
            body = `return (async ({ dispatch, state, delay, context, eventName }) => {\n${body}\n})(arguments[0]);`;
        }

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction("env", body);
        const env = {
            dispatch,
            state: { vars },
            delay,
            context,
            eventName
        };
        console.log("[RuleEngine] 🚀 开始执行规则脚本, 携带 context:", { blockId: context.blockId, geometry: context.geometry });
        await fn(env);

        context.vars = { ...context.vars, ...vars };
        return { success: true, vars };
    } catch (err) {
        console.error("[RuleEngine] script error:", err);
        return { success: false, vars: context.vars || {}, detail: String(err) };
    }
}
