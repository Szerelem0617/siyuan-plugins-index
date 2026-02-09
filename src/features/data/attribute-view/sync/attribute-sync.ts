import { post } from "../../../../shared/api-client/request";
import { formatDate } from "../../../../shared/utils";
import { showMessage } from "siyuan";
import { getColIDMap, cleanValue } from "../../../../shared/utils/av-utils";

/**
 * 属性同步：根据模式（同级、兄弟、后代、筛选）同步指定单元格的值
 */
export async function syncAttribute(avID: string, rowID: string, colID: string, mode: "level" | "siblings" | "descendants" | "filtered", avBlockID: string, protyleInstance: any) {
    try {
        console.log(`[Sync] Mode: ${mode}, Source RowID: ${rowID}, ColID: ${colID}`);
        showMessage("⏳ 正在同步...", 3000);
        
        // 1. 获取全量数据以查找目标和列映射
        const { nameToID, keyValues } = await getColIDMap(avID);
        
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
        const sourceBlockCell = sourceRow.cells.find((c: any) => c.valueType === "block");
        const sourceBlockID = sourceBlockCell?.value?.block?.id;
        if (!sourceBlockID) throw new Error("无法获取源行对应的块 ID");

        // 3. 根据模式筛选目标 Block IDs
        let targetBlockIDs: string[] = [];
        
        if (mode === "level") {
            const levelKV = keyValues.find((kv: any) => kv.key.id === nameToID["Level"]);
            if (!levelKV) throw new Error("未找到 Level 字段");
            const sourceLevelVal = levelKV.values.find((v: any) => v.blockID === sourceBlockID);
            const targetLevel = sourceLevelVal?.number?.content;
            targetBlockIDs = levelKV.values
                .filter((v: any) => v.number?.content == targetLevel && v.blockID !== sourceBlockID)
                .map((v: any) => v.blockID);
        } else if (mode === "siblings") {
            const fatherKV = keyValues.find((kv: any) => kv.key.id === nameToID["Father"]);
            if (!fatherKV) throw new Error("未找到 Father 字段");
            const sourceFatherVal = fatherKV.values.find((v: any) => v.blockID === sourceBlockID);
            const targetFather = sourceFatherVal?.text?.content || "";
            targetBlockIDs = fatherKV.values
                .filter((v: any) => (v.text?.content || "") === targetFather && v.blockID !== sourceBlockID)
                .map((v: any) => v.blockID);
        } else if (mode === "descendants") { 
            const pathKV = keyValues.find((kv: any) => kv.key.id === nameToID["Path"]);
            if (pathKV) {
                targetBlockIDs = pathKV.values
                    .filter((v: any) => v.text?.content?.includes(`/${sourceBlockID}/`) && v.blockID !== sourceBlockID)
                    .map((v: any) => v.blockID);
            } else {
                // Fallback to Father recursion
                const fatherKV = keyValues.find((kv: any) => kv.key.id === nameToID["Father"]);
                if (fatherKV) {
                    const parentMap = new Map<string, string>();
                    fatherKV.values.forEach((v: any) => parentMap.set(v.blockID, v.text?.content || ""));
                    const findRec = (pId: string) => {
                        const res: string[] = [];
                        for (const [cid, pid] of parentMap.entries()) {
                            if (pid === pId) {
                                res.push(cid, ...findRec(cid));
                            }
                        }
                        return res;
                    };
                    targetBlockIDs = findRec(sourceBlockID);
                }
            }
        } else {
            // filtered: 同步到当前视图的所有其他行
            targetBlockIDs = sourceRows.filter((r: any) => r.id !== sourceRow.id).map((r: any) => r.id);
        }

        if (targetBlockIDs.length === 0) return showMessage("未找到符合条件的项", 3000, "info");
        
        // 4. 执行更新
        const updateValues = targetBlockIDs.map(bid => ({
            keyID: colID,
            itemID: bid,
            value: syncValue
        }));

        await post("/api/av/batchSetAttributeViewBlockAttrs", { 
            avID: avID, 
            values: updateValues 
        });

        if (avBlockID) {
            await post("/api/transactions", { 
                app: "plugin-index", 
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: avBlockID, data: formatDate(new Date()) }] }] 
            });
        }
        showMessage(`✅ 同步成功: 更新 ${targetBlockIDs.length} 个项`, 3000);
    } catch (e: any) { 
        console.error("Sync Error", e);
        showMessage(`❌ 同步失败: ${e.message}`, 3000, "error"); 
    }
}
