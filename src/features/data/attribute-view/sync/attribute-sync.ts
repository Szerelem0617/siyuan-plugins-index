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

        // Use sourceRow.id directly. 
        // Note: extracting from cells (valueType === "block") might yield a child block ID 
        // which mismatches the AV KeyValues blockID.
        const sourceBlockID = sourceRow.id;
        if (!sourceBlockID) throw new Error("无法获取源行 ID");

        // 3. 根据模式筛选目标 Block IDs
        let targetBlockIDs: string[] = [];

        if (mode === "level") {
            // 查找 Level 字段 (不区分大小写)
            const levelKeyName = Object.keys(nameToID).find(k => k.toLowerCase() === "level");
            const levelKeyID = levelKeyName ? nameToID[levelKeyName] : undefined;
            const levelKV = keyValues.find((kv: any) => kv.key.id === levelKeyID);

            if (!levelKV) {
                console.error("[Sync] Available keys:", Object.keys(nameToID));
                throw new Error("未找到 Level 字段 (请检查列名是否为 Level)");
            }

            const sourceLevelVal = levelKV.values.find((v: any) => v.blockID === sourceBlockID);

            // 兼容多种类型的 Level 值 (Number, Text, Select)
            const getVal = (v: any) => {
                if (!v) return undefined;
                // 注意：SiYuan 返回的结构中，content 可能是 number 或 string
                if (v.number !== undefined) return v.number.content;
                if (v.text !== undefined) return v.text.content;
                if (v.mSelect !== undefined && v.mSelect.length > 0) return v.mSelect[0].content;

                // 尝试直接读取 content (如果是 text 类型但结构不同)
                if (v.content !== undefined) return v.content;

                return undefined;
            };

            const targetLevel = getVal(sourceLevelVal);
            console.log(`[Sync-Level] ID: ${sourceBlockID}, Level: ${targetLevel}`);

            if (targetLevel === undefined) {
                console.warn("[Sync-Warning] Target level is undefined. Cannot sync to peers.");
                showMessage("无法获取当前行的 Level 值", 3000, "info");
                return;
            }

            targetBlockIDs = levelKV.values
                .filter((v: any) => {
                    const val = getVal(v);
                    // 使用 loose equality 以匹配 string "1" 和 number 1
                    return val == targetLevel && v.blockID !== sourceBlockID;
                })
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
