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

/** 按 commandRef 在 COMMAND_BINDINGS 中反查 paramMapping（Command-DB 配置） */
export function findCommandDbParamMapping(commandRef: string): string {
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === commandRef);
    return binding?.paramMapping || "";
}

/** 解析 paramMapping 里的用户出参别名（_outputMapping: { 规范key: 别名 }） */
function parseOutputMapping(paramMapping: string): Record<string, string> {
    try {
        const parsed = JSON.parse(paramMapping || "{}");
        if (parsed && typeof parsed === "object" && parsed._outputMapping && typeof parsed._outputMapping === "object") {
            return parsed._outputMapping as Record<string, string>;
        }
    } catch { /* ignore */ }
    return {};
}

/** dispatch 成功后把出参写入参数池（规范 key + 用户别名） */
function exportToPool(vars: Record<string, any>, commandDb: string, res: DispatchResult) {
    if (res.id) vars.id = res.id;
    if (res.value !== undefined) {
        if (typeof res.value === "object" && res.value !== null) {
            for (const [k, v] of Object.entries(res.value)) vars[k] = v;
        } else {
            vars.value = res.value;
        }
    }
    const mapping = parseOutputMapping(commandDb);
    for (const [canonical, alias] of Object.entries(mapping)) {
        if (alias && vars[canonical] !== undefined) vars[alias] = vars[canonical];
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
            const commandDb = findCommandDbParamMapping(commandId);
            const res = await dispatchCommand(commandId, null, { ...context, vars }, {
                manual: params || {},
                commandDb
            });
            if (res.success) {
                exportToPool(vars, commandDb, res);
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
            state: { vars },
            delay,
            context,
            eventName
        };
        await fn(env);

        context.vars = { ...context.vars, ...vars };
        return { success: true, vars };
    } catch (err) {
        console.error("[RuleEngine] script error:", err);
        return { success: false, vars: context.vars || {}, detail: String(err) };
    }
}
