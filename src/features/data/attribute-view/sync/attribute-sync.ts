import { post } from "../../../../shared/api-client/request";
import { formatDate } from "../../../../shared/utils";
import { showMessage } from "siyuan";
import { getColIDMap, cleanValue } from "../../../../shared/utils/av-utils";

/**
 * 属性同步：根据模式（同级、兄弟、后代、筛选）同步指定单元格的值
 */
export async function syncAttribute(avID: string, rowID: string, colID: string, mode: "level" | "siblings" | "descendants" | "filtered", avBlockID: string) {
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

        // 绑定 ID 获取逻辑
        const sourceBlockID = sourceRow.id;
        if (!sourceBlockID) throw new Error("无法获取源行 ID");

        // 3. 根据模式筛选目标 Block IDs
        let targetBlockIDs: string[] = [];

        if (mode === "level") {
            const levelKeyName = Object.keys(nameToID).find(k => k.toLowerCase() === "level");
            const levelKeyID = levelKeyName ? nameToID[levelKeyName] : undefined;
            const levelKV = keyValues.find((kv: any) => kv.key.id === levelKeyID);
            if (!levelKV) throw new Error("未找到 Level 字段");

            const getVal = (v: any) => {
                if (!v) return undefined;
                if (v.number !== undefined) return v.number.content;
                if (v.text !== undefined) return v.text.content;
                if (v.mSelect !== undefined && v.mSelect.length > 0) return v.mSelect[0].content;
                return v.content;
            };

            const targetLevel = getVal(levelKV.values.find((v: any) => v.blockID === sourceBlockID));
            if (targetLevel === undefined) throw new Error("无法获取当前行的 Level 值");

            targetBlockIDs = levelKV.values
                .filter((v: any) => getVal(v) == targetLevel && v.blockID !== sourceBlockID)
                .map((v: any) => v.blockID);
        } else if (mode === "siblings") {
            const findKey = (name: string) => {
                const kn = Object.keys(nameToID).find(k => k.toLowerCase() === name.toLowerCase());
                return kn ? nameToID[kn] : undefined;
            };
            const fatherKV = keyValues.find((kv: any) => kv.key.id === findKey("Father"));
            if (!fatherKV) throw new Error("未找到 Father 字段");

            const sourceBlockCell = sourceRow.cells.find((c: any) => c.valueType === "block");
            const cellBlockID = sourceBlockCell?.value?.block?.id;
            let effectiveSourceID = sourceBlockID;
            if (!fatherKV.values.some((v: any) => v.blockID === sourceBlockID) && cellBlockID) {
                effectiveSourceID = cellBlockID;
            }

            const sourceFatherVal = fatherKV.values.find((v: any) => v.blockID === effectiveSourceID);
            const targetFather = sourceFatherVal?.text?.content || "";
            targetBlockIDs = fatherKV.values
                .filter((v: any) => (v.text?.content || "") === targetFather && v.blockID !== effectiveSourceID)
                .map((v: any) => v.blockID);
        } else if (mode === "descendants") {
            const findKey = (name: string) => {
                const kn = Object.keys(nameToID).find(k => k.toLowerCase() === name.toLowerCase());
                return kn ? nameToID[kn] : undefined;
            };
            const pathKeyID = findKey("Path");
            if (!pathKeyID) throw new Error("未找到 Path 字段");

            const pathKV = keyValues.find((kv: any) => kv.key.id === pathKeyID);
            const blockPathMap = new Map<string, string>();
            if (pathKV && pathKV.values) {
                pathKV.values.forEach((v: any) => {
                    if (v.blockID && v.text?.content) blockPathMap.set(v.blockID, v.text.content);
                });
            }

            const sourceBlockCell = sourceRow.cells.find((c: any) => c.valueType === "block");
            const cellBlockID = sourceBlockCell?.value?.block?.id;
            let effectiveSourceID = sourceBlockID;
            if (!blockPathMap.has(effectiveSourceID) && cellBlockID) {
                effectiveSourceID = cellBlockID;
            }

            if (blockPathMap.has(effectiveSourceID)) {
                const sourcePath = blockPathMap.get(effectiveSourceID)!;
                
                // 从 sourcePath 推导后代的身份前缀
                // 例如：/ID1/002-ID2 -> 其后代必以 /ID1/ID2/ 开头
                const segments = sourcePath.split("/");
                const lastSegment = segments[segments.length - 1];
                // 稳妥剥离前缀序号 (001-ID -> ID)
                const currentIdInPath = lastSegment.replace(/^\d{3}-/, "");
                
                // 构造身份前缀
                const identityPrefix = segments.slice(0, -1).join("/") + "/" + currentIdInPath + "/";
                
                console.log(`[Sync-Debug] Descendants Mode:`, {
                    effectiveSourceID,
                    sourcePath,
                    identityPrefix
                });

                targetBlockIDs = pathKV.values
                    .filter((v: any) => {
                        const p = v.text?.content;
                        // 后代必定以当前项的“身份路径/”开头
                        return p && p.startsWith(identityPrefix) && v.blockID !== effectiveSourceID;
                    })
                    .map((v: any) => v.blockID);
                
                console.log(`[Sync-Debug] Target Block IDs found: ${targetBlockIDs.length}`);
            } else {
                console.warn(`[Sync-Debug] sourceID ${effectiveSourceID} not found in Path map.`);
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
