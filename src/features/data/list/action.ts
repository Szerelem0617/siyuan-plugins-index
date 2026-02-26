import { client } from "../../../shared/api-client";
import { showMessage } from "siyuan";
import { ATTR_LINKED_AV, ATTR_LINKED_AV_BLOCK, ATTR_LINKED_LIST, ATTR_ITEM_ID } from "../../../shared/constants";
import { settings } from "../../../core/settings";
import { post } from "../../../shared/api-client/request";
import { formatDate } from "../../../shared/utils";
import { getBlockAttribute } from "../../../shared/utils/dom-utils";

/**
 * 聚焦数据库视图：根据当前块的层级自动筛选 Level 或 Father
 */
export async function focusDatabaseView(blockId: string, protyle: any, mode: "level" | "siblings" | "descendants" = "level") {
    console.log(`[Data] Focusing [${blockId}] with mode [${mode}]`);

    try {
        let currentId = blockId;
        let linkedAvId = null;
        let targetLevel = 0;
        let loopCount = 0;

        // --- 1. 向上追溯计算层级并寻找绑定 AV ---
        while (currentId && loopCount < 40) {
            const res = await client.sql({
                stmt: `SELECT type, parent_id FROM blocks WHERE id = '${currentId}'`
            });
            if (!res.data || res.data.length === 0) break;

            const blockType = res.data[0].type;
            // 'l' 代表 NodeList
            if (blockType === "l") {
                targetLevel++;
            }

            const attrsRes = await client.getBlockAttrs({ id: currentId });
            const attrs = attrsRes.data || {};
            if (attrs[ATTR_LINKED_AV]) {
                const avId = attrs[ATTR_LINKED_AV];
                const avBlockId = attrs[ATTR_LINKED_AV_BLOCK];

                let isDeadLink = false;
                if (avBlockId) {
                    try {
                        const blockInfo = await post("/api/block/getBlockInfo", { id: avBlockId });
                        if (!blockInfo) isDeadLink = true;
                    } catch (e) {
                        isDeadLink = true;
                    }
                }

                if (!isDeadLink) {
                    linkedAvId = avId;
                    break;
                }
            }

            currentId = res.data[0].parent_id;
            if (!currentId) break;
            loopCount++;
        }

        if (!linkedAvId) {
            showMessage("❌ 未找到绑定的数据库（请确保该列表已创建数据库）", 3000, "info");
            return;
        }

        // --- 2. 获取 View ID 和 Keys ---
        const initData = await post("/api/av/renderAttributeView", { id: linkedAvId });
        const viewID = initData.view ? initData.view.id : (initData.views && initData.views[0] ? initData.views[0].id : null);
        if (!viewID) throw new Error("无法获取 View ID");

        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: linkedAvId });
        const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);

        let filterColumn = "";
        let filterValue: any = null;
        let showMsg = "";

        if (mode === "level") {
            const levelKey = currentKeys.find((k: any) => k.name === "Level");
            if (!levelKey) throw new Error("数据库中未找到 Level 字段，请先同步");
            if (targetLevel === 0) targetLevel = 1;
            filterColumn = levelKey.id;
            filterValue = { type: "number", number: { content: Number(targetLevel), isNotEmpty: true } };
            showMsg = `✅ 已聚焦: 第 ${targetLevel} 层级`;
        } else if (mode === "siblings") {
            const fatherKey = currentKeys.find((k: any) => k.name === "Father");
            if (!fatherKey) throw new Error("数据库中未找到 Father 字段，请先同步");
            filterColumn = fatherKey.id;

            // 兄弟：Father = 当前块的父项 ID
            const currentBlockRes = await client.sql({ stmt: `SELECT type, parent_id FROM blocks WHERE id = '${blockId}'` });
            const currentBlock = currentBlockRes.data?.[0];
            let parentItemId = "";
            if (currentBlock) {
                // currentBlock.parent_id 是 List ID，其父级可能是 ListItem 或 Doc/Notebook
                const listRes = await client.sql({ stmt: `SELECT parent_id FROM blocks WHERE id = '${currentBlock.parent_id}'` });
                const listParentId = listRes.data?.[0]?.parent_id;
                if (listParentId) {
                    const listParentRes = await client.sql({ stmt: `SELECT type FROM blocks WHERE id = '${listParentId}'` });
                    // 如果 List 的父级是 ListItem ('i')，说明有父项
                    if (listParentRes.data?.[0]?.type === "i") {
                        parentItemId = listParentId;
                    }
                }
            }
            filterValue = { type: "text", text: { content: parentItemId } };
            showMsg = `✅ 已聚焦: 兄弟项`;
        } else {
            // 后代：Path 包含当前块 ID 且带有分隔符
            const pathKey = currentKeys.find((k: any) => k.name === "Path");
            if (!pathKey) throw new Error("数据库中未找到 Path 字段，请重新同步以支持后代筛选");

            filterColumn = pathKey.id;
            // 使用 /ID/ 匹配，由于 Path 格式为 /ID1/ID2，/ID1/ 会匹配所有后代但排除自身（自身末尾无 /）
            filterValue = { type: "text", text: { content: `/${blockId}/` } };
            showMsg = `✅ 已聚焦: 所有后代项`;
        }

        // --- 3. 执行筛选 ---
        const doOperations = [{
            action: "setAttrViewFilters",
            avID: linkedAvId,
            blockID: viewID,
            data: [{
                column: filterColumn,
                operator: mode === "descendants" ? "Contains" : "=",
                value: filterValue
            }]
        }];

        if (protyle && protyle.getInstance) {
            protyle.getInstance().transaction(doOperations);
        } else {
            await post("/api/transactions", {
                app: "plugin-index",
                transactions: [{ doOperations }]
            });

            // 兜底渲染
            await post("/api/av/renderAttributeView", {
                id: linkedAvId,
                viewID: viewID,
                page: 1
            });
        }

        showMessage(showMsg);

    } catch (e: any) {
        console.error("[Data] Focus Error:", e);
        showMessage(`❌ 操作失败: ${e.message}`, 3000, "error");
    }
}

/**
 * 创建数据库逻辑
 */
export async function createDatabaseWithBlocks(sourceBlockIds: string[], protyle: any, silent: boolean = false) {
    if (!sourceBlockIds || sourceBlockIds.length === 0) return;

    const lastBlockId = sourceBlockIds[sourceBlockIds.length - 1];

    try {
        // --- 0. 预检查：智能检测绑定关系 ---
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
            if (settings.get("dbAddTemplateCols")) {
                titleImgKeyId = await ensureKey("title-img", "text", "iconImage");
                templateKeyId = await ensureKey("template", "text", "iconLayout");
            }

            await new Promise(resolve => setTimeout(resolve, 300));

            // Ensure Level, Father, Path are hidden
            if (viewID) {
                const hideOps: any[] = [];
                if (levelKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: levelKeyId, data: true });
                if (fatherKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: fatherKeyId, data: true });
                if (pathKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: pathKeyId, data: true });

                // Explicitly ensure icon is NOT hidden
                if (iconKeyId) hideOps.push({ action: "setAttrViewColHidden", avID: realAvID, blockID: viewID, id: iconKeyId, data: false });

                // NEW: Hide entry icons for the primary key (Show Entry Icons = off)
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
        allItems = []; // Clear

        const traverseWithContext = (element: Element, level: number, parentId: string | null, ancestorPath: string) => {
            for (let i = 0; i < element.children.length; i++) {
                const child = element.children[i];
                const type = child.getAttribute("data-type");

                if (type === "NodeListItem") {
                    const originalId = child.getAttribute("data-node-id");
                    let savedItemID = getBlockAttribute(child as HTMLElement, ATTR_ITEM_ID);

                    if (originalId) {
                        // @ts-ignore
                        const newItemID = window.Lute.NewNodeID();
                        const currentPath = ancestorPath ? `${ancestorPath}/${originalId}` : `/${originalId}`;
                        allItems.push({ originalId, newItemID, level, parentId, savedItemID, path: currentPath });
                        traverseWithContext(child, level, originalId, currentPath);
                    }
                } else if (type === "NodeList") {
                    traverseWithContext(child, level + 1, parentId, ancestorPath);
                } else {
                    traverseWithContext(child, level, parentId, ancestorPath);
                }
            }
        };

        for (const listId of sourceBlockIds) {
            const domRes = await client.getBlockDOM({ id: listId });
            if (domRes.data && domRes.data.dom) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = domRes.data.dom;
                if (tempDiv.firstElementChild) traverseWithContext(tempDiv.firstElementChild, 1, null, "");
            }
        }

        let itemIDMap: Record<string, string> = {};

        // Fix: If we are creating a NEW database (because the old one was dead or didn't exist),
        // we MUST ignore the savedItemID from the DOM because they belong to the old/dead AV.
        if (!existingAvID) {
            allItems.forEach(item => item.savedItemID = null);
        }

        if (existingAvID) {
            try {
                const renderRes = await post("/api/av/renderAttributeView", {
                    id: realAvID,
                    pageSize: 1000
                });
                const rows = renderRes.view ? renderRes.view.rows : renderRes.rows;
                if (rows) {
                    rows.forEach((row: any) => {
                        if (row.cells) {
                            const blockCell = row.cells.find((c: any) => c.valueType === "block");
                            if (blockCell && blockCell.value && blockCell.value.block && blockCell.value.block.id) {
                                itemIDMap[blockCell.value.block.id] = row.id;
                            }
                        }
                    });
                }
            } catch (e) { }
        }

        allItems.forEach(item => {
            if (item.savedItemID && !itemIDMap[item.originalId]) {
                itemIDMap[item.originalId] = item.savedItemID;
            }
        });

        const newSrcs: any[] = [];
        const updateValues: any[] = [];
        const itemIDToBlockID: Record<string, string> = {};

        for (const item of allItems) {
            let itemID = itemIDMap[item.originalId];
            if (!itemID) {
                itemID = item.newItemID;
                newSrcs.push({ itemID: itemID, id: item.originalId, isDetached: false });
            }
            itemIDToBlockID[item.originalId] = itemID;

            // COMMON: Always update hierarchy fields
            if (levelKeyId) {
                updateValues.push({
                    keyID: levelKeyId,
                    itemID: itemID,
                    value: { type: "number", number: { content: Number(item.level), isNotEmpty: true } }
                });
            }
            if (fatherKeyId) {
                updateValues.push({
                    keyID: fatherKeyId,
                    itemID: itemID,
                    value: { type: "text", text: { content: item.parentId || "" } }
                });
            }
            if (pathKeyId) {
                updateValues.push({
                    keyID: pathKeyId,
                    itemID: itemID,
                    value: { type: "text", text: { content: item.path || "" } }
                });
            }

            // ONLY FOR NEW DB: Initialize template/style columns to empty
            if (!existingAvID) {
                if (iconKeyId) updateValues.push({ keyID: iconKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
                if (titleImgKeyId) updateValues.push({ keyID: titleImgKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
                if (templateKeyId) updateValues.push({ keyID: templateKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
            }
        }

        if (newSrcs.length > 0) {
            await post("/api/av/addAttributeViewBlocks", { avID: realAvID, srcs: newSrcs });
        }

        if (updateValues.length > 0) {
            await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: realAvID, values: updateValues });
        }

        // --- 6. 保存映射关系 ---
        const savePromises = Object.entries(itemIDToBlockID).map(([blockId, itemId]) => {
            return client.setBlockAttrs({ id: blockId, attrs: { [ATTR_ITEM_ID]: itemId } });
        });
        await Promise.all(savePromises);

        // --- 7. 双向绑定 ---
        for (const listId of sourceBlockIds) {
            await client.setBlockAttrs({
                id: listId,
                attrs: {
                    [ATTR_LINKED_AV]: realAvID,
                    [ATTR_LINKED_AV_BLOCK]: blockID
                }
            });
        }

        if (!existingAvID) {
            await client.setBlockAttrs({ id: blockID, attrs: { [ATTR_LINKED_LIST]: sourceBlockIds.join(",") } });
        }

        await post("/api/av/renderAttributeView", { id: realAvID, viewID: viewID, page: 1, pageSize: 50 });
        if (!silent) showMessage(`✅ 数据库已同步: ${newSrcs.length} 新增, ${updateValues.length / 5} 更新`);

    } catch (e: any) {
        console.error("[Data] Create DB Error:", e);
        if (!silent) showMessage(`❌ 操作失败: ${e.message}`, 3000, "error");
    }
}