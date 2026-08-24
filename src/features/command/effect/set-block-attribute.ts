/**
 * effect/set-block-attribute.ts
 *
 * 统一设置/更新块属性 (Upsert 模式：无则自动挂载创建，有则更新覆写)
 * 智能适配 Supertag 命名空间：
 * 1. 在 Supertag 上下文触发时，默认自动打上前缀 (如 custom-task.status)；
 * 2. 支持使用 {{supertag}} 或 {{tag}} 进行模板插值；
 * 3. 支持使用 global. 前缀 (如 global.status) 显式逃逸打全局跨标签共享属性；
 * 4. 自动同步底层 Hot-SQLite 内存虚拟投影热表并触发前端即时无感重绘。
 */

import { post } from "../../../shared/api-client/request";
import { sanitizeBlockAttrName } from "../utils/attribute-sanitizer";
import type { CommandContext, DispatchResult } from "../command-dispatcher";

/**
 * 智能解析属性名称与命名空间
 */
function resolveNamespacedAttrName(rawName: string, context?: CommandContext): string {
    const trimmed = rawName.trim();

    // 1. 显式全局共享逃逸标记: global.status 或 global-status -> custom-status
    if (trimmed.toLowerCase().startsWith("global.") || trimmed.toLowerCase().startsWith("global-")) {
        const sub = trimmed.replace(/^global[.-]/i, "");
        return sanitizeBlockAttrName(sub);
    }

    // 2. 原生内置属性: bookmark, name, alias, memo
    if (["bookmark", "name", "alias", "memo"].includes(trimmed.toLowerCase())) {
        return trimmed.toLowerCase();
    }

    const cleanTag = (context?.supertag || "").replace(/#/g, "").trim().toLowerCase();

    // 3. 在 Supertag 触发上下文中：自动赋予该 Tag 的命名空间 (物理存储格式: custom-<tag>-<attr>)
    if (cleanTag) {
        let pure = trimmed.replace(/^custom-/, "");

        // 已经带有当前 Tag 前缀 (如 task.status 或 task_status 或 task-status)
        if (pure.toLowerCase().startsWith(`${cleanTag}.`)) {
            pure = pure.slice(cleanTag.length + 1);
        } else if (pure.toLowerCase().startsWith(`${cleanTag}_`)) {
            pure = pure.slice(cleanTag.length + 1);
        } else if (pure.toLowerCase().startsWith(`${cleanTag}-`)) {
            pure = pure.slice(cleanTag.length + 1);
        }

        const cleanSub = sanitizeBlockAttrName(pure).replace(/^custom-/, "");
        return `custom-${cleanTag}-${cleanSub}`;
    }

    // 4. 无 Supertag 上下文时作为普通自定义属性
    return sanitizeBlockAttrName(trimmed);
}

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

    const cleanAttrName = resolveNamespacedAttrName(rawName, context);
    const cleanTag = (context?.supertag || "").replace(/#/g, "").trim().toLowerCase();

    console.log(`[SetBlockAttribute] 🏷️ 正在设置块 ${rawId} 属性: ${cleanAttrName} = "${rawVal}" (Supertag: ${cleanTag || 'none'})`);

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
        if (cleanAttrName.includes("task") || cleanAttrName === "custom-supertags") {
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

    // 内存虚拟投影联动：若该 Supertag 已建立虚拟投影，同步更新内存 SQLite 热表
    if (cleanTag) {
        try {
            const { supertagAVProjector } = await import("../../unified-attributes/projection/supertag-av-projector");
            const { getSqliteEngine } = await import("../../sqlite/sqlite-manager");
            const boundAvId = supertagAVProjector.getBoundAVId(cleanTag);
            if (boundAvId) {
                const binding = supertagAVProjector.getBinding(boundAvId);
                if (binding) {
                    const cleanCol = cleanAttrName.replace(new RegExp(`^custom-${cleanTag}[.-]`), "").replace(/^custom-/, "");
                    const { db } = await getSqliteEngine();
                    db.run(`UPDATE "${binding.tableName}" SET "${cleanCol}" = ?, _updated = ? WHERE id = ?;`, [rawVal, Date.now(), rawId]);
                    supertagAVProjector.notifyFrontendToRerender(boundAvId, rawId);
                }
            }
        } catch (_) {}
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
