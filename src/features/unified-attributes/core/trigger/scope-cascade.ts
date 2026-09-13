/**
 * trigger/scope-cascade.ts
 *
 * 全局范围级联触发分发器 (Scope Cascade Dispatcher)
 * 支持 self (自身)、current_doc (当前文档)、inner_blocks (内部子块)、subtree (子树拓扑) 毫秒级匹配
 */

import { post } from "../../../../shared/api-client/request";
import { globalSupertagsCache } from "../../../command/registration";
import { parseMultiEventRuleScript } from "../../../command/composite/script-dsl";
import { parseSupertags, cleanTagString } from "../supertag-diff";
import { evaluateCondition } from "../condition-evaluator";
import { resolveTargetBlockInfo } from "./target-resolver";
import { querySupertagRuleScript } from "./rule-query";
import { triggerConditionalCommands } from "./executor";
import { HostCandidate, TriggerEventName } from "./types";

function isBlockInsideHeadingSubtree(hostHeadingEl: Element, targetEl: Element): boolean {
    if (hostHeadingEl.getAttribute("data-type") !== "NodeHeading") {
        return hostHeadingEl.contains(targetEl);
    }

    const hostLevelStr = hostHeadingEl.getAttribute("data-subtype") || "h1";
    const hostLevel = parseInt(hostLevelStr.replace(/\D/g, "") || "1", 10);

    const hostWysiwyg = hostHeadingEl.closest(".protyle-wysiwyg");
    const targetWysiwyg = targetEl.closest(".protyle-wysiwyg");
    if (!hostWysiwyg || !targetWysiwyg) {
        return false;
    }

    // 找到 targetEl 在 wysiwyg 下的顶级父块
    let targetTop: Element | null = targetEl;
    while (targetTop && targetTop.parentElement && !targetTop.parentElement.classList.contains("protyle-wysiwyg")) {
        targetTop = targetTop.parentElement;
    }
    // 找到 hostHeadingEl 在 wysiwyg 下的顶级父块
    let hostTop: Element | null = hostHeadingEl;
    while (hostTop && hostTop.parentElement && !hostTop.parentElement.classList.contains("protyle-wysiwyg")) {
        hostTop = hostTop.parentElement;
    }
    if (!targetTop || !hostTop) return false;

    // 从 hostTop 向后扫描兄弟节点，直到遇到同级或更高级别的标题
    let curr = hostTop.nextElementSibling;
    while (curr) {
        if (curr === targetTop) {
            return true;
        }
        if (curr.getAttribute("data-type") === "NodeHeading") {
            const currLevelStr = curr.getAttribute("data-subtype") || "h1";
            const currLevel = parseInt(currLevelStr.replace(/\D/g, "") || "1", 10);
            if (currLevel <= hostLevel) {
                break;
            }
        }
        curr = curr.nextElementSibling;
    }

    return false;
}

async function isSqlHeadingSubtree(hostId: string, targetId: string): Promise<boolean> {
    try {
        const sqlStmt = `
            SELECT id, root_id, sort, type, subtype FROM blocks 
            WHERE id IN ('${hostId}', '${targetId}')
        `;
        const res = await post("/api/query/sql", { stmt: sqlStmt });
        const rows = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length < 2) return false;

        const hostRow = rows.find((r: any) => String(r.id) === hostId);
        const targetRow = rows.find((r: any) => String(r.id) === targetId);
        if (!hostRow || !targetRow) return false;

        // 必须在同一个根文档内，且目标块在物理顺序上必须位于宿主标题之后
        if (hostRow.root_id !== targetRow.root_id || Number(targetRow.sort) <= Number(hostRow.sort)) {
            return false;
        }

        const hostLevel = parseInt(String(hostRow.subtype || "h1").replace(/\D/g, "") || "1", 10);

        // 检查两者之间是否存在同级或更高级的标题阻断 (sort 位于 host 与 target 之间，且 level <= hostLevel)
        const checkNextHeadingSql = `
            SELECT id FROM blocks 
            WHERE root_id = '${hostRow.root_id}' 
              AND type = 'h' 
              AND sort > ${hostRow.sort} 
              AND sort < ${targetRow.sort} 
              AND CAST(SUBSTR(subtype, 2) AS INTEGER) <= ${hostLevel} 
            LIMIT 1
        `;
        const checkRes = await post("/api/query/sql", { stmt: checkNextHeadingSql });
        const checkRows = Array.isArray(checkRes) ? checkRes : (checkRes?.data || []);
        
        return checkRows.length === 0;
    } catch (_) {
        return false;
    }
}

export async function dispatchScopeEvents(
    targetBlockId: string, 
    eventName: "block_created" | "block_content_changed" | "block_attribute_changed" | "task_completed"
) {
    if (!targetBlockId) return;

    try {
        const targetInfo = await resolveTargetBlockInfo(targetBlockId);
        if (!targetInfo) return;

        const matchesFilter = (filter?: string): boolean => {
            if (!filter || filter === "all") return true;
            if (filter === "list") return targetInfo.isList;
            if (filter === "todo") return targetInfo.isTodo;
            if (filter === "heading") return targetInfo.isHeading;
            if (filter === "paragraph") return targetInfo.isParagraph;
            if (filter === "doc") return targetInfo.isDoc;
            if (filter === "av") return targetInfo.isAv;
            return false;
        };

        // 1. 检索可能作为宿主 (Host) 的所有候选块 (自身、同文档块、祖先文档块)
        const hostCandidates: HostCandidate[] = [];

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

        // 2. 对每个宿主拥有的 Supertag 规则进行作用域与过滤器核验
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
                } else {
                    // 非 self 作用域下，目标绝不能是宿主块自身或提权至宿主自身
                    if (host.id === targetInfo.id || host.id === targetInfo.actualTargetId) {
                        scopeMatched = false;
                    } else if (scope === "current_doc") {
                        scopeMatched = (host.root_id === targetInfo.root_id || host.id === targetInfo.root_id);
                    } else if (scope === "inner_blocks") {
                        scopeMatched = (targetInfo.parent_id === host.id || (host.id === targetInfo.root_id));
                    } else if (scope === "subtree") {
                        // 1. 若宿主是文档本身，匹配该文档下的所有子孙内容
                        if (host.id === targetInfo.root_id) {
                            scopeMatched = true;
                        } else {
                            // 2. 直接父子关系检测 (注：列表项内部的主文本段落属于列表项自身，已在上述 host.id === actualTargetId 拦截)
                            if (targetInfo.parent_id === host.id) {
                                scopeMatched = true;
                            }

                            // 3. DOM 层面标题折叠子树 / 大纲辖区检测 (思源标题与子块为同级兄弟节点)
                            if (!scopeMatched && targetInfo.domEl) {
                                const hostDom = document.querySelector(`[data-node-id="${host.id}"]`);
                                if (hostDom) {
                                    scopeMatched = isBlockInsideHeadingSubtree(hostDom, targetInfo.domEl);
                                }
                            }

                            // 4. 思源 SQLite blocks 表真实物理拓扑 (sort 排序序号) 大纲辖区精准核验
                            if (!scopeMatched && targetInfo.id && host.id) {
                                scopeMatched = await isSqlHeadingSubtree(host.id, targetInfo.id);
                            }
                        }
                    }
                }

                // 3. 前置断言检查 (Condition Predicate)
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
                        content: targetInfo.markdown || targetInfo.domEl?.textContent || "",
                        markdown: targetInfo.markdown || "",
                        tags: targetInfo.tags,
                        type: targetInfo.type,
                        subType: targetInfo.subType
                    });
                }

                if (filterMatched && scopeMatched && conditionMatched) {
                    const targetIds: string[] = [];

                    if (targetInfo.type === "l") {
                        // 🌟 目标是列表容器：回车或更新时，收集容器内所有直接子列表项
                        if (targetInfo.domEl) {
                            const childItems = Array.from(targetInfo.domEl.querySelectorAll(':scope > [data-type="NodeListItem"]'));
                            for (const li of childItems) {
                                const liId = li.getAttribute("data-node-id");
                                if (liId) targetIds.push(liId);
                            }
                        }
                        if (targetIds.length === 0) {
                            try {
                                const domRes = await post("/api/block/getBlockDOM", { id: targetInfo.id });
                                const domHtml = domRes?.data?.dom || domRes?.dom || "";
                                if (domHtml) {
                                    const tpl = document.createElement("template");
                                    tpl.innerHTML = domHtml;
                                    const directListItems = Array.from(tpl.content.firstElementChild?.querySelectorAll(':scope > [data-type="NodeListItem"]') || []);
                                    for (const li of directListItems) {
                                        const liId = li.getAttribute("data-node-id");
                                        if (liId) targetIds.push(liId);
                                    }
                                }
                            } catch (_) {}
                        }
                    }

                    if (targetIds.length === 0) {
                        targetIds.push(targetInfo.actualTargetId);
                    }

                    for (const actualTargetId of targetIds) {
                        // 严格守卫 1: 非 self 作用域下绝不能对宿主自身执行
                        if (scope !== "self" && (actualTargetId === host.id || targetInfo.id === host.id)) {
                            continue;
                        }

                        // 严格守卫 2: 若目标块自身已拥有该宿主标签 (如自身已是 #project)，则作为同级/独立实体，不被父级同类标签级联处理
                        const targetTags = globalSupertagsCache.get(actualTargetId) || (actualTargetId === targetInfo.id ? targetInfo.tags : []);
                        const cleanTargetTags = targetTags.map(t => cleanTagString(t));
                        if (scope !== "self" && cleanTargetTags.includes(cleanTag)) {
                            continue;
                        }

                        const triggerKey = `${host.id}:${cleanTag}:${eventName}:${actualTargetId}`;
                        if (!triggeredKeys.has(triggerKey)) {
                            triggeredKeys.add(triggerKey);
                            await triggerConditionalCommands(host.id, cleanTag, eventName as TriggerEventName, {
                                targetBlockId: actualTargetId,
                                hostBlockId: host.id
                            });
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("[Supertag-Scope] Failed to dispatch scope events:", e);
    }
}
