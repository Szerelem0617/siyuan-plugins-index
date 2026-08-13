/**
 * supertag-persister.ts
 *
 * 将命令执行后动态产出的变量全白盒落盘保存。
 * 规则：仅当出参存在下游消费场景 (Layer 4 AV 数据库 / IconMenu 绑定命令 / 后续 Pipeline 步骤) 时才落盘写物理属性。
 */

import { post } from "../../../../shared/api-client/request";
import { getGlobalTypeConfigs } from "../../../av/av-setting/db-config";
import { getColIDMap } from "../../../../shared/utils/av-utils";
import { sleep } from "../../../../shared/utils";

import { sanitizeBlockAttrName } from "../../utils/attribute-sanitizer";
import { SUPERTAG_REGISTRY } from "../../registration";

/**
 * 校验出参变量是否在下游有实际消费使用者 (IconMenu / Button 绑定命令或 Pipeline 后续步骤)
 */
function isOutputUsedByDownstream(supertagLabel: string, varName: string): boolean {
    const cleanTag = (supertagLabel || "").replace(/#/g, "").trim().toLowerCase();
    const cleanVar = varName.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").replace(/^var\./, "").trim();

    // 1. 检查在该 Tag 绑定的 Icon Menu / Button 命令中，是否有命令需要消费该出参
    const boundEntries = SUPERTAG_REGISTRY.filter(item => 
        item.typeTag.replace(/#/g, "").trim().toLowerCase() === cleanTag &&
        item.commandRef
    );

    for (const entry of boundEntries) {
        // 若绑定了 safeUpdateBlock 等更新块命令，默认需要消费创块 ID 出参
        if (entry.commandRef.includes("safeUpdateBlock") || entry.commandRef.includes("updateBlock")) {
            return true;
        }
        if (entry.inputMapping && (entry.inputMapping.includes(cleanVar) || entry.inputMapping.includes(`var.${cleanVar}`))) {
            return true;
        }
    }

    // 2. 检查 Conditional 脚本后续步骤中是否有显式引用
    const regMatch = SUPERTAG_REGISTRY.find(item => item.typeTag.replace(/#/g, "").trim().toLowerCase() === cleanTag);
    if (regMatch?.conditionalScript) {
        const script = regMatch.conditionalScript;
        if (script.includes(cleanVar) || script.includes(`var.${cleanVar}`)) {
            return true;
        }
    }

    return false;
}

export async function persistOutputVariablesToLayer4(
    blockId: string,
    tag: string,
    outputVars: Record<string, any>
): Promise<void> {
    const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
    if (!blockId || !cleanTag || !outputVars || Object.keys(outputVars).length === 0) return;

    try {
        const configs = await getGlobalTypeConfigs();
        const tagMatch = configs.find(c => c.typeName.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase() === cleanTag.toLowerCase());
        
        const targetOutputEntries: [string, string][] = [];

        const SYSTEM_ENV_KEYS = new Set(["date", "time", "block_id", "root_id", "parent_id", "id", "last_id"]);

        // 1. 全白盒精准收集：只保存以 var. 开头且有值的出参变量
        for (const [k, v] of Object.entries(outputVars)) {
            if (k.startsWith("_")) continue;
            if (SYSTEM_ENV_KEYS.has(k)) continue;
            if (!k.startsWith("var.")) continue;
            if (v !== undefined && v !== null && String(v).trim() !== "") {
                targetOutputEntries.push([k, String(v).trim()]);
            }
        }

        if (targetOutputEntries.length === 0) return;

        // 2. 若未实例化 AV 数据库，检查是否存在下游消费使用；若无消费依赖，跳过持久化！
        if (!tagMatch) {
            const activeEntries = targetOutputEntries.filter(([k]) => isOutputUsedByDownstream(cleanTag, k));
            if (activeEntries.length === 0) {
                console.log(`[Supertag-Output] 🍃 Supertag #${cleanTag} 出参无下游 (IconMenu/Button/Pipeline) 消费依赖，不进行无谓的物理属性持久化。`);
                return;
            }

            console.log(`[Supertag-Output] Layer 4 AV for supertag #${cleanTag} not found. Persisting ${activeEntries.length} output variables to block custom attributes instead.`);
            const customAttrs: Record<string, string> = {};
            for (const [varName, valStr] of activeEntries) {
                const attrName = sanitizeBlockAttrName(varName);
                customAttrs[attrName] = valStr;
            }
            if (Object.keys(customAttrs).length > 0) {
                try {
                    await post("/api/attr/setBlockAttrs", {
                        id: blockId,
                        attrs: customAttrs
                    });
                    console.log(`[Supertag-Output] Successfully set custom attributes on block ${blockId}:`, customAttrs);
                } catch (attrErr) {
                    console.warn(`[Supertag-Output] Bulk setBlockAttrs failed, falling back to item-by-item safe set:`, attrErr);
                    for (const [k, v] of Object.entries(customAttrs)) {
                        try {
                            await post("/api/attr/setBlockAttrs", {
                                id: blockId,
                                attrs: { [k]: v }
                            });
                        } catch (_) {}
                    }
                }
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

        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
        const existingKeys: any[] = Array.isArray(keysRes) ? keysRes : (keysRes?.keys || []);
        let lastKeyId = existingKeys.length > 0 ? existingKeys[existingKeys.length - 1].id : "";

        console.log(`[Supertag-Output] 📤 Persisting ${targetOutputEntries.length} explicit output variables to Layer 4 AV #${cleanTag} (${avId}):`, targetOutputEntries);

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
