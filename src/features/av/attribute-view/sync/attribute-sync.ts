import { post } from "../../../../shared/api-client/request";
import { formatDate } from "../../../../shared/utils";
import { showMessage } from "siyuan";
import { getColIDMap, cleanValue } from "../../../../shared/utils/av-utils";

/**
 * 属性同步：根据模式（同级、兄弟、后代、筛选）同步指定单元格的值
 */
export async function syncAttribute(avID: string, rowID: string, colID: string, mode: "level" | "siblings" | "descendants" | "filtered", avBlockID: string) {
    try {
        console.log(`[Sync-V2] Starting sync. Mode: ${mode}, Source RowID: ${rowID}, ColID: ${colID}`);
        showMessage("⏳ 正在同步...", 3000);

        // 1. 获取全量基础数据以查找目标
        const colInfo = await getColIDMap(avID);
        const { nameToID, itemToBlock, blockToItem, colToCells } = colInfo;

        // 2. 确定源行数据（从当前视图获取，包含最新状态）
        const sourceViewData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
        const sourceRows = sourceViewData.view?.rows || sourceViewData.rows || [];
        const sourceRow = (rowID === "first") ? sourceRows[0] : sourceRows.find((r: any) => r.id === rowID);

        if (!sourceRow) throw new Error("Source row not found in current view");

        // 获取源列在 visible rows 里的索引
        const columns = sourceViewData.view?.columns || sourceViewData.columns || [];
        const colIndex = columns.findIndex((c: any) => c.id === colID);
        if (colIndex === -1) throw new Error("当前视图未显示该列，无法同步");

        const syncValue = cleanValue(sourceRow.cells[colIndex].value);
        console.log(`[Sync-V2] Source Value:`, JSON.stringify(syncValue));

        // 获取真实的 Siyuan Block ID 绑定
        const sourceRowID = sourceRow.id;
        const sourceBlockID = itemToBlock.get(sourceRowID);
        if (!sourceBlockID) throw new Error("无法获取源行对应的 Siyuan Block ID");

        // 3. 根据模式筛选目标 Item IDs (AV 内部行 ID)
        let targetItemIDs: string[] = [];

        if (mode === "level") {
            const levelKeyName = Object.keys(nameToID).find(k => k.toLowerCase() === "level");
            const levelKeyID = levelKeyName ? nameToID[levelKeyName] : undefined;
            if (!levelKeyID) throw new Error("未找到 Level 字段");

            const levelCellMap = colToCells[levelKeyID];
            if (!levelCellMap) throw new Error("Level 数据为空");

            const getVal = (v: any) => {
                if (!v) return undefined;
                if (v.number !== undefined) return v.number.content;
                if (v.text !== undefined) return v.text.content;
                if (v.mSelect !== undefined && v.mSelect.length > 0) return v.mSelect[0].content;
                return v.content;
            };

            const targetLevel = getVal(levelCellMap.get(sourceBlockID));
            if (targetLevel === undefined) throw new Error("无法获取当前行的 Level 值");

            targetItemIDs = Array.from(levelCellMap.entries())
                .filter(([bid, cell]) => getVal(cell) == targetLevel && bid !== sourceBlockID)
                .map(([bid]) => bid);
        } else if (mode === "siblings") {
            const fatherKeyName = Object.keys(nameToID).find(k => k.toLowerCase() === "father");
            const fatherKeyID = fatherKeyName ? nameToID[fatherKeyName] : undefined;
            if (!fatherKeyID) throw new Error("未找到 Father 字段");

            const fatherCellMap = colToCells[fatherKeyID];
            if (!fatherCellMap) throw new Error("Father 数据为空");

            const sourceFatherVal = fatherCellMap.get(sourceBlockID);
            const targetFather = sourceFatherVal?.text?.content || "";
            
            targetItemIDs = Array.from(fatherCellMap.entries())
                .filter(([bid, cell]) => (cell?.text?.content || "") === targetFather && bid !== sourceBlockID)
                .map(([bid]) => bid);
        } else if (mode === "descendants") {
            const pathKeyName = Object.keys(nameToID).find(k => k.toLowerCase() === "path");
            const pathKeyID = pathKeyName ? nameToID[pathKeyName] : undefined;
            if (!pathKeyID) throw new Error("未找到 Path 字段");

            const pathCellMap = colToCells[pathKeyID];
            if (!pathCellMap) throw new Error("Path 数据为空");

            const sourcePath = pathCellMap.get(sourceBlockID)?.text?.content;
            
            if (sourcePath) {
                const segments = sourcePath.split("/");
                const lastSegment = segments[segments.length - 1];
                const currentIdInPath = lastSegment.replace(/^\d{3}-/, "");
                const identityPrefix = segments.slice(0, -1).join("/") + "/" + currentIdInPath + "/";
                


                targetItemIDs = Array.from(pathCellMap.entries())
                    .filter(([bid, cell]) => {
                        const p = cell?.text?.content;
                        return p && p.startsWith(identityPrefix) && bid !== sourceBlockID;
                    })
                    .map(([bid]) => bid);
                

            } else {
                console.error(`[Sync-Debug] sourceID ${sourceBlockID} not found in Path map. Map size: ${pathCellMap.size}`);
                throw new Error("无法获取当前项的路径数据");
            }
        } else {
            // filtered: 同步到当前视图的所有其他行
            // 此处 sourceRows.id 就是我们需要的 AV Item ID
            targetItemIDs = sourceRows.filter((r: any) => r.id !== sourceRow.id).map((r: any) => r.id);
        }

        if (targetItemIDs.length === 0) return showMessage("未找到符合条件的项", 3000, "info");

        // 3.5 核心：确保获取最准确的 Item ID 映射 (从 Siyuan Block ID 映射到 AV Item ID)
        let finalItemIDs: string[] = targetItemIDs;
        
        if (mode !== "filtered") {
            try {

                const mappingRes = await post("/api/av/getAttributeViewItemIDsByBoundIDs", {
                    avID: avID,
                    blockIDs: targetItemIDs
                });
                if (mappingRes && typeof mappingRes === "object") {
                    finalItemIDs = Object.values(mappingRes).filter(id => id && typeof id === "string") as string[];
                    console.log(`[Sync-V2] Kernel mapping conversion successful: ${finalItemIDs.length} ItemIDs found.`);
                }
            } catch (e) {
                console.warn("[Sync-V2] Kernel mapping failed, falling back to local blockToItem", e);
                finalItemIDs = targetItemIDs.map(bid => blockToItem.get(bid)).filter(Boolean) as string[];
            }
        }

        if (finalItemIDs.length === 0) return showMessage("未能解析出目标的 AV 内部 ID", 3000, "error");

        // 4. 执行更新
        const updateValues = finalItemIDs.map(iid => ({
            keyID: colID,
            itemID: iid,
            value: syncValue
        }));



        // 分批执行更新 (每批 50 条) 以保证稳定性，参考 create-db.ts
        const chunkSize = 50;
        for (let i = 0; i < updateValues.length; i += chunkSize) {
            const chunk = updateValues.slice(i, i + chunkSize);
            const res = await post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID: avID,
                values: chunk
            });
            console.log(`[Sync-V2] Chunk ${i/chunkSize + 1} Result:`, res);
        }

        if (avBlockID) {
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: avBlockID, data: formatDate(new Date()) }] }]
            });
        }
        showMessage(`✅ 同步成功: 更新 ${targetItemIDs.length} 个项`, 3000);
    } catch (e: any) {
        console.error("Sync Error", e);
        showMessage(`❌ 同步失败: ${e.message}`, 3000, "error");
    }
}
