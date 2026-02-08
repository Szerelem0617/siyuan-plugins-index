import { client } from "../../../shared/api-client";
import { showMessage } from "siyuan";
import { ATTR_LINKED_AV, ATTR_LINKED_LIST, ATTR_ITEM_ID } from "../../../shared/constants";
import { settings } from "../../../core/settings";
import { post } from "../../../shared/api-client/request";

/**
 * 创建数据库逻辑
 */
export async function createDatabaseWithBlocks(sourceBlockIds: string[], protyle: any) {
    if (!sourceBlockIds || sourceBlockIds.length === 0) return;

    const lastBlockId = sourceBlockIds[sourceBlockIds.length - 1];
    
    try {
        // --- 0. 预检查：智能检测绑定关系 ---
        let existingAvID = null;
        for (const listId of sourceBlockIds) {
            const attrsRes = await client.getBlockAttrs({ id: listId });
            const attrs = attrsRes.data || {};

            if (attrs[ATTR_LINKED_AV]) {
                const linkedAvId = attrs[ATTR_LINKED_AV];
                try {
                    const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: linkedAvId });
                    if (keysRes) {
                        existingAvID = linkedAvId;
                        break;
                    }
                } catch (e) {
                    console.warn(`[Data] AV Check failed for [${linkedAvId}]`, e);
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
                    let savedItemID = child.getAttribute(ATTR_ITEM_ID) || child.getAttribute(`data-${ATTR_ITEM_ID}`);
                    
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
            showMessage("未找到任何列表项", 3000, "info");
            return;
        }

        let realAvID = existingAvID;
        let blockID = existingAvID; 
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
            showMessage(`正在更新现有数据库...`, 3000, "info");
            const initData = await post("/api/av/renderAttributeView", { id: realAvID });
            viewID = initData.views && initData.views[0] ? initData.views[0].id : null;
        }

        // --- [COMMON] 4. 确保字段存在 ---
        let keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: realAvID });
        let currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
        let lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";

        let levelKeyId = null;
        let fatherKeyId = null;
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
            
            // Optional template columns
            if (settings.get("dbAddTemplateCols")) {
                iconKeyId = await ensureKey("icon", "text", "iconEmoji");
                titleImgKeyId = await ensureKey("title-img", "text", "iconImage");
                templateKeyId = await ensureKey("template", "text", "iconLayout");
            }

            await new Promise(resolve => setTimeout(resolve, 300));

            // Ensure Level and Father are hidden (for both new and existing DBs)
            if (levelKeyId && fatherKeyId && viewID) {
                 await post("/api/transactions", {
                    app: "plugin-index",
                    reqId: Date.now(),
                    transactions: [{
                        doOperations: [
                            {
                                action: "setAttrViewColHidden",
                                avID: realAvID,
                                blockID: viewID,
                                id: levelKeyId,
                                data: true
                            },
                            {
                                action: "setAttrViewColHidden",
                                avID: realAvID,
                                blockID: viewID,
                                id: fatherKeyId,
                                data: true
                            }
                        ]
                    }]
                });
            }

            if (!existingAvID && levelKeyId && viewID) {
                let avName = "新数据库";
                if (allItems.length > 0) {
                    try {
                        const firstItemDom = await client.getBlockDOM({ id: allItems[0].originalId });
                        const tempSpan = document.createElement("span");
                        tempSpan.innerHTML = firstItemDom.data.dom;
                        avName = tempSpan.innerText.trim().substring(0, 30) || "新数据库";
                    } catch (e) {}
                }

                const ops: any[] = [
                    {
                        action: "setAttrViewName",
                        avID: realAvID,
                        data: avName
                    }
                ];

                // Focus Level Configuration
                const focusLevel = settings.get("dbFocusLevel");
                if (focusLevel > 0) {
                    ops.push({
                        action: "setAttrViewFilters",
                        avID: realAvID,
                        blockID: viewID,
                        data: [{
                            column: levelKeyId,
                            operator: "=",
                            value: {
                                type: "number",
                                number: { content: Number(focusLevel), isNotEmpty: true } // Ensure proper number casting
                            }
                        }]
                    });
                }

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
        let itemIDMap: Record<string, string> = {};
        
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
            } catch (e) {}
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
            if (iconKeyId) updateValues.push({ keyID: iconKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
            if (titleImgKeyId) updateValues.push({ keyID: titleImgKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
            if (templateKeyId) updateValues.push({ keyID: templateKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
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
        if (!existingAvID) {
            for (const listId of sourceBlockIds) {
                await client.setBlockAttrs({ id: listId, attrs: { [ATTR_LINKED_AV]: realAvID } });
            }
            await client.setBlockAttrs({ id: blockID, attrs: { [ATTR_LINKED_LIST]: sourceBlockIds.join(",") } });
        }

        await post("/api/av/renderAttributeView", { id: realAvID, viewID: viewID, page: 1, pageSize: 50 });
        showMessage(`✅ 数据库已同步: ${newSrcs.length} 新增, ${updateValues.length / 5} 更新`);

    } catch (e: any) {
        console.error("[Data] Create DB Error:", e);
        showMessage(`❌ 操作失败: ${e.message}`, 3000, "error");
    }
}
