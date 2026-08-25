/**
 * effect/set-block-attribute.ts
 *
 * 统一设置/更新块属性 (Upsert 模式：无则自动挂载创建，有则更新覆写)
 * 支持单次设置多个属性键值对 (支持多行 key: value 形式、JSON 格式或对象格式)。
 * 智能适配 Supertag 命名空间：
 * 1. 在 Supertag 上下文触发时，默认自动打上前缀 (如 custom-task-status)；
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

/**
 * 解析各种格式的属性输入 (键值对文本、JSON、对象、历史单键值对)
 */
function extractAttributeMap(params: Record<string, any>): Record<string, any> {
    const attrsMap: Record<string, any> = {};

    // 1. 如果传入了 attrs 字段
    if (params?.attrs !== undefined && params?.attrs !== null) {
        const rawAttrs = params.attrs;
        if (typeof rawAttrs === "object") {
            Object.assign(attrsMap, rawAttrs);
        } else if (typeof rawAttrs === "string") {
            const trimmed = rawAttrs.trim();
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (typeof parsed === "object" && parsed !== null) {
                        Object.assign(attrsMap, parsed);
                    }
                } catch {
                    parseKeyValueLines(trimmed, attrsMap);
                }
            } else {
                parseKeyValueLines(trimmed, attrsMap);
            }
        }
    }

    // 2. 兼容直接传参: attrName / attrValue
    if (params?.attrName) {
        const k = String(params.attrName).trim();
        const v = params.attrValue !== undefined ? params.attrValue : "";
        if (k) {
            attrsMap[k] = v;
        }
    }

    // 3. 如果 params 自身直接包含了非系统字段 (且未提供 attrs 字段)
    if (Object.keys(attrsMap).length === 0) {
        const ignoredKeys = new Set(["id", "actualCommandId", "_currentAttrName", "targetScope", "supertag"]);
        for (const [k, v] of Object.entries(params || {})) {
            if (!ignoredKeys.has(k) && v !== undefined) {
                attrsMap[k] = v;
            }
        }
    }

    return attrsMap;
}

function parseKeyValueLines(text: string, out: Record<string, any>) {
    const lines = text.split(/[\r\n]+/);
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) continue;

        const colonIdx = trimmedLine.indexOf(":");
        const equalIdx = trimmedLine.indexOf("=");
        const splitIdx = colonIdx !== -1 ? colonIdx : equalIdx;

        if (splitIdx !== -1) {
            const k = trimmedLine.slice(0, splitIdx).trim();
            const v = trimmedLine.slice(splitIdx + 1).trim();
            if (k) {
                out[k] = v;
            }
        } else {
            out[trimmedLine] = "";
        }
    }
}

export async function setBlockAttribute(
    params: { id?: string; attrs?: any; attrName?: string; attrValue?: string; [key: string]: any },
    context?: CommandContext
): Promise<DispatchResult> {
    const rawId = String(params?.id || context?.blockId || "").trim();
    if (!rawId) {
        throw new Error("[SetBlockAttribute] 缺少必要的目标块 ID (id)");
    }

    const rawAttrsMap = extractAttributeMap(params);
    if (Object.keys(rawAttrsMap).length === 0) {
        throw new Error("[SetBlockAttribute] 缺少要设置的属性 (attrs)");
    }

    const cleanTag = (context?.supertag || "").replace(/#/g, "").trim().toLowerCase();
    const finalAttrs: Record<string, string> = {};

    for (const [rawK, rawV] of Object.entries(rawAttrsMap)) {
        const cleanAttrName = resolveNamespacedAttrName(rawK, context);
        finalAttrs[cleanAttrName] = rawV !== undefined && rawV !== null ? String(rawV) : "";
    }

    console.log(`[SetBlockAttribute] 🏷️ 正在批量设置块 ${rawId} 属性:`, finalAttrs, `(Supertag: ${cleanTag || 'none'})`);

    await post("/api/attr/setBlockAttrs", {
        id: rawId,
        attrs: finalAttrs
    });

    console.log(`[SetBlockAttribute] ✓ 成功批量设置块 ${rawId} 属性:`, finalAttrs);

    // 即时 DOM 同步与复选框渲染触发（0 延迟 UI 响应）
    const liveBlockEl = document.querySelector(`[data-node-id="${rawId}"]`) as HTMLElement;
    if (liveBlockEl) {
        for (const [cleanAttrName, rawVal] of Object.entries(finalAttrs)) {
            if (rawVal) {
                liveBlockEl.setAttribute(cleanAttrName, rawVal);
            } else {
                liveBlockEl.removeAttribute(cleanAttrName);
            }
        }

        const hasTagOrTaskAttr = Object.keys(finalAttrs).some(k => k.includes("task") || k === "custom-supertags");
        if (hasTagOrTaskAttr) {
            try {
                const { SupertagRenderer } = await import("../../unified-attributes/renderer/SupertagRenderer");
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
                    const { db } = await getSqliteEngine();
                    for (const [cleanAttrName, rawVal] of Object.entries(finalAttrs)) {
                        const cleanCol = cleanAttrName.replace(new RegExp(`^custom-${cleanTag}[.-]`), "").replace(/^custom-/, "");
                        try {
                            db.run(`UPDATE "${binding.tableName}" SET "${cleanCol}" = ?, _updated = ? WHERE id = ?;`, [rawVal, Date.now(), rawId]);
                        } catch (_) {}
                    }
                    supertagAVProjector.notifyFrontendToRerender(boundAvId, rawId);
                }
            }
        } catch (_) {}
    }

    return {
        success: true,
        method: "custom",
        detail: `Set attributes on block ${rawId}: ${Object.keys(finalAttrs).join(", ")}`,
        value: finalAttrs,
        id: rawId
    };
}
