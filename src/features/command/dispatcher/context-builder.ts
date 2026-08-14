/**
 * dispatcher/context-builder.ts
 *
 * 负责统一构建、清洗和标准化 CommandContext，
 * 自动完成 DOM 空间物理坐标 (geometry) 的预计算与逻辑数据轨的初始化。
 */

import type { CommandContext, ContextGeometry } from "./types";

/** 获取默认屏幕中央几何尺寸 */
export function getDefaultGeometry(): ContextGeometry {
    const w = typeof window !== "undefined" ? window.innerWidth : 1920;
    const h = typeof window !== "undefined" ? window.innerHeight : 1080;
    return {
        x: Math.round(w / 2 - 80),
        y: Math.round(h / 2 - 20),
        width: 160,
        height: 40,
        centerX: Math.round(w / 2),
        centerY: Math.round(h / 2)
    };
}

/**
 * 标准化并预计算 CommandContext
 * 确保空间物理轨与逻辑数据轨 100% 具备确定性值。
 */
export function normalizeCommandContext(rawContext?: Partial<CommandContext> | null): CommandContext {
    const context: CommandContext = {
        blockEl: rawContext?.blockEl ?? (typeof document !== "undefined" ? document.body : null),
        protyleEl: rawContext?.protyleEl ?? null,
        triggerEl: rawContext?.triggerEl ?? null,
        supertag: rawContext?.supertag,
        executionMode: rawContext?.executionMode ?? "foreground",
        vars: rawContext?.vars ?? {},
        actualCommandId: rawContext?.actualCommandId,
        ...rawContext
    };

    if (!context.vars) {
        context.vars = {};
    }

    // 自动预先计算标准空间物理坐标 (geometry)
    const el = context.triggerEl || context.blockEl;
    if (el && typeof el.getBoundingClientRect === "function") {
        try {
            const rect = el.getBoundingClientRect();
            // 如果元素存在且在视口中有尺寸
            if (rect.width > 0 || rect.height > 0 || rect.left > 0 || rect.top > 0) {
                context.geometry = {
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    centerX: Math.round(rect.left + rect.width / 2),
                    centerY: Math.round(rect.top + rect.height / 2)
                };
            } else {
                context.geometry = getDefaultGeometry();
            }
        } catch (_) {
            context.geometry = getDefaultGeometry();
        }
    } else {
        context.geometry = getDefaultGeometry();
    }

    return context;
}
