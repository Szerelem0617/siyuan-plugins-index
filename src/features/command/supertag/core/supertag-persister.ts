/**
 * supertag-persister.ts
 *
 * Supertag 数据存储大一统治理：
 * 1. 唯一物理持久化真理源：所有命令产出的业务变量 100% 统一写入块自身的物理 IAL (custom-<tag>.<varName>)
 * 2. 0-Disk 物理 AV 写入：不再向物理 .av/*.json 写入冗余数据，彻底杜绝文件膨胀与双写漂移
 * 3. 内存投影联动：若该 Supertag 已建立 Hot-SQLite 虚拟投影，自动同步更新内存热表并通知视图就地重绘
 */

import { post } from "../../../../shared/api-client/request";
import { sanitizeBlockAttrName } from "../../utils/attribute-sanitizer";
import { SUPERTAG_REGISTRY } from "../../registration";
import { supertagAVProjector } from "../projection/supertag-av-projector";
import { getSqliteEngine } from "../../../sqlite/sqlite-manager";

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

/**
 * 将出参变量统一持久化到物理块 IAL (custom-<tag>.<varName>)
 */
export async function persistOutputVariablesToLayer4(
    blockId: string,
    tag: string,
    outputVars: Record<string, any>
): Promise<void> {
    const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
    if (!blockId || !cleanTag || !outputVars || Object.keys(outputVars).length === 0) return;

    try {
        const targetOutputEntries: [string, string][] = [];
        const SYSTEM_ENV_KEYS = new Set(["date", "time", "block_id", "root_id", "parent_id", "id", "last_id"]);

        // 1. 收集所有以 var. 开头或自定义的有效出参变量
        for (const [k, v] of Object.entries(outputVars)) {
            if (k.startsWith("_")) continue;
            if (SYSTEM_ENV_KEYS.has(k)) continue;
            if (!k.startsWith("var.")) continue;
            if (v !== undefined && v !== null && String(v).trim() !== "") {
                const varName = k.replace(/^var\./, "").trim();
                targetOutputEntries.push([varName, String(v).trim()]);
            }
        }

        if (targetOutputEntries.length === 0) return;

        // 2. 检查是否有下游消费需求
        const activeEntries = targetOutputEntries.filter(([varName]) => isOutputUsedByDownstream(cleanTag, varName));
        if (activeEntries.length === 0) {
            console.log(`[Supertag-Output] 🍃 Supertag #${cleanTag} 出参无下游消费依赖，不进行无谓的物理属性持久化。`);
            return;
        }

        // 3. 构造带命名空间的物理属性键名: custom-<tag>.<varName>
        const customAttrs: Record<string, string> = {};
        for (const [varName, valStr] of activeEntries) {
            const cleanVar = sanitizeBlockAttrName(varName);
            const namespacedKey = `custom-${cleanTag}.${cleanVar}`;
            customAttrs[namespacedKey] = valStr;
        }

        // 4. 统一写入物理 Markdown 块自身 (单一物理真理源)
        if (Object.keys(customAttrs).length > 0) {
            try {
                await post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: customAttrs
                });
                console.log(`[Supertag-Output] ✓ 已将 ${Object.keys(customAttrs).length} 个出参属性持久化至块 ${blockId}:`, customAttrs);
            } catch (attrErr) {
                console.warn(`[Supertag-Output] 批量写入属性异常，回退单项安全写入:`, attrErr);
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

        // 5. 内存虚拟投影热表联动：若该 Supertag 已建立虚拟投影，同步更新内存 SQLite 热表并重绘
        const boundAvId = supertagAVProjector.getBoundAVId(cleanTag);
        if (boundAvId) {
            const binding = supertagAVProjector.getBinding(boundAvId);
            if (binding) {
                try {
                    const { db } = await getSqliteEngine();
                    for (const [varName, valStr] of activeEntries) {
                        try {
                            db.run(`UPDATE "${binding.tableName}" SET "${varName}" = ?, _updated = ? WHERE id = ?;`, [valStr, Date.now(), blockId]);
                        } catch (_) {}
                    }
                    supertagAVProjector.notifyFrontendToRerender(boundAvId, blockId);
                } catch (_) {}
            }
        }
    } catch (e) {
        console.error("[Supertag-Output] 持久化出参属性异常:", e);
    }
}
