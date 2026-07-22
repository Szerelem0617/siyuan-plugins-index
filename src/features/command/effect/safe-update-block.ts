import { post } from "../../../shared/api-client/request";
import { resolveTemplate, getBlockId, type CommandContext } from "../command-dispatcher";
import { SupertagRenderer } from "../supertag";
import { formatDate } from "../../../shared/utils";

/**
 * 安全更新块内容 (Safe Update Block)
 *
 * 机制：
 * 1. 更新前获取原块所有属性（特别是 custom-supertags, custom-av-*, av-names, memo, bookmark 等）；
 * 2. 调用 /api/block/updateBlock 更新块内容；
 * 3. 通过 /api/attr/setBlockAttrs 完整还原已存在的 IAL 自定义属性与 SiYuan 原生数据库标记 (av-names)；
 * 4. 零延迟前端同步：即时写回 DOM 属性，并在 .protyle-attr 中完整绘制数据库图标徽章 (.protyle-attr--av)
 *    与 Supertag 胶囊，解决更新后数据库图标消失的问题。
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

    // 1. 备份原块的全部属性（特别保护 av-names, custom-avs, custom-* 等）
    let oldAttrs: Record<string, any> = {};
    try {
        const oldAttrsRes = await post("/api/attr/getBlockAttrs", { id });
        oldAttrs = oldAttrsRes?.data || oldAttrsRes || {};
    } catch (e) {
        console.warn("[SafeUpdateBlock] Failed to fetch old block attributes before update:", e);
    }

    const preserveAttrs: Record<string, string> = {};
    for (const [key, val] of Object.entries(oldAttrs)) {
        if (
            key.startsWith("custom-") || 
            key.includes("av") || 
            key === "av-names" || 
            key === "memo" || 
            key === "bookmark" || 
            key === "style" || 
            key === "name" || 
            key === "alias"
        ) {
            preserveAttrs[key] = String(val);
        }
    }

    console.log(`[SafeUpdateBlock] Updating block ${id} while preserving ${Object.keys(preserveAttrs).length} attributes:`, preserveAttrs);

    // 2. 调用思源原生接口更新块内容
    const updateRes = await post("/api/block/updateBlock", { id, data, dataType });

    // 3. 还原保留的自定义属性与数据库关联属性
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

    // 4. 纯前端零延迟同步：还原 DOM 属性与右侧数据库图标小标
    try {
        const activeProtyle = (window as any).activeProtyleInstance || (window as any).siyuan?.ws?.protyle;
        const blockEl = (activeProtyle?.element?.querySelector(`[data-node-id="${id}"]`) || document.querySelector(`[data-node-id="${id}"]`)) as HTMLElement;

        if (blockEl) {
            // 设置属性至 DOM
            for (const [k, v] of Object.entries(preserveAttrs)) {
                blockEl.setAttribute(k, v);
            }

            // 即时重绘 Supertag 胶囊
            SupertagRenderer.renderSingleBlockElement(blockEl);

            // 渲染/补全右侧思源原生数据库小标 (.protyle-attr--av)
            const avName = preserveAttrs["av-names"] || preserveAttrs["custom-av-name"];
            if (avName) {
                let attrEl = blockEl.querySelector(".protyle-attr") as HTMLElement;
                if (!attrEl) {
                    attrEl = document.createElement("div");
                    attrEl.className = "protyle-attr";
                    attrEl.setAttribute("contenteditable", "false");
                    blockEl.appendChild(attrEl);
                }
                let avBadge = attrEl.querySelector(".protyle-attr--av") as HTMLElement;
                if (!avBadge) {
                    avBadge = document.createElement("div");
                    avBadge.className = "protyle-attr--av";
                    avBadge.innerHTML = `<svg><use xlink:href="#iconDatabase"></use></svg>${avName}`;
                    attrEl.appendChild(avBadge);
                } else {
                    avBadge.innerHTML = `<svg><use xlink:href="#iconDatabase"></use></svg>${avName}`;
                }
            }

            // 若包含数据库块，通知后端渲染 AV
            const avEl = blockEl.classList.contains("av") || blockEl.getAttribute("data-type") === "NodeAttributeView"
                ? blockEl
                : blockEl.querySelector('[data-type="NodeAttributeView"]');
            const avId = avEl?.getAttribute("data-av-id");
            if (avId) {
                await post("/api/av/renderAttributeView", { id: avId });
            }
        }

        // 触发思源 UI 更新事务
        await post("/api/transactions", {
            app: "plugin-index",
            reqId: Date.now(),
            transactions: [{ doOperations: [{ action: "doUpdateUpdated", id, data: formatDate(new Date()) }] }]
        });

    } catch (uiErr) {
        console.warn("[SafeUpdateBlock] Failed to sync frontend UI after block update:", uiErr);
    }

    return {
        success: true,
        detail: `Updated block ${id} safely`,
        data: updateRes,
        value: updateRes,
        id
    };
}
