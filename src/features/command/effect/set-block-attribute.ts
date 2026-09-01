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
import { getPhysicalAttrKey } from "../../unified-attributes/core/supertag-schema";
import type { CommandContext, DispatchResult } from "../command-dispatcher";

/**
 * 4-Stage 属性键解析流水线 (Resolution Pipeline)
 * 1. 原生内置特权字段 (name, alias, memo, bookmark) -> 原生直存
 * 2. 显式全局逃逸 (global.prop 或 global-prop) -> custom-<prop>
 * 3. 显式指定所属标签 (如 project.deadline) -> custom-tag--project--deadline (并 JIT 扩列)
 * 4. 缺省裸字段多态决议 -> Supertag 上下文中打专属标签，全局独立上下文中存原名
 */
export async function resolveTargetAttributeKey(
    rawKey: string,
    rawValue: any,
    contextTag?: string
): Promise<{ physicalKey: string; isNative: boolean; isScoped: boolean; targetTag?: string }> {
    const trimmed = rawKey.trim();

    // ── Stage 0: 物理原键直通 (杜绝二次套娃) ──
    if (trimmed.startsWith("custom-tag--") || trimmed.startsWith("custom-b32-")) {
        const { parsePhysicalAttrKey } = await import("../../unified-attributes/core/supertag-schema");
        const parsed = parsePhysicalAttrKey(trimmed);
        return { physicalKey: trimmed, isNative: false, isScoped: Boolean(parsed?.tag), targetTag: parsed?.tag };
    }
    if (trimmed.startsWith("custom-")) {
        return { physicalKey: trimmed, isNative: false, isScoped: false };
    }

    // ── Stage 1: 原生内置特权字段 ──
    const NATIVE_FIELDS = new Set(["bookmark", "name", "alias", "memo"]);
    if (NATIVE_FIELDS.has(trimmed.toLowerCase())) {
        return { physicalKey: trimmed.toLowerCase(), isNative: true, isScoped: false };
    }

    // ── Stage 2: 显式全局逃逸 (global.prop 或 global-prop) ──
    if (/^global[.-]/i.test(trimmed)) {
        const bareProp = trimmed.replace(/^global[.-]/i, "").trim();
        const physicalKey = getPhysicalAttrKey("", bareProp);
        return { physicalKey, isNative: false, isScoped: false };
    }

    // ── Stage 3: 显式跨标签指定 (如 project.deadline) ──
    const dotIndex = trimmed.indexOf(".");
    if (dotIndex > 0) {
        const explicitTag = trimmed.slice(0, dotIndex).replace(/^#+/, "").trim().toLowerCase();
        const explicitProp = trimmed.slice(dotIndex + 1).trim();
        if (explicitTag && explicitProp && explicitTag !== "global") {
            const { preflightSupertagProperty } = await import("../../unified-attributes/core/supertag-schema");
            const preflight = await preflightSupertagProperty(explicitTag, explicitProp, rawValue);
            return { physicalKey: preflight.physicalKey, isNative: false, isScoped: true, targetTag: explicitTag };
        }
    }

    // ── Stage 4: 缺省裸字段多态决议 ──
    const cleanContextTag = (contextTag || "").replace(/^#+/, "").trim().toLowerCase();
    if (cleanContextTag) {
        // 4A: 处于 Supertag 上下文中 -> 自动吸附为该标签的私有专属属性，并 JIT 扩列
        const { preflightSupertagProperty } = await import("../../unified-attributes/core/supertag-schema");
        const preflight = await preflightSupertagProperty(cleanContextTag, trimmed, rawValue);
        return { physicalKey: preflight.physicalKey, isNative: false, isScoped: true, targetTag: cleanContextTag };
    }

    // 4B: 全局独立上下文中 -> 直接作为全局属性存原名
    const physicalKey = getPhysicalAttrKey("", trimmed);
    return { physicalKey, isNative: false, isScoped: false };
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

    // 确定当前的显式 Supertag 上下文 (仅当命令从 Supertag 相关入口派发时才存在)
    const contextTag = (context?.supertag || params?.supertag || "").replace(/^#+/, "").trim().toLowerCase();

    const finalAttrs: Record<string, string> = {};
    const affectedTags = new Set<string>();

    for (const [rawK, rawV] of Object.entries(rawAttrsMap)) {
        const resolution = await resolveTargetAttributeKey(rawK, rawV, contextTag);
        finalAttrs[resolution.physicalKey] = rawV !== undefined && rawV !== null ? String(rawV) : "";
        if (resolution.targetTag) {
            affectedTags.add(resolution.targetTag);
        }
    }

    console.log(`[SetBlockAttribute] 🏷️ 正在批量设置块 ${rawId} 属性:`, finalAttrs, `(Context Supertag: ${contextTag || 'none'})`);

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

    // 内存虚拟投影联动：若相关 Supertag 已建立虚拟投影，同步更新内存 SQLite 热表
    for (const tag of affectedTags) {
        try {
            const { syncBlockToSQLite } = await import("../../unified-attributes/projection/hot-table-engine");
            await syncBlockToSQLite(rawId);
            const { supertagAVProjector } = await import("../../unified-attributes/projection/supertag-av-projector");
            const boundAvId = supertagAVProjector.getBoundAVId(tag);
            if (boundAvId) {
                supertagAVProjector.notifyFrontendToRerender(boundAvId, rawId);
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
