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

    const wysiwyg = hostHeadingEl.closest(".protyle-wysiwyg");
    if (!wysiwyg || !wysiwyg.contains(targetEl)) {
        return false;
    }

    // 找到 targetEl 在 wysiwyg 下的直接子节点 (顶级块)
    let targetTop: Element | null = targetEl;
    while (targetTop && targetTop.parentElement && targetTop.parentElement !== wysiwyg) {
        targetTop = targetTop.parentElement;
    }
    if (!targetTop) return false;

    // 从 hostHeadingEl 向后扫描兄弟节点，直到遇到同级或更高级别的标题
    let curr = hostHeadingEl.nextElementSibling;
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

export async function dispatchScopeEvents(
    targetBlockId: string, 
    eventName: "block_created" | "block_content_changed" | "block_attribute_changed" | "task_completed"
) {
    if (!targetBlockId) return;

    try {
        const targetInfo = await resolveTargetBlockInfo(targetBlockId);
        if (!targetInfo) return;

        console.log(`[Supertag-Scope] 触发事件: ${eventName}, 目标块Id: ${targetBlockId}, type: ${targetInfo.type}, subType: ${targetInfo.subType}, isList: ${targetInfo.isList}, isTodo: ${targetInfo.isTodo}`);

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

        console.log(`[Supertag-Scope] 检索到宿主候选池 (${hostCandidates.length} 个):`, hostCandidates);

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
                } else if (scope === "current_doc") {
                    // 仅当目标不是宿主自身时，同文档其他块匹配
                    scopeMatched = (host.id !== targetInfo.id) && (host.root_id === targetInfo.root_id || host.id === targetInfo.root_id);
                } else if (scope === "inner_blocks") {
                    scopeMatched = (host.id !== targetInfo.id) && (targetInfo.parent_id === host.id || (host.id === targetInfo.root_id));
                } else if (scope === "subtree") {
                    // 1. 若宿主是文档本身，匹配该文档下除了宿主自身外的所有子孙内容
                    if (host.id === targetInfo.root_id) {
                        scopeMatched = (host.id !== targetInfo.id);
                    } else if (host.id !== targetInfo.id) {
                        // 2. 直接父子关系检测
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

                        // 4. 思源 blocks 表中的 HeadingParent 语义子树多级检测 (支持段落 -> 列表项 -> 列表容器 -> 标题)
                        if (!scopeMatched && targetInfo.id && host.id) {
                            try {
                                const sqlStmt = `
                                    SELECT id, parent_id FROM blocks 
                                    WHERE id = '${targetInfo.id}' 
                                       OR id = '${targetInfo.parent_id}'
                                `;
                                const headingParentRes = await post("/api/query/sql", { stmt: sqlStmt });
                                const hRows = Array.isArray(headingParentRes) ? headingParentRes : (headingParentRes?.data || []);
                                if (hRows.some((r: any) => String(r.parent_id) === host.id)) {
                                    scopeMatched = true;
                                }
                            } catch (_) {}
                        }
                    }
                }

                console.log(`[Supertag-Scope] 规则评估: tag=#${cleanTag}, host=${host.id}, scope=${scope}(匹配:${scopeMatched}), filter=${filter}(匹配:${filterMatched})`);

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
                        console.log(`[Supertag-Scope] 目标为列表容器 ${targetInfo.id}，展开子列表项 (${targetIds.length} 个):`, targetIds);
                    }

                    if (targetIds.length === 0) {
                        targetIds.push(targetInfo.actualTargetId);
                    }

                    for (const actualTargetId of targetIds) {
                        const triggerKey = `${host.id}:${cleanTag}:${eventName}:${actualTargetId}`;
                        if (!triggeredKeys.has(triggerKey)) {
                            triggeredKeys.add(triggerKey);
                            console.log(`[Supertag-Scope] 🚀 触发级联执行: triggerKey=${triggerKey}, actualTargetId=${actualTargetId}`);
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
