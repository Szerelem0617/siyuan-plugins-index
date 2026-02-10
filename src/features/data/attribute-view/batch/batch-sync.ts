import { post } from "../../../../shared/api-client/request";
import { formatDate } from "../../../../shared/utils";
import { showMessage } from "siyuan";
import { getColIDMap, cleanValue } from "../../../../shared/utils/av-utils";

/**
 * 批量同步到后代：
 * 对当前视图中每一行，将其指定列的值同步到其在整个数据库中的所有后代。
 */
export async function batchSyncToDescendants(avID: string, colID: string, avBlockID: string) {
    try {
        console.log(`[Batch Sync] Starting optimized sync for AV [${avID}], Col [${colID}]`);
        showMessage("⏳ 正在批量同步到后代...", 3000);

        // 1. 获取当前视图的所有可见行 (Source)
        const sourceViewData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
        const sourceRows = sourceViewData.view?.rows || sourceViewData.rows || [];

        if (sourceRows.length === 0) {
            console.warn("[Batch Sync] No source rows found in current view.");
            return;
        }

        // 2. 获取数据库全量原始数据
        const { nameToID, keyValues } = await getColIDMap(avID);

        const pathKeyID = nameToID["Path"];
        const fatherKeyID = nameToID["Father"];
        const pathKV = keyValues.find((kv: any) => kv.key.id === pathKeyID);
        const fatherKV = keyValues.find((kv: any) => kv.key.id === fatherKeyID);

        // 3. 准备辅助数据结构
        const blockPathMap = new Map<string, string>();
        if (pathKV && pathKV.values) {
            pathKV.values.forEach((v: any) => {
                if (v.blockID && v.text?.content) blockPathMap.set(v.blockID, v.text.content);
            });
        }

        const childrenMap = new Map<string, string[]>();
        if (fatherKV && fatherKV.values) {
            fatherKV.values.forEach((v: any) => {
                const pid = v.text?.content || "";
                if (v.blockID && pid) {
                    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
                    childrenMap.get(pid).push(v.blockID);
                }
            });
        }

        // 4. 计算更新
        const sourceView = sourceViewData.view || sourceViewData;
        const columns = sourceView.columns || [];
        const sourceColIndex = columns.findIndex((c: any) => c.id === colID);
        if (sourceColIndex === -1) throw new Error("当前视图未显示该列，无法同步");

        const updateOps: any[] = [];

        for (const row of sourceRows) {
            // Use row.id directly as it matches the AV keyValues blockID
            const sourceBlockID = row.id;
            if (!sourceBlockID) continue;

            const cellValue = row.cells[sourceColIndex]?.value;
            if (!cellValue) continue;

            const syncValue = cleanValue(cellValue);
            let targetBlockIDs: string[] = [];

            if (pathKV && blockPathMap.size > 0) {
                const pattern = `/${sourceBlockID}/`;
                for (const [bid, path] of blockPathMap.entries()) {
                    if (path.includes(pattern)) {
                        targetBlockIDs.push(bid);
                    }
                }
            } else if (fatherKV) {
                const findRec = (pId: string) => {
                    const res: string[] = [];
                    const children = childrenMap.get(pId) || [];
                    children.forEach(cid => {
                        res.push(cid, ...findRec(cid));
                    });
                    return res;
                };
                targetBlockIDs = findRec(sourceBlockID);
            }

            targetBlockIDs.forEach(tid => {
                updateOps.push({
                    keyID: colID,
                    itemID: tid,
                    value: syncValue
                });
            });
        }

        if (updateOps.length === 0) {
            console.log("[Batch Sync] No target descendants found to update.");
            return;
        }

        // 5. 执行全量更新
        await post("/api/av/batchSetAttributeViewBlockAttrs", {
            avID: avID,
            values: updateOps
        });

        if (avBlockID) {
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{
                    doOperations: [{ action: "doUpdateUpdated", id: avBlockID, data: formatDate(new Date()) }]
                }]
            });
        }

        showMessage(`✅ 批量同步成功: 更新 ${updateOps.length} 个单元格`, 3000);

    } catch (e: any) {
        console.error("[Batch Sync Error]", e);
        showMessage(`❌ 批量同步失败: ${e.message}`, 3000, "error");
    }
}
