import { client } from "../../../shared/api-client";
import { showMessage } from "siyuan";
import { ATTR_LINKED_AV } from "../../../shared/constants";
import { post } from "../../../shared/api-client/request";

/**
 * 聚焦数据库视图：根据当前块的层级自动筛选 Level
 */
export async function focusDatabaseView(blockId: string, protyle: any) {
    console.log(`[Data] Calculating level for block [${blockId}] via hierarchy`);
    
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
                linkedAvId = attrs[ATTR_LINKED_AV];
                break;
            }

            currentId = res.data[0].parent_id;
            if (!currentId) break;
            loopCount++;
        }

        if (!linkedAvId) {
            showMessage("❌ 未找到绑定的数据库（请确保该列表已创建数据库）", 3000, "info");
            return;
        }

        if (targetLevel === 0) targetLevel = 1; 

        // --- 2. 获取 View ID ---
        const initData = await post("/api/av/renderAttributeView", { id: linkedAvId });
        const viewID = initData.view ? initData.view.id : (initData.views && initData.views[0] ? initData.views[0].id : null);
        if (!viewID) throw new Error("无法获取 View ID");

        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: linkedAvId });
        const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
        const levelKey = currentKeys.find((k: any) => k.name === "Level");

        if (!levelKey) {
            throw new Error("数据库中未找到 Level 字段，请先同步");
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

        showMessage(`✅ 已聚焦: 显示第 ${targetLevel} 层级的所有项`);

    } catch (e: any) {
        console.error("[Data] Focus Error:", e);
        showMessage(`❌ 操作失败: ${e.message}`, 3000, "error");
    }
}
