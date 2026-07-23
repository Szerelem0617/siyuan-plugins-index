/**
 * supertag-persister.ts
 *
 * 将命令执行后产出的变量 (例如 createdblock = "20260721...")
 * 自动写入 Layer 4 对应 Supertag 的数据库中。
 * 如果对应列 (Column) 不存在，自动建列落盘；若未实例化，自动写回块的 custom-* 属性中。
 */

import { post } from "../../../../shared/api-client/request";
import { getGlobalTypeConfigs } from "../../../av/av-setting/db-config";
import { getColIDMap } from "../../../../shared/utils/av-utils";
import { sleep } from "../../../../shared/utils";

export async function persistOutputVariablesToLayer4(
    blockId: string,
    tag: string,
    outputVars: Record<string, any>
): Promise<void> {
    const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
    if (!blockId || !cleanTag || !outputVars || Object.keys(outputVars).length === 0) return;

    try {
        // 1. 查找此 supertag 对应的 Layer 4 AV 数据库
        const configs = await getGlobalTypeConfigs();
        const tagMatch = configs.find(c => c.typeName.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase() === cleanTag.toLowerCase());
        
        // 仅收集在 _outputMapping 中被用户显式命名/映射的出参变量！
        const mappingAliases = (outputVars._outputMapping || {}) as Record<string, string>;
        const targetOutputEntries: [string, string][] = [];

        for (const [outKey, alias] of Object.entries(mappingAliases)) {
            if (!alias) continue;
            const val = outputVars[alias] ?? outputVars[outKey] ?? outputVars.id ?? outputVars.createdblock ?? outputVars.last_id;
            if (val !== undefined && val !== null && String(val).trim() !== "") {
                targetOutputEntries.push([alias, String(val).trim()]);
            }
        }

        // 兜底：若未显式指定 _outputMapping 但存在 createdblock 出参，也记录为 createdblock
        if (targetOutputEntries.length === 0 && outputVars.createdblock) {
            targetOutputEntries.push(["createdblock", String(outputVars.createdblock).trim()]);
        }

        if (targetOutputEntries.length === 0) return;

        // 若未选择实例化（未创建数据库）或未找到对应的 Layer 4 AV 数据库，直接落盘写回块的 custom-* 属性中！
        if (!tagMatch) {
            console.log(`[Supertag-Output] Layer 4 AV for supertag #${cleanTag} not found. Persisting ${targetOutputEntries.length} output variables to block custom attributes instead.`);
            const customAttrs: Record<string, string> = {};
            for (const [alias, valStr] of targetOutputEntries) {
                const attrName = alias.startsWith("custom-") ? alias : `custom-${alias}`;
                customAttrs[attrName] = valStr;
            }
            if (Object.keys(customAttrs).length > 0) {
                await post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: customAttrs
                });
                console.log(`[Supertag-Output] Successfully set custom attributes on block ${blockId}:`, customAttrs);
            }
            return;
        }

        const avId = tagMatch.avId;
        let { blockToItem } = await getColIDMap(avId);
        let itemId = blockToItem.get(blockId);

        if (!itemId) {
            // @ts-ignore
            const newGenItemId = window.Lute?.NewNodeID() || Date.now().toString();
            await post("/api/av/addAttributeViewBlocks", {
                avID: avId,
                srcs: [{ itemID: newGenItemId, id: blockId, isDetached: false }]
            });
            await sleep(300);
            const refreshedMap = await getColIDMap(avId);
            itemId = refreshedMap.blockToItem.get(blockId) || newGenItemId;
        }

        // 2. 获取当前 AV 的全量列定义 (Keys)
        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
        const existingKeys: any[] = Array.isArray(keysRes) ? keysRes : (keysRes?.keys || []);
        let lastKeyId = existingKeys.length > 0 ? existingKeys[existingKeys.length - 1].id : "";

        console.log(`[Supertag-Output] 📤 Persisting ${targetOutputEntries.length} explicit output variables to Layer 4 AV #${cleanTag} (${avId}):`, targetOutputEntries);

        // 3. 逐个检查并自动建列 (Auto-create missing Column)
        for (const [colName, valStr] of targetOutputEntries) {
            let keyObj = existingKeys.find((k: any) => k.name === colName);
            let keyId = keyObj?.id;

            if (!keyId) {
                // @ts-ignore
                keyId = window.Lute?.NewNodeID() || Date.now().toString();
                console.log(`[Supertag-Output] ✨ Auto-creating missing Text Column "${colName}" in Layer 4 AV #${cleanTag}...`);
                
                await post("/api/av/addAttributeViewKey", {
                    avID: avId,
                    keyID: keyId,
                    keyName: colName,
                    keyType: "text",
                    keyIcon: "iconText",
                    previousKeyID: lastKeyId
                });

                lastKeyId = keyId;
                existingKeys.push({ id: keyId, name: colName, type: "text" });
                await new Promise(r => setTimeout(r, 200));
            }

            // 4. 将出参数据写入对应列的单元格中！
            console.log(`[Supertag-Output] 💾 Writing cell value for Column "${colName}": ${valStr}`);
            await post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID: avId,
                values: [{
                    keyID: keyId,
                    itemID: itemId,
                    value: {
                        type: "text",
                        text: { content: valStr }
                    }
                }]
            });
        }
    } catch (e) {
        console.error("[Supertag-Output] Failed to persist output variables to Layer 4:", e);
    }
}
