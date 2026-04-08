import { post } from "../../../../shared/api-client/request";
import { formatDate } from "../../../../shared/utils";
import { showMessage } from "siyuan";
import { getColIDMap, cleanValue } from "../../../../shared/utils/av-utils";

/**
 * 属性同步：已优化为 O(Rows) 复杂度
 */
export async function syncAttribute(avID: string, rowID: string, colID: string, mode: "level" | "siblings" | "descendants" | "filtered", avBlockID: string) {
    try {
        console.log(`[Sync] Mode: ${mode}, Source RowID: ${rowID}, ColID: ${colID}`);
        showMessage("⏳ 正在同步...", 3000);

        // 1. 获取全量索引数据
        const index = await getColIDMap(avID);
        const { cellMap, nameToID } = index;

        // 2. 确定源行 Block ID
        const sourceViewData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
        const sourceRows = sourceViewData.view?.rows || sourceViewData.rows || [];
        const sourceRow = (rowID === "first") ? sourceRows[0] : sourceRows.find((r: any) => r.id === rowID);

        if (!sourceRow) throw new Error("Source row not found");
        const sourceBlockID = sourceRow.id;

        // 3. 获取同步值 (从 cellMap 获取最精准的源单元格)
        const rawValue = cellMap.get(sourceBlockID)?.get(colID);
        if (!rawValue) throw new Error("无法获取源单元格数据");
        const syncValue = cleanValue(rawValue);

        // 4. 根据模式筛选目标 Block IDs
        let targetBlockIDs: string[] = [];

        // 辅助工具：获取任意单元格内容
        const getValContent = (bid: string, cid?: string) => {
            if (!cid) return undefined;
            const v = cellMap.get(bid)?.get(cid);
            if (!v) return undefined;
            return v.number?.content ?? v.text?.content ?? v.mOption?.[0]?.content ?? v.content;
        };

        if (mode === "level") {
            const levelColID = nameToID["Level"] || nameToID["level"];
            if (!levelColID) throw new Error("未找到 Level 字段");

            const sourceLevel = getValContent(sourceBlockID, levelColID);
            if (sourceLevel === undefined) throw new Error("当前行 Level 为空");

            for (const [bid] of cellMap.entries()) {
                if (bid === sourceBlockID) continue;
                if (getValContent(bid, levelColID) == sourceLevel) {
                    targetBlockIDs.push(bid);
                }
            }
        } else if (mode === "siblings") {
            const fatherColID = nameToID["Father"] || nameToID["father"];
            if (!fatherColID) throw new Error("未找到 Father 字段");

            const sourceFather = getValContent(sourceBlockID, fatherColID) || "";
            for (const [bid] of cellMap.entries()) {
                if (bid === sourceBlockID) continue;
                if ((getValContent(bid, fatherColID) || "") === sourceFather) {
                    targetBlockIDs.push(bid);
                }
            }
        } else if (mode === "descendants") {
            const pathColID = nameToID["Path"] || nameToID["path"];
            if (!pathColID) throw new Error("未找到 Path 字段");

            const sourcePath = getValContent(sourceBlockID, pathColID);
            if (!sourcePath || typeof sourcePath !== 'string') throw new Error("当前行 Path 为空");

            const segments = sourcePath.split("/");
            const identityPrefix = segments.slice(0, -1).join("/") + "/" + segments[segments.length - 1].replace(/^\d{3}-/, "") + "/";

            for (const [bid] of cellMap.entries()) {
                const p = getValContent(bid, pathColID);
                if (bid !== sourceBlockID && typeof p === 'string' && p.startsWith(identityPrefix)) {
                    targetBlockIDs.push(bid);
                }
            }
        } else {
            // filtered: 当前渲染视图除自己外的所有行
            targetBlockIDs = sourceRows.filter((r: any) => r.id !== sourceBlockID).map((r: any) => r.id);
        }

        if (targetBlockIDs.length === 0) return showMessage("未找到符合条件的项", 3000, "info");

        // 5. 提交更新
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
