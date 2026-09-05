/**
 * trigger/executor.ts
 *
 * 超级标签条件触发执行器 (双实体上下文装配、TS 动态沙箱执行与命令调度)
 */

import { post } from "../../../../shared/api-client/request";
import { COMMAND_BINDINGS } from "../../../command/registration";
import { dispatchCommand, type CommandContext } from "../../../command/command-dispatcher";
import { executeTsScript } from "../supertag-sandbox";
import { parseConditionalString } from "./parser";
import { querySupertagRuleScript } from "./rule-query";
import { TriggerEventName } from "./types";

export async function triggerConditionalCommands(
    blockId: string, 
    cleanTag: string, 
    eventName: TriggerEventName,
    extraContext?: { targetBlockId?: string; hostBlockId?: string }
): Promise<void> {
    try {
        console.log(`[Supertag-Trigger] 准备执行条件触发: tag=#${cleanTag}, event=${eventName}, hostId=${extraContext?.hostBlockId || blockId}, targetId=${extraContext?.targetBlockId || blockId}`);
        const conditionalVal = await querySupertagRuleScript(cleanTag);
        console.log(`[Supertag-Trigger] 查询到规则脚本:`, conditionalVal);

        if (!conditionalVal) return;

        const hostId = extraContext?.hostBlockId || blockId;
        const targetId = extraContext?.targetBlockId || blockId;

        const doc = document;
        const targetEl = doc.querySelector(`[data-node-id="${targetId}"]`) as HTMLElement || null;
        const hostEl = doc.querySelector(`[data-node-id="${hostId}"]`) as HTMLElement || null;
        const blockEl = targetEl || hostEl || doc.createElement("div");
        if (blockEl && !blockEl.getAttribute("data-node-id")) {
            blockEl.setAttribute("data-node-id", targetId);
        }

        const protyle = (window as any).siyuan?.ws?.protyle || null;
        const pipelineVars: Record<string, any> = {};

        // 1. 自动预加载属性到 pipelineVars 中 (统一 vars 属性池，注入双实体上下文)
        try {
            const attrRes = await post("/api/attr/getBlockAttrs", { id: targetId });
            const attrs = attrRes?.data || attrRes || {};
            if (attrs && typeof attrs === "object") {
                for (const [k, v] of Object.entries(attrs)) {
                    pipelineVars[k] = v;
                    if (k.startsWith("custom-")) {
                        const cleanKey = k.replace(/^custom-/, "");
                        pipelineVars[cleanKey] = v;
                    }
                }
            }
            const taskVal = pipelineVars["custom-task"] || pipelineVars["task"] || pipelineVars["index-task"] || pipelineVars["task-status"] || (eventName === "task_completed" ? "completed" : "pending");
            pipelineVars["task"] = taskVal;
            pipelineVars["custom-task"] = taskVal;
            pipelineVars["completed"] = taskVal;
            pipelineVars["task_status"] = taskVal;
            pipelineVars["task-status"] = taskVal;
            pipelineVars["index-task"] = taskVal;

            // 注入双实体标准化上下文参数
            pipelineVars["target_id"] = targetId;
            pipelineVars["block_id"] = targetId;
            pipelineVars["id"] = targetId;
            pipelineVars["host_id"] = hostId;
            pipelineVars["project_id"] = hostId;
        } catch (e) {
            console.warn(`[Supertag-Trigger] Failed to pre-load block attributes for ${targetId}:`, e);
        }

        const context: CommandContext = {
            blockEl,
            protyleEl: protyle?.element || null,
            supertag: cleanTag,
            vars: pipelineVars,
            executionMode: "background"
        };

        // 2. 判定是否为原生 TS/JS 动态脚本模式
        const isTsScript = conditionalVal.includes("async") || conditionalVal.includes("dispatch(") || (conditionalVal.includes("=>") && !conditionalVal.includes("->"));
        if (isTsScript) {
            await executeTsScript(conditionalVal, context, eventName);
            return;
        }

        // 3. 结构化命令管道解析
        const rules = parseConditionalString(conditionalVal);
        const targetRule = rules.find(r => r.event === eventName);

        if (targetRule && targetRule.commands.length > 0) {
            for (const cmdObj of targetRule.commands) {
                const cmdLabel = cmdObj.labelOrId;
                const cmdInfo = COMMAND_BINDINGS[cmdLabel];
                const commandRef = cmdInfo?.commandRef || cmdLabel;

                try {
                    const dispatchRes = await dispatchCommand(commandRef, null, context, {
                        manual: cmdObj.args || {},
                        commandDb: cmdInfo?.inputMapping || ""
                    });
                    if (!dispatchRes.success || dispatchRes.continue === false || dispatchRes.value === false || dispatchRes.status === "break") {
                        break;
                    }
                } catch (cmdErr) {
                    console.error(`[Supertag-Trigger] Failed to dispatch command: ${cmdLabel}`, cmdErr);
                    break;
                }
            }
        }
    } catch (e) {
        console.error(`[Supertag-Trigger] Error triggering ${eventName} commands:`, e);
    }
}
