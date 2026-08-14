/**
 * effect/set-block-attribute.ts
 *
 * 统一设置/更新块属性 (Upsert 模式：无则自动挂载创建，有则更新覆写)
 * 命令执行器保持纯粹职责：参数解析由调度器统一完成，执行器只负责核心业务与 API 交互。
 */

import { post } from "../../../shared/api-client/request";
import { sanitizeBlockAttrName } from "../utils/attribute-sanitizer";
import type { CommandContext, DispatchResult } from "../command-dispatcher";

export async function setBlockAttribute(
    params: { id?: string; attrName?: string; attrValue?: string },
    context?: CommandContext
): Promise<DispatchResult> {
    const rawId = String(params?.id || "").trim();
    const rawName = String(params?.attrName || "").trim();
    const rawVal = params?.attrValue !== undefined ? String(params.attrValue) : "";

    if (!rawId) {
        throw new Error("[SetBlockAttribute] 缺少必要的目标块 ID (id)");
    }
    if (!rawName) {
        throw new Error("[SetBlockAttribute] 缺少必要的属性名参数 (attrName)");
    }

    const cleanAttrName = sanitizeBlockAttrName(rawName);

    console.log(`[SetBlockAttribute] 🏷️ 正在设置块 ${rawId} 属性: ${cleanAttrName} = "${rawVal}"`);

    await post("/api/attr/setBlockAttrs", {
        id: rawId,
        attrs: {
            [cleanAttrName]: rawVal
        }
    });

    console.log(`[SetBlockAttribute] ✓ 成功设置块 ${rawId} 属性: ${cleanAttrName} = "${rawVal}"`);

    // 即时 DOM 同步与复选框渲染触发（0 延迟 UI 响应）
    const liveBlockEl = document.querySelector(`[data-node-id="${rawId}"]`) as HTMLElement;
    if (liveBlockEl) {
        if (rawVal) {
            liveBlockEl.setAttribute(cleanAttrName, rawVal);
        } else {
            liveBlockEl.removeAttribute(cleanAttrName);
        }
        if (cleanAttrName === "custom-index-task" || cleanAttrName === "custom-supertags") {
            try {
                const { SupertagRenderer } = await import("../supertag");
                if (liveBlockEl.classList.contains("protyle-title") || liveBlockEl.closest(".protyle-title")) {
                    const editorEl = (liveBlockEl.closest(".protyle") || document.querySelector(".protyle")) as HTMLElement;
                    await SupertagRenderer.renderDocumentTags(rawId, editorEl);
                } else {
                    SupertagRenderer.renderSingleBlockElement(liveBlockEl);
                }
            } catch (_) {}
        }
    }

    if (context) {
        if (!context.vars) context.vars = {};
        context.vars.attrValue = rawVal;
        context.vars["var.attrValue"] = rawVal;
    }

    return {
        success: true,
        method: "custom",
        detail: `Set attribute ${cleanAttrName} on block ${rawId}`,
        value: {
            attrName: cleanAttrName,
            attrValue: rawVal
        },
        id: rawId
    };
}
