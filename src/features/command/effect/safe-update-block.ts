import { post } from "../../../shared/api-client/request";
import { resolveTemplate, getBlockId, type CommandContext } from "../command-dispatcher";

/**
 * 安全更新块内容 (Safe Update Block)
 *
 * 机制：
 * 1. 更新前获取原块所有属性（特别是 custom-supertag, custom-avs, custom-av-*, memo, bookmark 等）；
 * 2. 调用 /api/block/updateBlock 更新块内容；
 * 3. 通过 /api/attr/setBlockAttrs 完整还原已存在的 IAL 自定义属性，防止更新内容导致属性被擦除清空。
 */
export async function triggerSafeUpdateBlock(params: Record<string, unknown>, context?: CommandContext) {
    console.log("[SafeUpdateBlock] triggerSafeUpdateBlock called with params:", params);
    
    let rawId = String(params?.id || params?.block_id || "").trim();
    let id = "";

    const ctx = context || { blockEl: null as any, protyleEl: null };
    if (rawId) {
        id = await resolveTemplate(rawId, ctx);
    }

    // 容错兜底：如果模板解析未替换掉 {{（说明数据库中存的是空字符串），优先从上下文变量池提取新创建块的 ID
    if (!id || id.includes("{{") || id.includes("${")) {
        const fallbackId = String(ctx?.vars?.createdblock || ctx?.vars?.last_id || ctx?.vars?.id || "").trim();
        if (fallbackId && !fallbackId.includes("{{")) {
            console.log(`[SafeUpdateBlock] Fallback: Used context.vars createdblock/last_id "${fallbackId}" instead of empty template resolution.`);
            id = fallbackId;
        } else if (!id || id.includes("{{")) {
            id = getBlockId(ctx);
        }
    }

    console.log(`[SafeUpdateBlock] Target block ID resolved to: "${id}" (rawId was: "${rawId}")`);

    const rawData = String(params?.data || params?.content || "").trim();
    const data = rawData ? await resolveTemplate(rawData, ctx) : "";
    const dataType = String(params?.dataType || "markdown").trim();

    if (!id || id.includes("{{")) {
        console.error("[SafeUpdateBlock] Invalid target block ID:", id);
        return { success: false, detail: `Invalid target block ID: ${id}` };
    }
    if (!data) {
        console.error("[SafeUpdateBlock] Missing update content data.");
        return { success: false, detail: "Missing update content data" };
    }

    // 1. 备份原块的全部属性
    let oldAttrs: Record<string, any> = {};
    try {
        const oldAttrsRes = await post("/api/attr/getBlockAttrs", { id });
        oldAttrs = oldAttrsRes?.data || oldAttrsRes || {};
    } catch (e) {
        console.warn("[SafeUpdateBlock] Failed to fetch old block attributes before update:", e);
    }

    const preserveAttrs: Record<string, string> = {};
    for (const [key, val] of Object.entries(oldAttrs)) {
        if (key.startsWith("custom-") || key === "memo" || key === "bookmark" || key === "style") {
            preserveAttrs[key] = String(val);
        }
    }

    console.log(`[SafeUpdateBlock] Updating block ${id} while preserving ${Object.keys(preserveAttrs).length} attributes:`, preserveAttrs);

    // 2. 调用思源原生接口更新块 DOM / Markdown
    const updateRes = await post("/api/block/updateBlock", { id, data, dataType });

    // 3. 还原保留的自定义属性
    if (Object.keys(preserveAttrs).length > 0) {
        try {
            await post("/api/attr/setBlockAttrs", {
                id,
                attrs: preserveAttrs
            });
            console.log(`[SafeUpdateBlock] Successfully restored attributes for block ${id}`);
        } catch (e) {
            console.error(`[SafeUpdateBlock] Failed to restore attributes for block ${id}:`, e);
        }
    }

    return {
        success: true,
        detail: `Updated block ${id} safely`,
        data: updateRes,
        value: updateRes,
        id
    };
}
