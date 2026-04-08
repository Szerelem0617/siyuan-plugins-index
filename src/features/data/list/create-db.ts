import { client } from "../../../shared/api-client";
import { showMessage } from "siyuan";
import { ATTR_LINKED_AV, ATTR_LINKED_AV_BLOCK, ATTR_LINKED_LIST, ATTR_ITEM_ID, ATTR_LAST_SYNC } from "../../../shared/constants";
import { settings } from "../../../core/settings";
import { post } from "../../../shared/api-client/request";
import { formatDate } from "../../../shared/utils";
import { confirmTransformation } from "../../../shared/utils/transformation-utils";
import { transformToTree } from "../../builder/transformation";
import { getBlockAttribute } from "../../../shared/utils/dom-utils";
import { loadDbConfig, syncInheritanceToDb } from "../av-setting/db-config";
export interface DBItemProp {
    icon: string;
    titleImg: string;
}

function extractBoundBlockIdFromDOM(pChild: Element | null): string | null {
    if (!pChild) return null;

    // The attributes are stored on the parent NodeListItem, NOT the NodeParagraph itself.
    const parentListItem = pChild.parentElement;
    const explicitSubdoc = parentListItem?.getAttribute("custom-index-subdoc-id");
    if (explicitSubdoc) return explicitSubdoc;

    // Second try: Find any siyuan://blocks/ link in the paragraph
    const links = pChild.querySelectorAll('span[data-type="a"], span[data-type="block-ref"]');
    for (let i = 0; i < links.length; i++) {
        const href = links[i].getAttribute("data-href");
        if (href && href.startsWith("siyuan://blocks/")) {
            const id = href.replace("siyuan://blocks/", "");
            return id;
        }
        // For block-ref, the ID is in data-id
        const dataId = links[i].getAttribute("data-id");
        if (dataId) return dataId;
    }

    return null;
}

/**
 * Bulk fetches the icon and title-img for all targeted block IDs.
 * Filters out fallback text emojis (like 📄) if the document has a real icon.
 */
async function fetchDocumentIconsForDBItems(targetIds: string[]): Promise<Record<string, DBItemProp>> {
    const itemPropsMap: Record<string, DBItemProp> = {};
    if (!targetIds || targetIds.length === 0) return itemPropsMap;

    const formattedIds = targetIds.filter(id => id).map(id => `'${id}'`);
    if (formattedIds.length === 0) return itemPropsMap;

    console.log(`[Data-Debug] fetchDocumentIconsForDBItems requested for ${formattedIds.length} items`);

    const chunkSize = 50;
    try {
        for (let i = 0; i < formattedIds.length; i += chunkSize) {
            const chunk = formattedIds.slice(i, i + chunkSize);
            const sqlStr = `SELECT id, ial, type FROM blocks WHERE id IN (${chunk.join(",")})`;
            const sqlRes = await client.sql({ stmt: sqlStr });

            if (sqlRes && sqlRes.data) {
                sqlRes.data.forEach((row: any) => {
                    let icon = "";
                    let titleImg = "";

                    if (row.ial) {
                        const iconMatch = row.ial.match(/icon="([^"]+)"/);
                        if (iconMatch) {
                            icon = iconMatch[1];
                            // Translate backend hex to emoji if needed
                            if (/^[0-9a-fA-F-]+$/.test(icon)) {
                                icon = icon.split('-').map(code => String.fromCodePoint(parseInt(code, 16))).join('');
                            }
                        }

                        const imgMatch = row.ial.match(/title-img="([^"]+)"/);
                        if (imgMatch) titleImg = imgMatch[1];
                    }

                    itemPropsMap[row.id] = { icon, titleImg };
                });
            }
        }
        console.log(`[Data-Debug] fetchDocumentIconsForDBItems successfully retrieved icons for ${Object.keys(itemPropsMap).length} items`);
    } catch (e) {
        console.error("[db-icon-sync] Error fetching document icons for DB bulk insert", e);
    }

    return itemPropsMap;
}

/**
 * 创建数据库逻辑
 */
export async function createDatabaseWithBlocks(sourceBlockIds: string[], silent: boolean = false, skipTemplateCols: boolean = false) {
    if (!sourceBlockIds || sourceBlockIds.length === 0) return;

    console.log(`[createDatabaseWithBlocks] Called with silent=${silent}, skipTemplateCols=${skipTemplateCols}, IDs=`, sourceBlockIds);

    const lastBlockId = sourceBlockIds[sourceBlockIds.length - 1];

    try {
        const sql = `SELECT root_id FROM attributes WHERE name IN ('custom-index-command-db', 'custom-index-type-db') AND root_id = (SELECT root_id FROM blocks WHERE id = '${lastBlockId}' LIMIT 1) LIMIT 1`;
        const res = await post("/api/query/sql", { stmt: sql });
        if (res && res.length > 0) {
            console.log(`[createDatabaseWithBlocks] Detected system DB, forcing skipTemplateCols to true`);
            skipTemplateCols = true;
        }
    } catch (e) {
        console.warn(`[createDatabaseWithBlocks] Error checking system DB status:`, e);
    }

    try {
        // --- 0. 预检查并执行可能需要的转换 (Index/Outline -> Static Tree) ---
        for (const listId of sourceBlockIds) {
            const initialAttrsRes = await client.getBlockAttrs({ id: listId });
            const initialAttrs = initialAttrsRes.data || {};

            if (initialAttrs["custom-index-create"] || initialAttrs["custom-outline-create"]) {
                const confirmed = await confirmTransformation('database');
                if (!confirmed) return; // 用户取消

                const success = await transformToTree(listId);
                if (!success) {
                    // @ts-ignore
                    client.pushErrMsg({ msg: "转换失败，无法创建数据库", timeout: 3000 });
                    return;
                }
            }
        }

        // --- 0.5 检测是否有现成的绑定关系 ---
        let existingAvID = null;
        let existingAvBlockID = null;
        for (const listId of sourceBlockIds) {
            const attrsRes = await client.getBlockAttrs({ id: listId });
            const attrs = attrsRes.data || {};

            if (attrs[ATTR_LINKED_AV]) {
                const linkedAvId = attrs[ATTR_LINKED_AV];
                const linkedAvBlockId = attrs[ATTR_LINKED_AV_BLOCK];

                let isDeadLink = false;
                if (linkedAvBlockId) {
                    try {
                        const blockInfo = await post("/api/block/getBlockInfo", { id: linkedAvBlockId });
                        if (!blockInfo) isDeadLink = true;
                    } catch (e) {
                        isDeadLink = true;
                    }
                }

                if (!isDeadLink) {
                    try {
                        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: linkedAvId });
                        if (keysRes) {
                            existingAvID = linkedAvId;
                            existingAvBlockID = linkedAvBlockId;
                            break;
                        }
                    } catch (e) {
                        console.warn(`[Data] AV Check failed for [${linkedAvId}]`, e);
                    }
                }
            }
        }

        // --- 1. 递归解析列表项 ---
        let allItems: any[] = [];
        const traverse = (element: Element, level: number, parentId: string | null) => {
            for (let i = 0; i < element.children.length; i++) {
                const child = element.children[i];
                const type = child.getAttribute("data-type");

                if (type === "NodeListItem") {
                    const originalId = child.getAttribute("data-node-id");
                    let savedItemID = getBlockAttribute(child as HTMLElement, ATTR_ITEM_ID);

                    if (originalId) {
                        // @ts-ignore
                        const newItemID = window.Lute.NewNodeID();
                        allItems.push({ originalId, newItemID, level, parentId, savedItemID });
                        traverse(child, level, originalId);
                    }
                } else if (type === "NodeList") {
                    traverse(child, level + 1, parentId);
                } else {
                    traverse(child, level, parentId);
                }
            }
        };

        for (const listId of sourceBlockIds) {
            const domRes = await client.getBlockDOM({ id: listId });
            if (domRes.data && domRes.data.dom) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = domRes.data.dom;
                if (tempDiv.firstElementChild) traverse(tempDiv.firstElementChild, 1, null);
            }
        }

        if (allItems.length === 0) {
            if (!silent) showMessage("未找到任何列表项", 3000, "info");
            return;
        }

        let realAvID = existingAvID;
        let blockID = existingAvBlockID || existingAvID;
        let viewID = null;

        if (!existingAvID) {
            // --- [NEW DB] ---
            const createRes = await client.insertBlock({
                dataType: "markdown",
                data: `<div data-type="NodeAttributeView" data-av-type="table"></div>`,
                previousID: lastBlockId
            });

            if (!createRes.data || !createRes.data[0]) throw new Error("初始化数据库块失败");
            blockID = createRes.data[0].doOperations[0].id;
            const createdHTML = createRes.data[0].doOperations[0].data;
            realAvID = blockID;
            const avIdMatch = createdHTML.match(/data-av-id="([^"]+)"/);
            if (avIdMatch && avIdMatch[1]) realAvID = avIdMatch[1];

            const initData = await post("/api/av/renderAttributeView", {
                id: realAvID,
                page: 1,
                pageSize: 20
            });
            viewID = initData.views && initData.views[0] ? initData.views[0].id : null;
            if (!viewID) throw new Error("无法获取初始视图 ID");

            // 清理默认列
            const initialKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: realAvID });
            const currentKeys = Array.isArray(initialKeysRes) ? initialKeysRes : (initialKeysRes.keys || []);
            const defaultSelectKey = currentKeys.find((k: any) => k.type === "select");
            if (defaultSelectKey) {
                await post("/api/av/removeAttributeViewKey", {
                    avID: realAvID,
                    keyID: defaultSelectKey.id
                });
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } else {
            if (!silent) showMessage(`正在更新现有数据库...`, 3000, "info");
            const initData = await post("/api/av/renderAttributeView", { id: realAvID });
            viewID = initData.views && initData.views[0] ? initData.views[0].id : null;
        }

        // --- [COMMON] 4. 确保字段存在 ---
        let keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: realAvID });
        let currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
        let lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";

        let levelKeyId = null;
        let fatherKeyId = null;
        let pathKeyId = null;
        let iconKeyId = null;
        let titleImgKeyId = null;
        let templateKeyId = null;

        const ensureKey = async (name: string, type: string, icon: string) => {
            let key = currentKeys.find((k: any) => k.name === name);
            if (key) {
                lastKeyID = key.id;
                return key.id;
            } else {
                if (existingAvID) {
                    console.log(`[createDatabaseWithBlocks] DB already exists, skipping creation of column: ${name}`);
                    return null;
                }

                // @ts-ignore
                const newID = window.Lute.NewNodeID();
                await post("/api/av/addAttributeViewKey", {
                    avID: realAvID,
                    keyID: newID,
                    keyName: name,
                    keyType: type,
                    keyIcon: icon,
                    previousKeyID: lastKeyID
                });
                lastKeyID = newID;
                return newID;
            }
        };

        try {
            levelKeyId = await ensureKey("Level", "number", "iconSort");
            fatherKeyId = await ensureKey("Father", "text", "iconLink");
            pathKeyId = await ensureKey("Path", "text", "iconMap");

            // Always add icon column
            iconKeyId = await ensureKey("icon", "text", "iconEmoji");

            // Optional template columns
            console.log(`[createDatabaseWithBlocks] Check template cols: settings=${settings.get("dbAddTemplateCols")}, skipTemplateCols=${skipTemplateCols}`);
            if (settings.get("dbAddTemplateCols") && !skipTemplateCols) {
                console.log(`[createDatabaseWithBlocks] Adding template cols...`);
                titleImgKeyId = await ensureKey("title-img", "text", "iconImage");
                templateKeyId = await ensureKey("template", "text", "iconLayout");
            } else {
                console.log(`[createDatabaseWithBlocks] Skipping template cols.`);
            }

            await new Promise(resolve => setTimeout(resolve, 300));

            // Ensure Level, Father, Path are hidden only on creation
            if (viewID && !existingAvID) {
                const hideOps: any[] = [];
                if (levelKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: levelKeyId, data: true });
                if (fatherKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: fatherKeyId, data: true });
                if (pathKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: pathKeyId, data: true });

                // Explicitly ensure icon is NOT hidden
                if (iconKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: iconKeyId, data: false });

                // Hide entry icons for the primary key (Show Entry Icons = off)
                hideOps.push({ action: "setAttrViewShowIcon", avID: realAvID, viewID: viewID, blockID: blockID, data: false });

                if (hideOps.length > 0) {
                    await post("/api/transactions", {
                        app: "plugin-index",
                        reqId: Date.now(),
                        transactions: [{ doOperations: hideOps }]
                    });
                }
            }

            if (!existingAvID && levelKeyId && viewID) {
                let avName = "新数据库";
                if (allItems.length > 0) {
                    try {
                        const firstItemDom = await client.getBlockDOM({ id: allItems[0].originalId });
                        const tempDiv = document.createElement("div");
                        tempDiv.innerHTML = firstItemDom.data.dom;
                        const itemElement = tempDiv.firstElementChild;
                        if (itemElement) {
                            let textParts = [];
                            for (let i = 0; i < itemElement.children.length; i++) {
                                const child = itemElement.children[i];
                                const type = child.getAttribute("data-type");
                                const className = child.className || "";
                                // 忽略子列表和操作按钮
                                if (type !== "NodeList" && !className.includes("protyle-action")) {
                                    textParts.push((child as HTMLElement).innerText || "");
                                }
                            }
                            const extractedName = textParts.join("").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
                            if (extractedName) {
                                avName = extractedName.substring(0, 30);
                            }
                        }
                        console.log("[Data] Extracted avName from first item:", avName);
                    } catch (e) {
                        console.error("[Data] Failed to get name from first item:", e);
                    }
                }

                console.log("[Data] Naming Database:", { avID: realAvID, viewID, avName });

                const ops: any[] = [
                    {
                        action: "setAttrViewName",
                        // 陷阱：此处必须使用 id 而不是 avID，与大多数 AV Action 不一致
                        id: realAvID,
                        data: avName
                    },
                    {
                        action: "doUpdateUpdated",
                        id: blockID, // 数据库块的 ID
                        data: formatDate(new Date())
                    }
                ];

                await post("/api/transactions", {
                    app: "plugin-index",
                    reqId: Date.now() + 100, // Ensure strictly later timestamp
                    transactions: [{ doOperations: ops }]
                });
            }

        } catch (e) {
            throw new Error("创建/检查字段或筛选失败");
        }

        // --- 5. 插入与更新数据 ---
        // 重新遍历一次来计算 Path，或者直接修改 traverse
        // Since we need path, let's re-run traverse logic or adapt it.
        // Wait, allItems is already populated by traverse() above.
        // We need to clear it and run traverse again with path logic, OR modify the first traverse.
        // Let's modify the first traverse.
        allItems = [];
        let rootLevelRank = 1;

        const traverseWithContext = (element: Element, level: number, parentId: string | null, ancestorPath: string, startingRank: number = 1) => {
            let currentItemRank = startingRank;
            for (let i = 0; i < element.children.length; i++) {
                const child = element.children[i];
                const type = child.getAttribute("data-type");

                if (type === "NodeListItem") {
                    const originalId = child.getAttribute("data-node-id");
                    if (originalId) {
                        // @ts-ignore
                        const newItemID = window.Lute.NewNodeID();
                        const rankStr = currentItemRank.toString().padStart(3, '0');
                        const currentPath = ancestorPath ? `${ancestorPath}/${rankStr}-${originalId}` : `/${rankStr}-${originalId}`;

                        let savedItemID = getBlockAttribute(child as HTMLElement, ATTR_ITEM_ID);
                        const pChild = child.querySelector('div[data-type="NodeParagraph"]');
                        let subDocId = extractBoundBlockIdFromDOM(pChild);

                        allItems.push({ originalId, newItemID, level: level, parentId, savedItemID, path: currentPath, subDocId });
                        // 深入处理子项之前，注意：子项内部的 Rank 始终从 1 开始。
                        // 传入 currentPath（带 rank）而非 pureAncestorPath，保证所有层级 path 格式统一
                        traverseWithContext(child, level, originalId, currentPath, 1);
                        currentItemRank++;
                    }
                } else if (type === "NodeList") {
                    // NodeList 检测：如果是嵌套列表（有 parentId），则它是下一级的容器。
                    if (parentId) {
                        traverseWithContext(child, level + 1, parentId, ancestorPath, 1);
                    } else {
                        currentItemRank = traverseWithContext(child, level, null, "", currentItemRank);
                    }
                } else {
                    currentItemRank = traverseWithContext(child, level, parentId, ancestorPath, currentItemRank);
                }
            }
            return currentItemRank;
        };

        for (const listId of sourceBlockIds) {
            const domRes = await client.getBlockDOM({ id: listId });
            if (domRes.data && domRes.data.dom) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = domRes.data.dom;
                const rootEl = tempDiv.firstElementChild;
                if (rootEl) {
                    const type = rootEl.getAttribute("data-type");
                    if (type === "NodeListItem") {
                        // 如果传入的是个别项而非整个列表，手动处理顶层项
                        const originalId = rootEl.getAttribute("data-node-id");
                        if (originalId) {
                            // @ts-ignore
                            const newItemID = window.Lute.NewNodeID();
                            const rankStr = rootLevelRank.toString().padStart(3, '0');
                            const currentPath = `/${rankStr}-${originalId}`;
                            let savedItemID = getBlockAttribute(rootEl as HTMLElement, ATTR_ITEM_ID);
                            const pChild = rootEl.querySelector('div[data-type="NodeParagraph"]');
                            let subDocId = extractBoundBlockIdFromDOM(pChild);

                            allItems.push({ originalId, newItemID, level: 1, parentId: null, savedItemID, path: currentPath, subDocId });
                            traverseWithContext(rootEl, 1, originalId, currentPath, 1);
                            rootLevelRank++;
                        }
                    } else {
                        rootLevelRank = traverseWithContext(rootEl, 1, null, "", rootLevelRank);
                    }
                }
            }
        }

        let itemIDMap: Record<string, string> = {};

        // Fix: If we are creating a NEW database (because the old one was dead or didn't exist),
        // we MUST ignore the savedItemID from the DOM because they belong to the old/dead AV.
        if (!existingAvID) {
            allItems.forEach(item => item.savedItemID = null);
        }

        const activeRowIds = new Set<string>();
        const currentDataStore: Record<string, any> = {}; // itemID -> { path, level, ... }

        if (existingAvID) {
            try {
                let currentPage = 1;
                while (true) {
                    const renderRes = await post("/api/av/renderAttributeView", {
                        id: realAvID,
                        page: currentPage,
                        pageSize: 100 // Smaller chunks for reliability
                    });

                    const view = renderRes.view || renderRes;
                    const rows = view.rows || [];
                    const columns = view.columns || [];

                    if (rows.length === 0) break;

                    const pathIdx = columns.findIndex((c: any) => c.keyID === pathKeyId);
                    const levelIdx = columns.findIndex((c: any) => c.keyID === levelKeyId);
                    const fatherIdx = columns.findIndex((c: any) => c.keyID === fatherKeyId);

                    rows.forEach((row: any) => {
                        activeRowIds.add(row.id);
                        currentDataStore[row.id] = {
                            path: pathIdx !== -1 ? row.cells[pathIdx]?.value?.text?.content : undefined,
                            level: levelIdx !== -1 ? row.cells[levelIdx]?.value?.number?.content : undefined,
                            father: fatherIdx !== -1 ? row.cells[fatherIdx]?.value?.text?.content : undefined
                        };

                        if (row.cells) {
                            const blockCell = row.cells.find((c: any) => c.valueType === "block");
                            if (blockCell && blockCell.value && blockCell.value.block && blockCell.value.block.id) {
                                itemIDMap[blockCell.value.block.id] = row.id;
                            }
                        }
                    });

                    if (rows.length < 100) break; // Reached last page
                    currentPage++;
                    if (currentPage > 50) break; // Guard for sanity
                }
            } catch (e) {
                console.error("[Data] Failed to render AV to check rows", e);
            }
        }

        allItems.forEach(item => {
            // If the item had a saved itemID but it's not in the block map, verify if it still exists in the DB
            if (item.savedItemID && !itemIDMap[item.originalId]) {
                if (existingAvID && !activeRowIds.has(item.savedItemID)) {
                    console.warn(`[Data] Dead saved ID detected for block ${item.originalId}: ${item.savedItemID}. Will regenerate.`);
                    item.savedItemID = null; // Blank it out to force a new creation
                } else {
                    itemIDMap[item.originalId] = item.savedItemID;
                }
            }
        });

        const newSrcs: any[] = [];
        const updateValues: any[] = [];
        const itemIDToBlockID: Record<string, string> = {};

        // Bulk fetch properties for newly transformed Index DB insertion
        // Optimization: Only fetch icons for items that are actually being added or updated
        const targetIds = allItems.filter(item => {
            const itemID = itemIDMap[item.originalId];
            return !itemID || !existingAvID; // Fetch if new item, dead item (itemID=null now), or if it's a full reconstruction
        }).map(item => item.subDocId).filter(id => id);
        
        let itemPropsMap: Record<string, { icon: string, titleImg: string }> = {};

        if (targetIds.length > 0 && (!existingAvID || iconKeyId || titleImgKeyId)) {
            console.log(`[Data] Syncing icons/props for ${targetIds.length} items needing update.`);
            itemPropsMap = await fetchDocumentIconsForDBItems(targetIds);
        }

        for (const item of allItems) {
            let itemID = itemIDMap[item.originalId];
            if (!itemID) {
                itemID = item.newItemID;
                newSrcs.push({ itemID: itemID, id: item.originalId, isDetached: false });
            }
            itemIDToBlockID[item.originalId] = itemID;

            // COMMON: Always update hierarchy fields, but ONLY if changed to prevent loops
            const currentItemData = itemID ? currentDataStore[itemID] : null;

            if (levelKeyId) {
                const newLevel = Number(item.level);
                if (!currentItemData || currentItemData.level != newLevel) {
                    updateValues.push({
                        keyID: levelKeyId,
                        itemID: itemID,
                        value: { type: "number", number: { content: newLevel, isNotEmpty: true } }
                    });
                }
            }
            if (fatherKeyId) {
                const newFather = item.parentId || "";
                if (!currentItemData || currentItemData.father !== newFather) {
                    updateValues.push({
                        keyID: fatherKeyId,
                        itemID: itemID,
                        value: { type: "text", text: { content: newFather } }
                    });
                }
            }
            if (pathKeyId) {
                const newPath = item.path || "";
                if (!currentItemData || currentItemData.path !== newPath) {
                    updateValues.push({
                        keyID: pathKeyId,
                        itemID: itemID,
                        value: { type: "text", text: { content: newPath } }
                    });
                }
            }

            // Target Doc Data injection
            const itemProps = item.subDocId ? itemPropsMap[item.subDocId] : null;

            // ONLY FOR NEW DB or if data needs to be populated
            if (!existingAvID) {
                let finalIcon = itemProps?.icon || "";
                if (finalIcon === "📄" || finalIcon === "📑" || finalIcon === "➖") finalIcon = "";
                if (finalIcon.startsWith("api/icon/") || finalIcon.includes(".")) finalIcon = "";

                if (iconKeyId) updateValues.push({ keyID: iconKeyId, itemID: itemID, value: { type: "text", text: { content: finalIcon } } });
                if (titleImgKeyId) updateValues.push({ keyID: titleImgKeyId, itemID: itemID, value: { type: "text", text: { content: itemProps?.titleImg || "" } } });
                if (templateKeyId) updateValues.push({ keyID: templateKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
            }
        }

        // --- Execute in Chunks ---
        if (newSrcs.length > 0) {
            console.log(`[Data] Adding ${newSrcs.length} blocks to AV in chunks...`);
            const chunkSizeSrc = 50;
            for (let i = 0; i < newSrcs.length; i += chunkSizeSrc) {
                const chunk = newSrcs.slice(i, i + chunkSizeSrc);
                await post("/api/av/addAttributeViewBlocks", { avID: realAvID, srcs: chunk });
            }
        }

        if (updateValues.length > 0) {
            console.log(`[Data] Sending batch update for ${updateValues.length} fields in chunks.`);
            const chunkSizeUpdate = 50;
            for (let i = 0; i < updateValues.length; i += chunkSizeUpdate) {
                const chunk = updateValues.slice(i, i + chunkSizeUpdate);
                await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: realAvID, values: chunk });
            }
        }

        // --- 6. 保存映射关系 (仅在未绑定或发生变化时) ---
        const savePromisesList = [];
        for (const [blockId, itemId] of Object.entries(itemIDToBlockID)) {
            if (!itemIDMap[blockId]) {
                savePromisesList.push({ id: blockId, attrs: { [ATTR_ITEM_ID]: itemId } });
            }
        }

        // CHUNK the setBlockAttrs calls to prevent overwhelming SiYuan for large lists
        if (savePromisesList.length > 0) {
            console.log(`[Data] Saving mapping relations for ${savePromisesList.length} items in chunks...`);
            const chunkSizeAttr = 20;
            for (let i = 0; i < savePromisesList.length; i += chunkSizeAttr) {
                const chunk = savePromisesList.slice(i, i + chunkSizeAttr);
                await Promise.all(chunk.map(op => client.setBlockAttrs(op)));
            }
        }

        // --- Chunked Linked AV binding ---
        if (sourceBlockIds.length > 0) {
            for (const listId of sourceBlockIds) {
                await client.setBlockAttrs({
                    id: listId,
                    attrs: {
                        [ATTR_LINKED_AV]: realAvID,
                        [ATTR_LINKED_AV_BLOCK]: blockID || ""
                    }
                });
            }
        }

        if (!existingAvID) {
            await client.setBlockAttrs({ id: blockID!, attrs: { [ATTR_LINKED_LIST]: sourceBlockIds.join(",") } });
        }

        // --- 8. Database-Level Inheritance Sync ---
        // Evaluate inheritance immediately so DB cells are the source of truth
        if (blockID) {
            const config = await loadDbConfig(blockID);
            if (config && config.inheritanceRules && config.inheritanceRules.length > 0) {
                await syncInheritanceToDb(realAvID, config, blockID);
            }
        }

        await post("/api/av/renderAttributeView", { id: realAvID, viewID: viewID, page: 1, pageSize: 50 });
        
        // --- 9. Update Sync Timestamp ---
        const now = formatDate(new Date()).replace(/-/g, "").replace(/:/g, "").replace(/ /g, "");
        for (const listId of sourceBlockIds) {
            await client.setBlockAttrs({ id: listId, attrs: { [ATTR_LAST_SYNC]: now } });
        }

        if (!silent) showMessage(`✅ 数据库已同步: ${newSrcs.length} 新增, ${updateValues.length / 5} 更新`);

    } catch (e: any) {
        console.error("[Data] Create DB Error:", e);
        if (!silent) showMessage(`❌ 操作失败: ${e.message}`, 3000, "error");
    }
}
