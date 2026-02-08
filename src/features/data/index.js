const siyuan = require("siyuan");
const { Plugin, showMessage } = siyuan;

class DatabaseTestPlugin extends Plugin {
    onload() {
        this.eventBus.on("click-blockicon", this.onBlockIconClick.bind(this));
        console.log("DatabaseTestPlugin 激活");
    }

    onunload() {
        console.log("DatabaseTestPlugin 卸载");
    }

        onBlockIconClick({ detail }) {

            const { menu, blockElements, protyle } = detail;

            if (!blockElements || blockElements.length === 0) return;

    

            const types = Array.from(blockElements).map(el => el.getAttribute("data-type"));

            const selectedIds = Array.from(blockElements).map(el => el.getAttribute("data-node-id"));

            

            // 1. 列表转数据库 (仅限全选列表)

            const isAllList = types.every(t => t === "NodeList");

            if (isAllList) {

                menu.addItem({

                    icon: "iconDatabase",

                    label: "📊 列表转数据库 (自动清理)",

                    click: () => this.createDatabaseWithBlocks(selectedIds, protyle)

                });

            }

    

            // 2. 聚焦层级 (支持列表或列表项)

            const hasListOrItem = types.some(t => t === "NodeList" || t === "NodeListItem");

            if (hasListOrItem) {

                menu.addItem({

                    icon: "iconFilter",

                    label: "🔍 聚焦此层级 (更新视图)",

                    click: () => this.focusDatabaseView(selectedIds[0], protyle)

                });

            }

        }

    

        async focusDatabaseView(blockId, protyle) {
            console.log(`DEBUG: Calculating level for block [${blockId}] via hierarchy`);
            
            try {
                let currentId = blockId;
                let linkedAvId = null;
                let targetLevel = 0;
                let loopCount = 0;
    
                // --- 1. 向上追溯计算层级并寻找绑定 AV ---
                while (currentId && loopCount < 40) {
                    // 获取当前块的类型和父级
                    const sql = `SELECT type, parent_id FROM blocks WHERE id = '${currentId}'`;
                    const res = await this.post("/api/query/sql", { stmt: sql });
                    if (!res || res.length === 0) break;

                    const blockType = res[0].type;
                    // 'l' 代表 NodeList
                    if (blockType === "l") {
                        targetLevel++;
                    }

                    // 检查是否到达了绑定了 AV 的根列表
                    const attrs = await this.post("/api/attr/getBlockAttrs", { id: currentId });
                    if (attrs && attrs["custom-index-linked-av"]) {
                        linkedAvId = attrs["custom-index-linked-av"];
                        break;
                    }
    
                    currentId = res[0].parent_id;
                    if (!currentId) break;
                    loopCount++;
                }
    
                if (!linkedAvId) {
                    showMessage("❌ 未找到绑定的数据库（请确保该列表已转为数据库）", -1, "warn");
                    return;
                }

                // 如果点击的是根列表本身，targetLevel 会是 1
                if (targetLevel === 0) targetLevel = 1; 
    
                console.log(`DEBUG: Calculated Level [${targetLevel}] for AV [${linkedAvId}]`);
    
                // --- 2. 获取 View ID ---
                const initData = await this.post("/api/av/renderAttributeView", { id: linkedAvId });
                const viewID = initData.view ? initData.view.id : (initData.views && initData.views[0] ? initData.views[0].id : null);
                if (!viewID) throw new Error("无法获取 View ID");

                const keysRes = await this.post("/api/av/getAttributeViewKeysByAvID", { avID: linkedAvId });
                const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
                const levelKey = currentKeys.find(k => k.name === "Level");

                if (!levelKey) {
                    throw new Error("数据库中未找到 Level 字段，请先点击同步");
                }
    
                // --- 3. 执行筛选 ---
                const doOperations = [{
                    action: "setAttrViewFilters",
                    avID: linkedAvId,
                    blockID: viewID,
                    data: [{
                        column: levelKey.id,
                        operator: "=",
                        value: { type: "number", number: { content: Number(targetLevel), isNotEmpty: true } }
                    }]
                }];

                if (protyle && protyle.getInstance) {
                    console.log("DEBUG: Using internal transaction via protyle.getInstance()");
                    protyle.getInstance().transaction(doOperations);
                } else {
                    console.log("DEBUG: Fallback to manual API transaction");
                    const payload = {
                        app: this.app.appId,
                        reqId: new Date().getTime(),
                        transactions: [{ doOperations }]
                    };
                    await this.post("/api/transactions", payload);
                    
                    // 手动触发渲染作为兜底
                    await this.post("/api/av/renderAttributeView", { 
                        id: linkedAvId, 
                        viewID: viewID,
                        page: 1
                    });
                }

                showMessage(`✅ 已聚焦: 显示第 ${targetLevel} 层级的所有项`);
    
            } catch (e) {
                console.error("Focus Error:", e);
                showMessage(`❌ 操作失败: ${e.message}`, -1, "error");
            }
        }

    async createDatabaseWithBlocks(sourceBlockIds, protyle) {
        if (!sourceBlockIds || sourceBlockIds.length === 0) return;

        const lastBlockId = sourceBlockIds[sourceBlockIds.length - 1];
        console.log("DEBUG: Starting createDatabaseWithBlocks", sourceBlockIds);

        try {
            // --- 0. 预检查：智能检测绑定关系 ---
            let existingAvID = null;
            for (const listId of sourceBlockIds) {
                const attrs = await this.post("/api/attr/getBlockAttrs", { id: listId });
                console.log(`DEBUG: Attrs for list [${listId}]:`, attrs);

                if (attrs && attrs["custom-index-linked-av"]) {
                    const linkedAvId = attrs["custom-index-linked-av"];
                    
                    try {
                        // 简化检测：只使用 Keys API
                        const keysRes = await this.post("/api/av/getAttributeViewKeysByAvID", { avID: linkedAvId });
                        if (keysRes) {
                            existingAvID = linkedAvId;
                            console.log(`DEBUG: Valid existing AV confirmed [${existingAvID}]`);
                            break;
                        }
                    } catch (e) {
                        console.warn(`DEBUG: AV Check failed for [${linkedAvId}]`, e);
                    }
                }
            }

            // --- 1. 递归解析列表项 (提取已保存的 itemID) ---
            let allItems = []; 
            const traverse = (element, level, parentId) => {
                for (const child of element.children) {
                    const type = child.getAttribute("data-type");
                    
                    if (type === "NodeListItem") {
                        const originalId = child.getAttribute("data-node-id");
                        // 尝试读取可能已存在的映射 ID
                        let savedItemID = child.getAttribute("custom-av-item-id") || child.getAttribute("data-custom-av-item-id");
                        
                        if (originalId) {
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
                const domRes = await this.post("/api/block/getBlockDOM", { id: listId });
                if (domRes && domRes.dom) {
                    const tempDiv = document.createElement("div");
                    tempDiv.innerHTML = domRes.dom;
                    if (tempDiv.firstElementChild) traverse(tempDiv.firstElementChild, 1, null);
                }
            }

            if (allItems.length === 0) {
                showMessage("未找到任何列表项", -1, "warn");
                return;
            }

            let realAvID = existingAvID;
            let blockID = existingAvID; 
            let viewID = null;

            if (!existingAvID) {
                // --- [NEW DB] ---
                const createRes = await this.post("/api/block/insertBlock", {
                    dataType: "markdown",
                    data: `<div data-type="NodeAttributeView" data-av-type="table"></div>`,
                    previousID: lastBlockId
                });

                if (!createRes || !createRes[0]) throw new Error("初始化数据库块失败");
                blockID = createRes[0].doOperations[0].id;
                const createdHTML = createRes[0].doOperations[0].data;
                realAvID = blockID; 
                const avIdMatch = createdHTML.match(/data-av-id="([^"]+)"/);
                if (avIdMatch && avIdMatch[1]) realAvID = avIdMatch[1];

                const initData = await this.post("/api/av/renderAttributeView", {
                    id: realAvID, 
                    page: 1, 
                    pageSize: 20
                });
                viewID = initData.views && initData.views[0] ? initData.views[0].id : null;
                if (!viewID) throw new Error("无法获取初始视图 ID");

                console.log("DEBUG: Cleaning up default columns...");
                let initialKeysRes = await this.post("/api/av/getAttributeViewKeysByAvID", { avID: realAvID });
                let currentKeys = Array.isArray(initialKeysRes) ? initialKeysRes : (initialKeysRes.keys || []);
                const defaultSelectKey = currentKeys.find(k => k.type === "select");
                if (defaultSelectKey) {
                    await this.post("/api/av/removeAttributeViewKey", {
                        avID: realAvID,
                        keyID: defaultSelectKey.id
                    });
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } else {
                showMessage(`正在更新现有数据库...`, -1, "info");
                const initData = await this.post("/api/av/renderAttributeView", { id: realAvID });
                viewID = initData.views && initData.views[0] ? initData.views[0].id : null;
            }

            // --- [COMMON] 4. 确保字段存在 (Level, Father, icon, title-img, template) ---
            let keysRes = await this.post("/api/av/getAttributeViewKeysByAvID", { avID: realAvID });
            let currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
            let lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";

            let levelKeyId = null;
            let fatherKeyId = null;
            let iconKeyId = null;
            let titleImgKeyId = null;
            let templateKeyId = null;

            const ensureKey = async (name, type, icon) => {
                let key = currentKeys.find(k => k.name === name);
                if (key) {
                    lastKeyID = key.id;
                    return key.id;
                } else {
                    const newID = window.Lute.NewNodeID();
                    await this.post("/api/av/addAttributeViewKey", {
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
                iconKeyId = await ensureKey("icon", "text", "iconEmoji");
                titleImgKeyId = await ensureKey("title-img", "text", "iconImage");
                templateKeyId = await ensureKey("template", "text", "iconLayout");

                await new Promise(resolve => setTimeout(resolve, 300));

                // --- [NEW DB ONLY] 4.5 设置默认筛选 (Level = 1) 与 数据库名称 与 隐藏列 ---
                if (!existingAvID && levelKeyId && viewID) {
                    console.log("DEBUG: Setting default filter, name, and hiding columns...");
                    
                    // 获取第一个元素的标题作为数据库名
                    let avName = "新数据库";
                    if (allItems.length > 0) {
                        try {
                            const firstItemDom = await this.post("/api/block/getBlockDOM", { id: allItems[0].originalId });
                            const tempSpan = document.createElement("span");
                            tempSpan.innerHTML = firstItemDom.dom;
                            avName = tempSpan.innerText.trim().substring(0, 30) || "新数据库";
                        } catch (e) {
                            console.warn("DEBUG: Failed to get name from first item", e);
                        }
                    }
                    console.log(`DEBUG: Setting AV name to: [${avName}]`);

                    // 1. Transaction: Set Filters & Name
                    const configPayload1 = {
                        app: (protyle && protyle.app && protyle.app.appId) || "plugin-app",
                        reqId: new Date().getTime(),
                        transactions: [{
                            doOperations: [
                                {
                                    action: "setAttrViewFilters",
                                    avID: realAvID,
                                    blockID: viewID,
                                    data: [{
                                        column: levelKeyId,
                                        operator: "=",
                                        value: {
                                            type: "number",
                                            number: { content: 1, isNotEmpty: true }
                                        }
                                    }]
                                },
                                {
                                    action: "setAttrViewName",
                                    avID: realAvID,
                                    data: avName
                                }
                            ]
                        }]
                    };
                    console.log("DEBUG: configPayload1 (Filters & Name):", JSON.stringify(configPayload1));
                    await this.post("/api/transactions", configPayload1);

                    // 2. Transaction: Hide Columns
                    const configPayload2 = {
                        app: (protyle && protyle.app && protyle.app.appId) || "plugin-app",
                        reqId: new Date().getTime() + 1,
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
                    };
                    console.log("DEBUG: configPayload2 (Hide Columns):", JSON.stringify(configPayload2));
                    const configRes2 = await this.post("/api/transactions", configPayload2);
                    console.log("DEBUG: configTransaction2 Response:", JSON.stringify(configRes2));
                }

            } catch (e) {
                console.error("DEBUG: Failed to ensure columns or set filter", e);
                throw new Error("创建/检查字段或筛选失败");
            }
            
            // --- 5. 插入与更新数据 (优化映射逻辑) ---
            
            let itemIDMap = {};
            
            // 策略 A: 优先尝试从 AV 渲染结果中获取现有的 blockID -> itemID 映射
            if (existingAvID) {
                try {
                    console.log("DEBUG: Fetching current AV rows for mapping...");
                    const renderRes = await this.post("/api/av/renderAttributeView", { 
                        id: realAvID, 
                        pageSize: 1000 
                    });
                    
                    // [FIX] 正确访问 rows (在 view 对象下)
                    const rows = renderRes.view ? renderRes.view.rows : renderRes.rows;

                    if (rows) {
                        rows.forEach(row => {
                            // 遍历 Cells 寻找 type 为 block 的列，从中获取原始 Block ID
                            if (row.cells) {
                                const blockCell = row.cells.find(c => c.valueType === "block");
                                if (blockCell && blockCell.value && blockCell.value.block && blockCell.value.block.id) {
                                    const originalBlockID = blockCell.value.block.id;
                                    itemIDMap[originalBlockID] = row.id;
                                }
                            }
                        });
                        console.log(`DEBUG: Mapped ${Object.keys(itemIDMap).length} items from current AV view (Strategy A)`);
                    }
                } catch (e) {
                    console.warn("DEBUG: Failed to fetch AV rows for mapping, falling back.", e);
                }
            }

            // 策略 B: 从 DOM 中提取的 savedItemID (作为补充)
            allItems.forEach(item => {
                if (item.savedItemID && !itemIDMap[item.originalId]) {
                    itemIDMap[item.originalId] = item.savedItemID;
                    console.log(`DEBUG: Found saved mapping in DOM for [${item.originalId}] -> [${item.savedItemID}] (Strategy B)`);
                }
            });

            const newSrcs = [];
            const updateValues = [];
            const itemIDToBlockID = {}; 

            console.log(`DEBUG: Resolved Key IDs - Level: [${levelKeyId}], Father: [${fatherKeyId}], icon: [${iconKeyId}], title-img: [${titleImgKeyId}], template: [${templateKeyId}]`);

            for (const item of allItems) {
                let itemID = itemIDMap[item.originalId];
                
                if (!itemID) {
                    itemID = item.newItemID;
                    newSrcs.push({
                        itemID: itemID,
                        id: item.originalId,
                        isDetached: false
                    });
                    console.log(`DEBUG: Item [${item.originalId}] will be ADDED as new row [${itemID}]`);
                }
                
                itemIDToBlockID[item.originalId] = itemID;

                // 准备更新 (确保所有字段始终包含在更新中)
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
                // 新增字段初始化
                if (iconKeyId) {
                    updateValues.push({ keyID: iconKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
                }
                if (titleImgKeyId) {
                    updateValues.push({ keyID: titleImgKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
                }
                if (templateKeyId) {
                    updateValues.push({ keyID: templateKeyId, itemID: itemID, value: { type: "text", text: { content: "" } } });
                }
            }

            // 执行插入
            if (newSrcs.length > 0) {
                console.log(`DEBUG: Inserting ${newSrcs.length} new rows`);
                await this.post("/api/av/addAttributeViewBlocks", {
                    avID: realAvID,
                    srcs: newSrcs
                });
            }

            // 执行批量更新
            if (updateValues.length > 0) {
                console.log(`DEBUG: Batch updating ${updateValues.length} attribute cells...`);
                await this.post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: realAvID,
                    values: updateValues
                });
            }

            // --- 6. [CRITICAL] 保存映射关系到 Block ---
            console.log("DEBUG: Persisting mappings to block attributes...");
            const savePromises = Object.entries(itemIDToBlockID).map(([blockId, itemId]) => {
                return this.post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: { "custom-av-item-id": itemId }
                });
            });
            await Promise.all(savePromises);

            // --- 7. 双向绑定 (Lists <-> AV) ---
            if (!existingAvID) {
                for (const listId of sourceBlockIds) {
                    await this.post("/api/attr/setBlockAttrs", {
                        id: listId,
                        attrs: { "custom-index-linked-av": realAvID }
                    });
                }
                const linkedListIds = sourceBlockIds.join(",");
                await this.post("/api/attr/setBlockAttrs", {
                    id: blockID,
                    attrs: { "custom-index-linked-list": linkedListIds }
                });
            }

            // --- 8. 刷新并打印最终结果 ---
            const finalRes = await this.post("/api/av/renderAttributeView", {
                id: realAvID,
                viewID: viewID,
                page: 1,
                pageSize: 50
            });
            console.log("DEBUG: FINAL AV CONTENT:", JSON.stringify(finalRes));

            showMessage(`✅ 数据库已同步: ${newSrcs.length} 新增, ${updateValues.length} 更新`);
        } catch (e) {
            console.error("Database Plugin Error:", e);
            showMessage(`❌ 操作失败: ${e.message}`, -1, "error");
        }
    }

    getFormattedDate() {
        const now = new Date();
        return now.getFullYear() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');
    }

    async post(url, data) {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        
        const responseText = await response.text();
        
        if (!response.ok) {
            throw new Error(`API Error [${response.status}]: ${responseText}`);
        }

        if (!responseText) {
            return null;
        }

        try {
            const res = JSON.parse(responseText);
            if (res.code !== 0) {
                throw new Error(`API 报错 [${res.code}]: ${res.msg}`);
            }
            return res.data;
        } catch (e) {
            console.error("Failed to parse JSON", responseText);
            throw new Error(`Invalid JSON response from ${url}: ${e.message}`);
        }
    }
}

module.exports = DatabaseTestPlugin;