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

        // 3. 准备辅助数据结构 (使用全量 keyValues)
        // 查找列 ID (不区分大小写)
        const findKey = (name: string) => {
            const kn = Object.keys(nameToID).find(k => k.toLowerCase() === name.toLowerCase());
            return kn ? nameToID[kn] : undefined;
        };

        const pathKeyID = findKey("Path");
        const fatherKeyID = findKey("Father");
        const pathKV = keyValues.find((kv: any) => kv.key.id === pathKeyID);
        const fatherKV = keyValues.find((kv: any) => kv.key.id === fatherKeyID);

        console.log(`[Batch Sync] Path Key: ${pathKeyID}, Father Key: ${fatherKeyID}`);

        const blockPathMap = new Map<string, string>();
        if (pathKV && pathKV.values) {
            pathKV.values.forEach((v: any) => {
                if (v.blockID && v.text?.content) blockPathMap.set(v.blockID, v.text.content);
            });
        }

        const childrenMap = new Map<string, string[]>();
        if (fatherKV && fatherKV.values) {
            fatherKV.values.forEach((v: any) => {
                // Father column usually contains the block ID of the parent
                // But sometimes it might be text? Standard AV 'Father' is usually text link or Relation?
                // Let's assume it holds the ID or we map it.
                // Actually, standard system 'Father' column usually holds the parent's Block ID in text or link.
                // Let's check the content.
                const pid = v.text?.content || v.relation?.blockIDs?.[0] || "";
                if (v.blockID && pid) {
                    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
                    childrenMap.get(pid)!.push(v.blockID);
                }
            });
        }

        console.log(`[Batch Sync] Maps Built. PathMap Size: ${blockPathMap.size}, ChildrenMap Size: ${childrenMap.size}`);

        // 4. 计算更新
        const sourceView = sourceViewData.view || sourceViewData;
        const columns = sourceView.columns || [];
        const sourceColIndex = columns.findIndex((c: any) => c.id === colID);
        if (sourceColIndex === -1) throw new Error("当前视图未显示该列，无法同步");

        const updateOps: any[] = [];

        for (const row of sourceRows) {
            // 尝试获取正确的 Source Block ID
            // 1. 优先尝试 row.id (AV 的主键)
            // 2. 备选尝试 Cell 中的 Block ID (可见的块)
            const rowID = row.id;
            const blockCell = row.cells.find((c: any) => c.valueType === "block");
            const cellBlockID = blockCell?.value?.block?.id;

            let sourceBlockID = rowID;
            let usingStrategy = "RowID";

            // 验证哪个 ID 在我们的 Map 中存在，优先使用能找到后代的 ID
            const rowIDCanFindDescendants = (pathKeyID && blockPathMap.has(rowID)) || (fatherKeyID && childrenMap.has(rowID));
            const cellBlockIDCanFindDescendants = (pathKeyID && cellBlockID && blockPathMap.has(cellBlockID)) || (fatherKeyID && cellBlockID && childrenMap.has(cellBlockID));

            if (!rowIDCanFindDescendants && cellBlockIDCanFindDescendants) {
                sourceBlockID = cellBlockID!;
                usingStrategy = "CellBlockID";
            } else if (!rowIDCanFindDescendants && !cellBlockIDCanFindDescendants) {
                // Neither ID can be used to find descendants, skip this row
                console.warn(`[Batch Sync-Row] Skipping row ${row.id}: Neither RowID nor CellBlockID found in Path/Father maps.`);
                continue;
            }

            console.log(`[Batch Sync-Row] RowID: ${row.id}, CellID: ${cellBlockID}, Using: ${sourceBlockID} (${usingStrategy})`);

            const cellValue = row.cells[sourceColIndex]?.value;
            if (!cellValue) continue;

            const syncValue = cleanValue(cellValue);
            let targetBlockIDs: string[] = [];

            if (pathKV && blockPathMap.has(sourceBlockID)) {
                // 使用 Path 匹配后代
                const sourcePath = blockPathMap.get(sourceBlockID)!;
                // Descendant path must start with sourcePath + "/" and not be the source block itself
                const descendantPathPrefix = `${sourcePath}/`;

                for (const [bid, path] of blockPathMap.entries()) {
                    if (bid !== sourceBlockID && path.startsWith(descendantPathPrefix)) {
                        targetBlockIDs.push(bid);
                    }
                }
            } else if (fatherKV && childrenMap.has(sourceBlockID)) {
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

            if (targetBlockIDs.length > 0) {
                console.log(`[Batch Sync-Row] Found ${targetBlockIDs.length} descendants for ${sourceBlockID}`);
                targetBlockIDs.forEach(tid => {
                    updateOps.push({
                        keyID: colID,
                        itemID: tid,
                        value: syncValue
                    });
                });
            } else {
                console.log(`[Batch Sync-Row] No descendants found for ${sourceBlockID} using ${usingStrategy}.`);
            }
        }

        if (updateOps.length === 0) {
            console.log("[Batch Sync] No target descendants found to update.");
            showMessage("未找到任何后代需要更新 (请检查 Path/Father 列是否正确)", 3000, "info");
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
