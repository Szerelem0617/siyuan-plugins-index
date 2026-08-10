/**
 * supertag-trigger.ts
 *
 * 条件触发规则查询与指令管道分发模块
 */

import { post } from "../../../../shared/api-client/request";
import { SUPERTAG_REGISTRY, COMMAND_BINDINGS, getTypeAvId } from "../../registration";
import { getSqliteEngine } from "../../../sqlite/sqlite-manager";
import { getSeedConditionalScript } from "../../indexos/seed-data";
import { dispatchCommand, type CommandContext } from "../../command-dispatcher";
import { executeTsScript } from "./supertag-sandbox";

export interface TriggerCommandRef {
    labelOrId: string;
    args?: Record<string, any>;
}

export interface TriggerRule {
    event: string;
    condition: string;
    commands: TriggerCommandRef[];
}

export function splitCommands(text: string): string[] {
    const result: string[] = [];
    let current = "";
    let parenDepth = 0;
    let inQuotes = false;
    let quoteChar = "";
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === quoteChar && text[i - 1] !== "\\") {
                inQuotes = false;
            }
            current += char;
        } else {
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
                current += char;
            } else if (char === "(") {
                parenDepth++;
                current += char;
            } else if (char === ")") {
                parenDepth--;
                current += char;
            } else if (char === "," && parenDepth === 0) {
                if (current.trim()) result.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

export function parseSingleCommandCall(rawCmdStr: string): TriggerCommandRef {
    const trimmed = rawCmdStr.trim();
    const match = trimmed.match(/^([^(]+)\s*\((.*)\)$/);
    if (!match) {
        return { labelOrId: trimmed };
    }

    const labelOrId = match[1].trim();
    const argsStr = match[2].trim();
    if (!argsStr) {
        return { labelOrId };
    }

    const args: Record<string, any> = {};
    const argPairs = splitCommands(argsStr);

    for (const pair of argPairs) {
        const colonIdx = pair.indexOf(":");
        const eqIdx = pair.indexOf("=");
        let sepIdx = -1;

        if (colonIdx !== -1 && eqIdx !== -1) sepIdx = Math.min(colonIdx, eqIdx);
        else sepIdx = Math.max(colonIdx, eqIdx);

        if (sepIdx !== -1) {
            const k = pair.slice(0, sepIdx).trim().replace(/^['"]|['"]$/g, "");
            let vStr = pair.slice(sepIdx + 1).trim();

            if ((vStr.startsWith('"') && vStr.endsWith('"')) || (vStr.startsWith("'") && vStr.endsWith("'"))) {
                args[k] = vStr.slice(1, -1);
            } else if (vStr === "true") args[k] = true;
            else if (vStr === "false") args[k] = false;
            else if (!isNaN(Number(vStr)) && vStr !== "") args[k] = Number(vStr);
            else args[k] = vStr;
        } else {
            args["defaultArg"] = pair.replace(/^['"]|['"]$/g, "");
        }
    }

    return { labelOrId, args };
}

export function parseConditionalString(conditionalStr: string): TriggerRule[] {
    if (!conditionalStr || !conditionalStr.trim()) return [];

    const rules: TriggerRule[] = [];
    const lines = conditionalStr.split("\n");

    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("//") || line.startsWith("#")) continue;

        let event = "tag_created";
        let condition = "";
        let cmdPart = line;

        if (line.includes("->")) {
            const parts = line.split("->");
            const left = parts[0].trim();
            cmdPart = parts.slice(1).join("->").trim();

            if (left.startsWith("[") && left.includes("]")) {
                const match = left.match(/^\[([^\]]+)\]\s*(.*)$/);
                if (match) {
                    const eventCN = match[1].trim();
                    condition = match[2].trim();

                    if (eventCN.includes("移除")) event = "tag_removed";
                    else if (eventCN.includes("内容")) event = "block_content_changed";
                    else if (eventCN.includes("属性")) event = "block_attribute_changed";
                    else if (eventCN.includes("完成")) event = "task_completed";
                    else event = "tag_created";
                }
            } else {
                condition = left;
            }
        }

        const rawCmds = splitCommands(cmdPart);
        const commands: TriggerCommandRef[] = rawCmds.map(parseSingleCommandCall);

        rules.push({ event, condition, commands });
    }

    return rules;
}

export async function triggerConditionalCommands(
    blockId: string, 
    cleanTag: string, 
    eventName: "tag_created" | "tag_removed" | "block_content_changed" | "block_attribute_changed" | "task_completed"
): Promise<void> {
    try {
        let conditionalVal = "";
        const typeAvId = getTypeAvId();

        if (typeAvId) {
            try {
                const tableName = `av_${typeAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
                const { db } = await getSqliteEngine();
                
                const schemaCols = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [typeAvId]);
                let supertagColName = "supertag";
                if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
                    supertagColName = String(schemaCols[0].values[0][0]);
                }

                const schemaConditional = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Conditional' OR key_name = '触发器' OR key_name = 'On Create' OR key_name = '创建时')`, [typeAvId]);
                let conditionalColName = "Conditional";
                if (schemaConditional.length > 0 && schemaConditional[0].values.length > 0) {
                    conditionalColName = String(schemaConditional[0].values[0][0]);
                }

                const typeDbRes = db.exec(`SELECT "${conditionalColName}" FROM ${tableName} WHERE LOWER("${supertagColName}") = '#${cleanTag}' OR LOWER("${supertagColName}") = '${cleanTag}'`);

                if (typeDbRes && typeDbRes.length > 0 && typeDbRes[0].values.length > 0) {
                    conditionalVal = String(typeDbRes[0].values[0][0] || "").trim();
                }
            } catch (dbErr) {
                console.warn("[Supertag-Trigger] Failed to query SQLite for conditional script:", dbErr);
            }
        }

        // 兜底 1：未实例化时（找不到 Type-DB AV）从种子常量读取 Conditional 脚本。
        // 已实例化后种子不再参与任何运行时路径。
        if (!conditionalVal && !typeAvId) {
            conditionalVal = getSeedConditionalScript(cleanTag);
            if (conditionalVal) {
                console.log(`[Supertag-Trigger] Found conditional script in seed data for #${cleanTag}`);
            }
        }

        // 兜底 2：使用 SUPERTAG_REGISTRY 内置定义的 conditionalScript！
        if (!conditionalVal) {
            const regMatch = SUPERTAG_REGISTRY.find(item => item.typeTag.replace(/#/g, "").trim().toLowerCase() === cleanTag);
            if (regMatch && (regMatch as any).conditionalScript) {
                conditionalVal = (regMatch as any).conditionalScript.trim();
                console.log(`[Supertag-Trigger] Using built-in SUPERTAG_REGISTRY conditional script for #${cleanTag}`);
            }
        }

        if (conditionalVal) {
            const doc = document;
            const blockEl = doc.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement || doc.createElement("div");
            if (blockEl && !blockEl.getAttribute("data-node-id")) {
                blockEl.setAttribute("data-node-id", blockId);
            }

            const protyle = (window as any).siyuan?.ws?.protyle || null;
            const pipelineVars: Record<string, any> = {};

            // 1. 自动预加载目标块的持久化属性到 pipelineVars 中 (统一 vars 属性池)
            try {
                const attrRes = await post("/api/attr/getBlockAttrs", { id: blockId });
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
                const taskVal = pipelineVars["index-task"] || pipelineVars["task-status"] || pipelineVars["task_status"] || (eventName === "task_completed" ? "completed" : "pending");
                pipelineVars["completed"] = taskVal;
                pipelineVars["task_status"] = taskVal;
                pipelineVars["task-status"] = taskVal;
                pipelineVars["index-task"] = taskVal;

                console.log(`[Supertag-Debug] Pre-loaded block attributes for ${blockId} on event ${eventName}:`, pipelineVars);
            } catch (e) {
                console.warn(`[Supertag-Trigger] Failed to pre-load block attributes for ${blockId}:`, e);
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
                console.log(`[Supertag-Trigger] Executing native TS/JS dynamic script for tag #${cleanTag} on event ${eventName}`);
                await executeTsScript(conditionalVal, context, eventName);
                return;
            }

            // 3. 否则走结构化命令管道解析
            const rules = parseConditionalString(conditionalVal);
            const targetRule = rules.find(r => r.event === eventName);

            if (targetRule && targetRule.commands.length > 0) {
                let conditionMet = true;
                if (targetRule.condition) {
                    console.log(`[Supertag-Trigger] Evaluating condition: ${targetRule.condition}`);
                }

                if (conditionMet) {
                    console.log(`[Supertag-Trigger] Condition met. Executing commands for tag #${cleanTag} on event ${eventName}:`, targetRule.commands);

                    for (const cmdObj of targetRule.commands) {
                        const cmdLabel = cmdObj.labelOrId;
                        const cmdInfo = COMMAND_BINDINGS[cmdLabel];
                        const commandRef = cmdInfo?.commandRef || cmdLabel;
                        
                        console.log(`[Supertag-Trigger] Dispatching command: "${cmdLabel}" (ID: ${commandRef}) on block ${blockId} [manual=${Object.keys(cmdObj.args || {}).length}, commandDb=${cmdInfo?.inputMapping ? 1 : 0}]`);

                        try {
                            // #1 pipeline 脚本内联参数 > #3 Command-DB inputMapping
                            const dispatchRes = await dispatchCommand(commandRef, null, context, {
                                manual: cmdObj.args || {},
                                commandDb: cmdInfo?.inputMapping || ""
                            });
                            if (!dispatchRes.success || dispatchRes.continue === false || dispatchRes.value === false || dispatchRes.status === "break") {
                                console.log(`[Supertag-Trigger] Pipeline execution halted: Command "${cmdLabel}" returned break, false, or failed.`);
                                break;
                            }
                        } catch (cmdErr) {
                            console.error(`[Supertag-Trigger] Failed to dispatch command: ${cmdLabel}`, cmdErr);
                            break;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error(`[Supertag-Trigger] Error triggering ${eventName} commands:`, e);
    }
}
