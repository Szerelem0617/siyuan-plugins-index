import { showMessage } from "siyuan";
import { post } from "../../../../shared/api-client/request";
import { formatDate } from "../../../../shared/utils";

/**
 * 批量更新当前视图中所有可见行的某一列值
 */
export async function batchUpdateCellValue(protyleInstance: any, avID: string, colID: string, newValue: string, colType: string, avBlockID: string) {
    try {
        showMessage("⏳ 正在批量执行...", 3000);
        
        // 1. 获取当前视图的所有可见行（作为目标）
        const sourceViewData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
        const visibleRows = sourceViewData.view?.rows || sourceViewData.rows || [];
        
        if (visibleRows.length === 0) {
            showMessage("当前视图没有可见行", 3000, "info");
            return;
        }

        const updateValues = visibleRows.map((row: any) => {
            const cellType = colType || "text";
            const updateData: any = { type: cellType };
            if (cellType === "mAsset") {
                updateData.mAsset = [{ content: newValue, name: newValue.split('/').pop() }];
            } else {
                updateData[cellType === "text" || cellType === "template" ? cellType : "text"] = { content: newValue };
            }
            return {
                keyID: colID,
                itemID: row.id, // row.id is the block ID
                value: updateData
            };
        });

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
        showMessage(`✅ 批量更新成功: ${updateValues.length} 个项`, 3000);
    } catch (e: any) {
        console.error("Batch Update Error", e);
        showMessage(`❌ 批量执行失败: ${e.message}`, 3000, "error");
    }
}
