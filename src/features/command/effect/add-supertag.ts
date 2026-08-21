/**
 * add-supertag.ts
 * 为指定块添加超级标签 (Supertag) 命令 (universal)
 *
 * 核心架构：
 * 1. 读写思源自定义属性 `custom-supertags` (JSON 数组串如 ["task"])；
 * 2. 避免对思源原生普通标签 (`tags`) 的错误污染；
 * 3. 前端 DOM (如有) 自动设置 `custom-supertags` 属性以触发 MutationObserver / SupertagRenderer 渲染 UI 胶囊；
 * 4. 必定联动广播触发 `tag_created` 事件钩子。
 */

import { post } from "../../../shared/api-client/request";
import type { CommandContext, DispatchResult } from "../command-dispatcher";
import { getBlockId } from "../utils/context-extractor";
import { triggerConditionalCommands } from "../supertag/core/supertag-trigger";
import { parseSupertags, serializeSupertags } from "../supertag/core/supertag-diff";
import { globalSupertagsCache } from "../registration";

import { SupertagRenderer } from "../supertag/renderer/SupertagRenderer";

export async function triggerAddSupertag(
    resolvedParams: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    const targetBlockId = String(resolvedParams.id || getBlockId(context) || "").trim();
    let tagRaw = String(resolvedParams.tag ?? "").trim();
    const cleanTag = tagRaw.replace(/^#/, "").trim();

    if (!targetBlockId) {
        console.warn("[AddSupertag] 错误：未指定目标块 ID");
        return { success: false, method: "custom", detail: "Missing target block ID" };
    }

    if (!cleanTag) {
        console.warn("[AddSupertag] 错误：未指定有效超级标签名");
        return { success: false, method: "custom", detail: "Missing supertag name" };
    }

    try {
        // 1. 读取目标块的块属性中的 custom-supertags
        const attrsRes = await post("/api/attr/getBlockAttrs", { id: targetBlockId });
        const attrs = attrsRes?.data || attrsRes || {};
        const rawCustomTags = attrs["custom-supertags"] || "";
        const currentSupertags = parseSupertags(rawCustomTags);

        // 2. 追加新 Supertag（如尚未包含，忽略大小写去重）
        let updated = false;
        if (!currentSupertags.some(t => t.toLowerCase() === cleanTag.toLowerCase())) {
            currentSupertags.push(cleanTag);
            updated = true;
        }

        const newRawCustomTags = serializeSupertags(currentSupertags);

        if (updated) {
            // A. 前端 DOM 属性更新与即时渲染
            if (context.blockEl) {
                context.blockEl.setAttribute("custom-supertags", newRawCustomTags);
                SupertagRenderer.renderSingleBlockElement(context.blockEl);
            }
            const activeProtyle = (window as any).activeProtyleInstance || (window as any).siyuan?.ws?.protyle;
            const editorEl = activeProtyle?.element || document.querySelector(".protyle-content") || document.body;
            if (editorEl) {
                const domBlock = editorEl.querySelector(`[data-node-id="${targetBlockId}"]`) as HTMLElement | null;
                if (domBlock) {
                    domBlock.setAttribute("custom-supertags", newRawCustomTags);
                    SupertagRenderer.renderSingleBlockElement(domBlock);
                }
            }

            // B. 全局 Supertag 内存缓存同步
            globalSupertagsCache.set(targetBlockId, currentSupertags);

            // C. 写入思源后端自定义属性 custom-supertags
            await post("/api/attr/setBlockAttrs", {
                id: targetBlockId,
                attrs: {
                    "custom-supertags": newRawCustomTags
                }
            });
            console.log(`[AddSupertag] 成功为块 ${targetBlockId} 写入超级标签 custom-supertags: "${newRawCustomTags}"`);

            // 3. 核心：仅在真正新增了标签时，才联动广播触发 Supertag tag_created 事件
            console.log(`[AddSupertag] ⚡ 联动广播 triggerConditionalCommands(#${cleanTag}, tag_created)...`);
            await triggerConditionalCommands(targetBlockId, cleanTag, "tag_created");
        } else {
            console.log(`[AddSupertag] 块 ${targetBlockId} 已包含超级标签 #${cleanTag}，跳过重写与 tag_created 触发`);
        }

        return {
            success: true,
            method: "custom",
            detail: `Supertag #${cleanTag} applied`,
            value: cleanTag,
            id: targetBlockId
        };
    } catch (error: any) {
        console.error(`[AddSupertag] 执行异常:`, error);
        return {
            success: false,
            method: "custom",
            detail: error.message || String(error)
        };
    }
}
