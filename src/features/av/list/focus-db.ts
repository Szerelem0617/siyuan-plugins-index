import { client } from "../../../shared/api-client";
import { showMessage } from "siyuan";
import { ATTR_LINKED_AV, ATTR_LINKED_AV_BLOCK } from "../../../shared/constants";
import { post } from "../../../shared/api-client/request";
import { getColIDMap } from "../../../shared/utils/av-utils";

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
            // 后代：获取当前项在数据库里的真实 Path
            const colInfo = await getColIDMap(linkedAvId);
            const pathKeyName = Object.keys(colInfo.nameToID).find(k => k.toLowerCase() === "path");
            if (!pathKeyName) throw new Error("数据库中未找到 Path 字段，请重新同步以支持后代筛选");

            filterColumn = colInfo.nameToID[pathKeyName];
            
            const pathCellMap = colInfo.colToCells[filterColumn];
            const currentPath = pathCellMap?.get(blockId)?.text?.content;

            if (!currentPath) {
                console.error(`[Focus-Debug] Failed to fetch path. BlockID: ${blockId}, CellMap Size: ${pathCellMap?.size || 0}`);
                throw new Error("无法获取当前项的路径，请先执行数据库同步");
            }

            // 从路径推导后代判定前缀
            const segments = currentPath.split("/");
            const lastSeg = segments[segments.length - 1];
            const identityId = lastSeg.replace(/^\d{3}-/, "");
            const identityPrefix = segments.slice(0, -1).join("/") + "/" + identityId + "/";

            filterValue = { type: "text", text: { content: identityPrefix } };
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
