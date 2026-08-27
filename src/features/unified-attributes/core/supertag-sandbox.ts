/**
 * supertag-sandbox.ts
 *
 * 动态 TS/JS 脚本执行沙箱
 */

import { showMessage } from "siyuan";
import { dispatchCommand, getBlockId, updateContextVar, type CommandContext } from "../../command/command-dispatcher";
import { persistOutputVariablesToLayer4 } from "./supertag-persister";

export async function executeTsScript(scriptText: string, context: CommandContext, eventName?: string): Promise<boolean> {
    try {
        const delay = (ms: number | string) => {
            let numMs = typeof ms === "number" ? ms : 0;
            if (typeof ms === "string") {
                if (ms.endsWith("s")) numMs = parseFloat(ms) * 1000;
                else if (ms.endsWith("m")) numMs = parseFloat(ms) * 60 * 1000;
                else numMs = parseFloat(ms);
            }
            return new Promise(resolve => setTimeout(resolve, numMs));
        };

        const dispatch = async (commandId: string, params?: any) => {
            // TS 脚本参数 = #1 Pipeline 人为规划（最高优先级）
            const res = await dispatchCommand(commandId, null, context, { manual: params || {} });

            if (!context.vars) context.vars = {};
            if (res && typeof res === "object") {
                // 仅提取显式的业务出参 outputs，严禁将 DispatchResult 内部元数据 (success, method, detail, value) 写入 vars
                if (res.outputs && typeof res.outputs === "object") {
                    for (const [k, v] of Object.entries(res.outputs)) {
                        if (v !== undefined && v !== null && typeof v !== "object") {
                            const bare = k.replace(/^var\./, "").replace(/^\{\{\s*var\./, "").replace(/\s*\}\}$/, "").trim();
                            if (bare) {
                                context.vars[bare] = v;
                                context.vars[`var.${bare}`] = v;
                            }
                        }
                    }
                }
            }
            if (params && params._outputMapping) {
                context.vars._outputMapping = params._outputMapping;
            }

            // 自动把命令产出的变量（出参）写回/建列落盘到 Layer 4 数据库
            const targetBlockId = context.blockEl?.getAttribute("data-node-id") || getBlockId(context);
            if (targetBlockId && context.supertag && context.vars) {
                await persistOutputVariablesToLayer4(targetBlockId, context.supertag, context.vars);
            }

            return res;
        };

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        
        let codeText = scriptText.trim();
        // 剥离顶部的 // 注释行，找到真实代码起始行
        const lines = codeText.split("\n");
        const firstCodeLineIndex = lines.findIndex(line => {
            const l = line.trim();
            return l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*");
        });

        if (firstCodeLineIndex > -1) {
            codeText = lines.slice(firstCodeLineIndex).join("\n").trim();
        }

        let body = codeText;
        if (body.startsWith("async ({") || body.startsWith("async (") || body.startsWith("({")) {
            body = `return (${body})(arguments[0]);`;
        } else if (body.startsWith("async function") || body.startsWith("function")) {
            body = `return (${body})(arguments[0]);`;
        } else {
            body = `return (async ({ dispatch, state, delay, context, eventName, showMessage, updateVar }) => {\n${body}\n})(arguments[0]);`;
        }

        const fn = new AsyncFunction("env", body);
        const env = {
            dispatch,
            state: { vars: context.vars },
            delay,
            context,
            eventName,
            showMessage,
            updateVar: (k: string, v: any) => updateContextVar(context, k, v)
        };

        await fn(env);
        return true;
    } catch (err) {
        console.error(`[Supertag-TS] Error executing dynamic TS/JS script:`, err);
        showMessage(`❌ TS 动态脚本执行报错: ${err}`, 5000, "error");
        return false;
    }
}
