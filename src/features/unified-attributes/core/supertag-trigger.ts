/**
 * supertag-trigger.ts
 *
 * 条件触发规则查询、作用域匹配 (Scope Matching) 与指令管道分发模块
 */

import { post } from "../../../shared/api-client/request";
import { SUPERTAG_REGISTRY, COMMAND_BINDINGS, getTypeAvId, globalSupertagsCache } from "../../command/registration";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { getSeedConditionalScript } from "../../command/indexos/seed-data";
import { dispatchCommand, type CommandContext } from "../../command/command-dispatcher";
import { executeTsScript } from "./supertag-sandbox";
import { parseMultiEventRuleScript } from "../../command/composite/script-dsl";
import { parseSupertags, cleanTagString } from "./supertag-diff";
import { evaluateCondition } from "./condition-evaluator";

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
        if (!line || line.startsWith("//") || line.startsWith("#") || line === "Conditional" || line === "Auto") continue;

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
                    else if (eventCN.includes("新块") || eventCN.includes("新内容") || eventCN.includes("新建")) event = "block_created";
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
        const commands: TriggerCommandRef[] = rawCmds
            .map(parseSingleCommandCall)
            .filter(c => c.labelOrId && c.labelOrId !== "Conditional" && c.labelOrId !== "Auto");

        if (commands.length > 0) {
            rules.push({ event, condition, commands });
        }
    }

    return rules;
}

export async function querySupertagRuleScript(cleanTag: string): Promise<string> {
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

            const schemaConditional = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Auto' OR key_name = 'Conditional' OR key_name = '触发器' OR key_name = 'On Create' OR key_name = '创建时')`, [typeAvId]);
            let conditionalColName = "Auto";
            if (schemaConditional.length > 0 && schemaConditional[0].values.length > 0) {
                conditionalColName = String(schemaConditional[0].values[0][0]);
            }

            const typeDbRes = db.exec(`SELECT "${conditionalColName}" FROM ${tableName} WHERE LOWER("${supertagColName}") = '#${cleanTag.toLowerCase()}' OR LOWER("${supertagColName}") = '${cleanTag.toLowerCase()}'`);

            if (typeDbRes && typeDbRes.length > 0 && typeDbRes[0].values.length > 0) {
                conditionalVal = String(typeDbRes[0].values[0][0] || "").trim();
            }
        } catch (dbErr) {
            console.warn("[Supertag-Trigger] Failed to query SQLite for conditional script:", dbErr);
        }
    }

    if (!conditionalVal || conditionalVal === "Conditional" || conditionalVal === "Auto") {
        conditionalVal = getSeedConditionalScript(cleanTag);
    }

    return conditionalVal;
}

export async function triggerConditionalCommands(
    blockId: string, 
    cleanTag: string, 
    eventName: "tag_created" | "tag_removed" | "block_created" | "block_content_changed" | "block_attribute_changed" | "task_completed",
    extraContext?: { targetBlockId?: string; hostBlockId?: string }
): Promise<void> {
    try {
        const conditionalVal = await querySupertagRuleScript(cleanTag);

        if (conditionalVal) {
            const hostId = extraContext?.hostBlockId || blockId;
            const targetId = extraContext?.targetBlockId || blockId;

            const doc = document;
            const blockEl = doc.querySelector(`[data-node-id="${hostId}"]`) as HTMLElement || doc.createElement("div");
            if (blockEl && !blockEl.getAttribute("data-node-id")) {
                blockEl.setAttribute("data-node-id", hostId);
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
                console.log(`[Supertag-Trigger] Executing dynamic script for tag #${cleanTag} on event ${eventName} (host=${hostId}, target=${targetId})`);
                await executeTsScript(conditionalVal, context, eventName);
                return;
            }

            // 3. 结构化命令管道解析
            const rules = parseConditionalString(conditionalVal);
            const targetRule = rules.find(r => r.event === eventName);

            if (targetRule && targetRule.commands.length > 0) {
                console.log(`[Supertag-Trigger] Executing commands for tag #${cleanTag} on event ${eventName}:`, targetRule.commands);

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
        }
    } catch (e) {
        console.error(`[Supertag-Trigger] Error triggering ${eventName} commands:`, e);
    }
}

/**
 * ⚡ 全局范围级联触发分发器 (Scope Cascade Dispatcher)
 * 支持 self (自身)、current_doc (所在当前文档)、inner_blocks (内部子块)、subtree (全子树) 毫秒级匹配
 */
export async function dispatchScopeEvents(
    targetBlockId: string, 
    eventName: "block_created" | "block_content_changed" | "block_attribute_changed" | "task_completed"
) {
    if (!targetBlockId) return;

    try {
        let targetInfo: {
            id: string;
            root_id: string;
            parent_id: string;
            path: string;
            type: string;
            subType: string;
            markdown: string;
            tags: string[];
        } | null = null;

        // 1. 通过思源官方 HTTP SQL API (/api/query/sql) 查询目标块元数据
        try {
            const sqlRes = await post("/api/query/sql", {
                stmt: `SELECT id, root_id, parent_id, path, type, subtype, markdown, ial FROM blocks WHERE id = '${targetBlockId}' LIMIT 1`
            });
            const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
            if (rows.length > 0) {
                const row = rows[0];
                targetInfo = {
                    id: String(row.id || ""),
                    root_id: String(row.root_id || ""),
                    parent_id: String(row.parent_id || ""),
                    path: String(row.path || ""),
                    type: String(row.type || ""),
                    subType: String(row.subtype || row.subType || ""),
                    markdown: String(row.markdown || ""),
                    tags: parseSupertags(String(row.ial || ""))
                };

                // 🌟 感知：如果当前块位于待办列表项内部，记录父级是否为待办
                if (targetInfo.type === "p" && targetInfo.parent_id) {
                    const parentRes = await post("/api/query/sql", {
                        stmt: `SELECT id, type, subtype FROM blocks WHERE id = '${targetInfo.parent_id}' LIMIT 1`
                    });
                    const parentRows = Array.isArray(parentRes) ? parentRes : (parentRes?.data || []);
                    if (parentRows.length > 0 && (parentRows[0].subtype === "t" || parentRows[0].type === "l" && parentRows[0].subtype === "t")) {
                        targetInfo.subType = "t";
                    }
                }
            }
        } catch (queryErr) {
            console.warn("[Supertag-Scope] /api/query/sql failed, fallback to getBlockInfo:", queryErr);
        }

        if (!targetInfo || !targetInfo.root_id || targetInfo.root_id === targetBlockId) {
            // 通过 getBlockInfo 及 DOM 补齐真实的 root_id 与 parent_id
            try {
                const infoRes = await post("/api/block/getBlockInfo", { id: targetBlockId });
                const rootID = infoRes?.rootID || infoRes?.root_id || "";
                const parentID = infoRes?.parentID || infoRes?.parent_id || "";
                const attrRes = await post("/api/attr/getBlockAttrs", { id: targetBlockId });
                const ial = attrRes?.["custom-supertags"] || "";

                // DOM 辅助推导
                const domEl = document.querySelector(`[data-node-id="${targetBlockId}"]`);
                const isDomTodo = Boolean(domEl?.closest('.li[data-subtype="t"], [data-subtype="t"], [data-task]'));

                targetInfo = {
                    id: targetBlockId,
                    root_id: rootID || (targetInfo?.root_id && targetInfo.root_id !== targetBlockId ? targetInfo.root_id : (domEl?.closest('[data-doc-id]')?.getAttribute('data-doc-id') || targetBlockId)),
                    parent_id: parentID || targetInfo?.parent_id || "",
                    path: targetInfo?.path || "",
                    type: targetInfo?.type || (isDomTodo ? "i" : "p"),
                    subType: isDomTodo ? "t" : (targetInfo?.subType || ""),
                    markdown: targetInfo?.markdown || "",
                    tags: targetInfo?.tags?.length ? targetInfo.tags : parseSupertags(ial)
                };
            } catch (_) {
                if (!targetInfo) return;
            }
        }

        const domEl = document.querySelector(`[data-node-id="${targetBlockId}"]`);
        const isDomTodo = Boolean(
            domEl?.closest('.li[data-subtype="t"], [data-subtype="t"], [data-task], .protyle-action--task') ||
            domEl?.querySelector('.li[data-subtype="t"], [data-subtype="t"], [data-task], .protyle-action--task')
        );

        const isTodo = (targetInfo.subType === "t") ||
                       (targetInfo.type === "l" && targetInfo.subType === "t") ||
                       (targetInfo.type === "i" && targetInfo.subType === "t") || 
                       targetInfo.markdown.includes("- [ ]") || 
                       targetInfo.markdown.includes("- [x]") ||
                       targetInfo.markdown.includes("* [ ]") ||
                       targetInfo.markdown.includes("* [x]") ||
                       isDomTodo;
        const isHeading = targetInfo.type === "h";
        const isParagraph = targetInfo.type === "p";
        const isDoc = targetInfo.type === "d";
        const isAv = targetInfo.type === "av";

        const matchesFilter = (filter?: string): boolean => {
            if (!filter || filter === "all") return true;
            if (filter === "todo") return isTodo;
            if (filter === "heading") return isHeading;
            if (filter === "paragraph") return isParagraph;
            if (filter === "doc") return isDoc;
            if (filter === "av") return isAv;
            return true;
        };

        // 2. 检索可能作为宿主 (Host) 的所有候选块 (自身、同文档块、祖先文档块)
        const hostCandidates: { id: string; root_id: string; parent_id: string; path: string; tags: string[] }[] = [];

        try {
            // A. 从思源 attributes 持久化属性表中查询宿主
            const attrSql = `
                SELECT a.block_id, a.value, b.root_id, b.parent_id, b.path 
                FROM attributes a 
                LEFT JOIN blocks b ON a.block_id = b.id 
                WHERE a.name = 'custom-supertags' 
                  AND (a.block_id = '${targetInfo.id}' 
                       OR b.root_id = '${targetInfo.root_id}' 
                       OR a.block_id = '${targetInfo.root_id}' 
                       OR '${targetInfo.path}' LIKE '%' || a.block_id || '%')
            `;
            const attrSqlRes = await post("/api/query/sql", { stmt: attrSql });
            const attrRows = Array.isArray(attrSqlRes) ? attrSqlRes : (attrSqlRes?.data || []);
            if (attrRows.length > 0) {
                for (const r of attrRows) {
                    const hostId = String(r.block_id || r.id);
                    const hostRootId = String(r.root_id || "");
                    const hostParentId = String(r.parent_id || "");
                    const hostPath = String(r.path || "");
                    const hostTags = parseSupertags(String(r.value || ""));
                    if (hostTags.length > 0) {
                        hostCandidates.push({ id: hostId, root_id: hostRootId, parent_id: hostParentId, path: hostPath, tags: hostTags });
                    }
                }
            }
        } catch (e) {
            console.warn("[Supertag-Scope] Query attributes table failed:", e);
        }

        // B. 直接通过 getBlockAttrs 检查当前文档 root_id 自身是否拥有超级标签
        if (targetInfo.root_id && !hostCandidates.some(h => h.id === targetInfo.root_id)) {
            try {
                const docAttrsRes = await post("/api/attr/getBlockAttrs", { id: targetInfo.root_id });
                const docTags = parseSupertags(docAttrsRes?.["custom-supertags"] || "");
                if (docTags.length > 0) {
                    hostCandidates.push({
                        id: targetInfo.root_id,
                        root_id: targetInfo.root_id,
                        parent_id: "",
                        path: targetInfo.path,
                        tags: docTags
                    });
                }
            } catch (_) {}
        }

        // C. 补充内存全局缓存 globalSupertagsCache
        globalSupertagsCache.forEach((tags, id) => {
            if (!hostCandidates.some(h => h.id === id) && tags && tags.length > 0) {
                hostCandidates.push({
                    id,
                    root_id: targetInfo?.root_id || "",
                    parent_id: "",
                    path: targetInfo?.path || "",
                    tags
                });
            }
        });

        // 3. 对每个宿主拥有的 Supertag 规则进行作用域与过滤器核验
        const triggeredKeys = new Set<string>();

        for (const host of hostCandidates) {
            for (const tag of host.tags) {
                const cleanTag = cleanTagString(tag);
                if (!cleanTag) continue;

                const script = await querySupertagRuleScript(cleanTag);
                if (!script) continue;

                const parsed = parseMultiEventRuleScript(script);
                if (!parsed || !parsed.events.includes(eventName)) continue;

                const cfg = parsed.eventConfigsMap?.[eventName] || { scope: "self", filter: "all" };
                const scope = cfg.scope || "self";
                const filter = cfg.filter || "all";
                const filterMatched = matchesFilter(filter);

                // 作用域匹配检查
                let scopeMatched = false;
                if (scope === "self") {
                    scopeMatched = (host.id === targetInfo.id);
                } else if (scope === "current_doc") {
                    scopeMatched = (host.root_id === targetInfo.root_id || host.id === targetInfo.root_id);
                } else if (scope === "inner_blocks") {
                    scopeMatched = (targetInfo.parent_id === host.id || (host.id === targetInfo.root_id && targetInfo.id !== host.id));
                } else if (scope === "subtree") {
                    scopeMatched = (host.id === targetInfo.id) || 
                                   (host.id === targetInfo.root_id) || 
                                   (targetInfo.path && targetInfo.path.includes(host.id));
                    
                    // 如果 path 尚在构建中，通过查询文档祖先链补齐检查
                    if (!scopeMatched && targetInfo.root_id) {
                        try {
                            const pathRes = await post("/api/query/sql", {
                                stmt: `SELECT path FROM blocks WHERE id = '${targetInfo.root_id}' LIMIT 1`
                            });
                            const pRows = Array.isArray(pathRes) ? pathRes : (pathRes?.data || []);
                            if (pRows.length > 0 && String(pRows[0].path || "").includes(host.id)) {
                                scopeMatched = true;
                            }
                        } catch (_) {}
                    }
                }

                // 4. 前置断言检查 (Condition Predicate)
                let conditionMatched = true;
                if (cfg.condition && cfg.condition.trim()) {
                    let targetAttrs: Record<string, string> = {};
                    try {
                        const attrRes = await post("/api/attr/getBlockAttrs", { id: targetInfo.id });
                        targetAttrs = attrRes?.data || attrRes || {};
                    } catch (_) {}

                    conditionMatched = evaluateCondition(cfg.condition, {
                        id: targetInfo.id,
                        attrs: targetAttrs,
                        content: targetInfo.markdown || domEl?.textContent || "",
                        markdown: targetInfo.markdown || "",
                        tags: targetInfo.tags,
                        type: targetInfo.type,
                        subType: targetInfo.subType
                    });
                }

                if (filterMatched && scopeMatched && conditionMatched) {
                    // 如果目标块是列表容器 (type = 'l') 或列表项 (type = 'i')，尝试下寻到具体内容段落块以进行精准打标
                    let actualTargetId = targetInfo.id;
                    if ((targetInfo.type === "l" || targetInfo.type === "i") && domEl) {
                        const childPara = domEl.querySelector('.p[data-node-id]');
                        if (childPara) {
                            actualTargetId = childPara.getAttribute("data-node-id") || actualTargetId;
                        }
                    }

                    const triggerKey = `${host.id}:${cleanTag}:${eventName}:${actualTargetId}`;
                    if (!triggeredKeys.has(triggerKey)) {
                        triggeredKeys.add(triggerKey);
                        await triggerConditionalCommands(host.id, cleanTag, eventName, {
                            targetBlockId: actualTargetId,
                            hostBlockId: host.id
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error("[Supertag-Scope] Failed to dispatch scope events:", e);
    }
}
