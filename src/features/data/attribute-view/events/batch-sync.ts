import { post } from "../../../../shared/api-client/request";
import { formatDate, i18n } from "../../../../shared/utils";
import { showMessage } from "siyuan";

/**
 * 批量同步到后代：
 * 对当前视图中每一行，将其指定列的值同步到其在整个数据库中的所有后代。
 */
export async function batchSyncToDescendants(avID: string, colID: string, avBlockID: string) {
    try {
        console.log(`[Batch Sync] Starting sync for AV [${avID}], Col [${colID}]`);
        showMessage("⏳ 正在批量同步到后代...", 3000);
        
        // 1. 获取当前视图的所有可见行 (Source)
        const sourceViewData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
        const sourceRows = sourceViewData.view?.rows || sourceViewData.rows || [];
        console.log(`[Batch Sync] sourceRows count: ${sourceRows.length}`);

        if (sourceRows.length === 0) {
            console.warn("[Batch Sync] No source rows found in current view.");
            return;
        }

        // 2. 获取数据库全量原始数据
        const avRawData = await post("/api/av/getAttributeView", { id: avID });
        // 兼容性提取：getAttributeView 返回结构通常是 { av: { keyValues: [...] } }
        const avData = avRawData.av || avRawData;
        const keyValues = avData.keyValues || [];
        console.log(`[Batch Sync] Fetched raw data, columns found:`, keyValues.map((kv: any) => kv.key.name));

        // 3. 构建列映射
        const nameToID: Record<string, string> = {};
        keyValues.forEach((kv: any) => nameToID[kv.key.name] = kv.key.id);
        
        const pathKeyID = nameToID["Path"];
        const fatherKeyID = nameToID["Father"];
        const pathKV = keyValues.find((kv: any) => kv.key.id === pathKeyID);
        const fatherKV = keyValues.find((kv: any) => kv.key.id === fatherKeyID);

        // 4. 准备辅助数据结构
        const blockPathMap = new Map<string, string>();
        if (pathKV && pathKV.values) {
            pathKV.values.forEach((v: any) => {
                if (v.blockID && v.text?.content) blockPathMap.set(v.blockID, v.text.content);
            });
            console.log(`[Batch Sync] Built Path map with ${blockPathMap.size} entries.`);
            // 打印前几个 Path 样例
            const samples = Array.from(blockPathMap.entries()).slice(0, 3);
            samples.forEach(([bid, p]) => console.log(`   Sample Path: [${bid}] -> ${p}`));
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
            console.log(`[Batch Sync] Built Father map with ${childrenMap.size} parent entries.`);
        }

        // 5. 计算更新
        const sourceView = sourceViewData.view || sourceViewData;
        const columns = sourceView.columns || [];
        const sourceColIndex = columns.findIndex((c: any) => c.id === colID);
        if (sourceColIndex === -1) {
            console.error(`[Batch Sync] ColID [${colID}] not found in view columns:`, columns.map(c => c.id));
            throw new Error("当前视图未显示该列，无法同步");
        }

        const updateOps: any[] = [];
        const cleanValue = (val: any) => {
            if (!val) return null;
            const res: any = { type: val.type };
            ["text", "number", "mSelect", "mAsset", "block", "url", "phone", "email", "template", "checkbox", "relation", "rollup", "date"].forEach(f => {
                if (val[f] !== undefined) res[f] = JSON.parse(JSON.stringify(val[f]));
            });
            return res;
        };

                for (const row of sourceRows) {
                    // 重要：sourceBlockID 必须是文档中的块 ID，而不是数据库项 ID (row.id)
                    const blockCell = row.cells.find((c: any) => c.valueType === "block");
                    const sourceBlockID = blockCell?.value?.block?.id;
                    
                    if (!sourceBlockID) {
                        console.warn(`[Batch Sync] Could not find linked block ID for row ${row.id}`);
                        continue;
                    }
        
                    const cellValue = row.cells[sourceColIndex]?.value;
                    if (!cellValue) continue;
                    
                    const syncValue = cleanValue(cellValue);
                    let targetBlockIDs: string[] = [];
        
                    if (pathKV && blockPathMap.size > 0) {
                        // 方案 A: 使用 Path 字段
                        // 匹配模式：包含 /sourceBlockID/
                        const pattern = `/${sourceBlockID}/`;
                        for (const [bid, path] of blockPathMap.entries()) {
                            // bid 是数据库项 ID (Item ID)
                            if (path.includes(pattern)) {
                                targetBlockIDs.push(bid);
                            }
                        }
                    } else if (fatherKV) {
                        // 方案 B: 递归 Father (使用 sourceBlockID 作为父 ID 进行匹配)
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
                        console.log(`[Batch Sync] Source Block [${sourceBlockID}] -> Found ${targetBlockIDs.length} targets.`);
                    }
        
                    targetBlockIDs.forEach(tid => {
                        updateOps.push({
                            keyID: colID,
                            itemID: tid,
                            value: syncValue
                        });
                    });
                }
        console.log(`[Batch Sync] Total update values generated: ${updateOps.length}`);

        if (updateOps.length === 0) {
            console.log("[Batch Sync] Done. No target descendants found to update.");
            return;
        }

        // 6. 执行全量更新
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
