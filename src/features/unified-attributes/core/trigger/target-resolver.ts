/**
 * trigger/target-resolver.ts
 *
 * 目标块实时类型检测、DOM/AST 解析与列表项 ID 提权定位器
 */

import { post } from "../../../../shared/api-client/request";
import { parseSupertags } from "../supertag-diff";
import { TargetBlockInfo } from "./types";

function mapNodeTypeToSiYuanType(rawType: string): string {
    switch (rawType) {
        case "NodeList": return "l";
        case "NodeListItem": return "i";
        case "NodeParagraph": return "p";
        case "NodeHeading": return "h";
        case "NodeBlockquote": return "b";
        case "NodeSuperBlock": return "sb";
        case "NodeTable": return "table";
        case "NodeAttributeView": return "av";
        default: return "";
    }
}

export async function resolveTargetBlockInfo(targetBlockId: string): Promise<TargetBlockInfo | null> {
    if (!targetBlockId) return null;

    let domEl = document.querySelector(`[data-node-id="${targetBlockId}"]`) as HTMLElement | null;
    let domType = "";
    let domSubType = "";

    if (domEl) {
        domType = mapNodeTypeToSiYuanType(domEl.getAttribute("data-type") || "");
        domSubType = domEl.getAttribute("data-subtype") || "";
    }

    let rawInfo: {
        id: string;
        root_id: string;
        parent_id: string;
        path: string;
        type: string;
        subType: string;
        markdown: string;
        tags: string[];
    } | null = null;

    // 1. 通过思源官方 HTTP SQL API (/api/query/sql) 查询持久化元数据
    try {
        const sqlRes = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, parent_id, path, type, subtype, markdown, ial FROM blocks WHERE id = '${targetBlockId}' LIMIT 1`
        });
        const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
        if (rows.length > 0) {
            const row = rows[0];
            rawInfo = {
                id: String(row.id || ""),
                root_id: String(row.root_id || ""),
                parent_id: String(row.parent_id || ""),
                path: String(row.path || ""),
                type: String(row.type || domType),
                subType: String(row.subtype || row.subType || domSubType),
                markdown: String(row.markdown || ""),
                tags: parseSupertags(String(row.ial || ""))
            };
        }
    } catch (queryErr) {
        console.warn("[Supertag-Scope] /api/query/sql failed:", queryErr);
    }

    // 2. 若 SQL 尚未建立索引，从 getBlockDOM 及 getBlockInfo 获取第一手实时数据
    if (!rawInfo) {
        try {
            let liveType = domType;
            let liveSubType = domSubType;

            if (!liveType) {
                const domRes = await post("/api/block/getBlockDOM", { id: targetBlockId });
                const domHtml = domRes?.data?.dom || domRes?.dom || "";
                if (domHtml) {
                    const tpl = document.createElement("template");
                    tpl.innerHTML = domHtml;
                    const rootEl = tpl.content.firstElementChild;
                    if (rootEl) {
                        liveType = mapNodeTypeToSiYuanType(rootEl.getAttribute("data-type") || "");
                        liveSubType = rootEl.getAttribute("data-subtype") || "";
                    }
                }
            }

            const infoRes = await post("/api/block/getBlockInfo", { id: targetBlockId });
            const rootID = infoRes?.rootID || infoRes?.root_id || "";
            const parentID = infoRes?.parentID || infoRes?.parent_id || "";
            const path = infoRes?.path || "";
            const attrRes = await post("/api/attr/getBlockAttrs", { id: targetBlockId });
            const ial = attrRes?.["custom-supertags"] || "";

            rawInfo = {
                id: targetBlockId,
                root_id: rootID,
                parent_id: parentID,
                path: path,
                type: liveType,
                subType: liveSubType,
                markdown: "",
                tags: parseSupertags(ial)
            };
        } catch (err) {
            console.error("[Supertag-Scope] 实时解析目标块失败:", err);
            return null;
        }
    }

    if (!domEl) {
        domEl = document.querySelector(`[data-node-id="${targetBlockId}"]`) as HTMLElement | null;
    }

    const closestListItem = domEl?.closest('[data-type="NodeListItem"]');
    const closestList = domEl?.closest('[data-type="NodeList"]');
    const childListItem = domEl?.querySelector('[data-type="NodeListItem"]');

    let isList = rawInfo.type === "l" || 
                 rawInfo.type === "i" ||
                 Boolean(closestListItem) ||
                 Boolean(closestList) ||
                 Boolean(childListItem);

    let parentIsListItem = false;
    if (!isList && rawInfo.parent_id) {
        const parentDom = document.querySelector(`[data-node-id="${rawInfo.parent_id}"]`);
        if (parentDom) {
            const pType = parentDom.getAttribute("data-type");
            if (pType === "NodeListItem" || pType === "NodeList" || parentDom.classList.contains("li") || parentDom.classList.contains("list")) {
                isList = true;
                parentIsListItem = true;
            }
        }
        if (!isList) {
            try {
                const pDomRes = await post("/api/block/getBlockDOM", { id: rawInfo.parent_id });
                const pHtml = pDomRes?.data?.dom || pDomRes?.dom || "";
                if (pHtml.includes('data-type="NodeListItem"') || pHtml.includes('data-type="NodeList"')) {
                    isList = true;
                    parentIsListItem = true;
                }
            } catch (_) {}
        }
    }

    const isTodo = (rawInfo.subType === "t") ||
                   (rawInfo.type === "l" && rawInfo.subType === "t") ||
                   (rawInfo.type === "i" && rawInfo.subType === "t") ||
                   Boolean(domEl?.closest('.li[data-subtype="t"], [data-subtype="t"], [data-task]'));

    const isHeading = rawInfo.type === "h";
    const isParagraph = rawInfo.type === "p";
    const isDoc = rawInfo.type === "d";
    const isAv = rawInfo.type === "av";

    // 🌟 列表块适配：优先提权并绑定到列表项 (NodeListItem)，若目标是列表容器，找到其首个列表项
    let actualTargetId = rawInfo.id;
    if (isList) {
        if (rawInfo.type === "i") {
            actualTargetId = rawInfo.id;
        } else if (closestListItem) {
            actualTargetId = closestListItem.getAttribute("data-node-id") || actualTargetId;
        } else if (parentIsListItem && rawInfo.parent_id) {
            actualTargetId = rawInfo.parent_id;
        } else if (domEl) {
            if (rawInfo.type === "l") {
                const firstLi = domEl.querySelector('[data-type="NodeListItem"]') as HTMLElement | null;
                if (firstLi) {
                    actualTargetId = firstLi.getAttribute("data-node-id") || actualTargetId;
                }
            }
        }
    }

    if (rawInfo.type === "l" && actualTargetId === rawInfo.id) {
        try {
            const domRes = await post("/api/block/getBlockDOM", { id: rawInfo.id });
            const domHtml = domRes?.data?.dom || domRes?.dom || "";
            if (domHtml) {
                const match = domHtml.match(/data-type="NodeListItem"[^>]*data-node-id="([^"]+)"/);
                if (match && match[1]) {
                    actualTargetId = match[1];
                }
            }
        } catch (_) {}
    }

    return {
        ...rawInfo,
        isList,
        isTodo,
        isHeading,
        isParagraph,
        isDoc,
        isAv,
        actualTargetId,
        domEl
    };
}
