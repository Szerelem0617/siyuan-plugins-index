/**
 * dispatcher/types.ts
 *
 * IndexOS 标准双轨上下文 (Dual-Track Context) 与调度结果定义
 */

import type { ExecutionMode } from "../utils/constraint-checker";
export type { ExecutionMode };

/** 空间物理几何尺寸与中心坐标 */
export interface ContextGeometry {
    /** 元素左上角 X (屏幕物理像素) */
    x: number;
    /** 元素左上角 Y (屏幕物理像素) */
    y: number;
    /** 元素宽度 */
    width: number;
    /** 元素高度 */
    height: number;
    /** 元素几何中心 X (特效发射原点) */
    centerX: number;
    /** 元素几何中心 Y (特效发射原点) */
    centerY: number;
}

/**
 * 统一调度上下文 (CommandContext)
 * 采用双轨架构：
 * 1. 空间物理轨 (Spatial Track)：用于 UI 渲染、特效定位、弹窗锚点
 * 2. 逻辑数据轨 (Logical Track)：用于数据流转、属性读写、Pipeline 变量传递
 */
export interface CommandContext {
    // ── 空间物理轨 (Spatial Track) ──────────────────────────────
    /** 触发命令的源 DOM（如内联按钮、菜单项） */
    triggerEl?: HTMLElement | null;
    /** 目标块所在的 DOM 元素 */
    blockEl?: HTMLElement | null;
    /** 思源编辑器容器 DOM */
    protyleEl?: HTMLElement | null;
    /** 调度器自动预计算好的几何空间对象（视效/UI 命令唯一几何输入源） */
    geometry?: ContextGeometry;

    // ── 逻辑数据轨 (Logical Track) ──────────────────────────────
    /** 目标块 ID */
    blockId?: string;
    /** 当前关联的 Supertag（如 task, pipeline） */
    supertag?: string;
    /** 执行环境模式：前台 UI (foreground) 或 后台静默 (background) */
    executionMode?: ExecutionMode;
    /** Pipeline 与多步执行中的动态变量池 */
    vars?: Record<string, unknown>;
    /** 执行会话内 Prompt 缓存（避免相同提示词重复弹窗） */
    promptCache?: Map<string, string>;

    // ── 内部派发元数据 ──────────────────────────────────────────
    /** 实际触发的派生命令 ID（如带有 -1, -2 的分身命令） */
    actualCommandId?: string;
    /** 当前解析的目标属性名（用于状态轮转等上下文） */
    _currentAttrName?: string;
    
    [key: string]: unknown;
}

/** 参数来源集合 */
export interface ParamSources {
    manual?: Record<string, unknown>;
    auto?: Record<string, unknown>;
    commandDb?: string | Record<string, unknown> | null;
    sources?: Record<string, unknown>;
}

/** 标准调度执行结果 */
export interface DispatchResult {
    success: boolean;
    method: string;
    detail?: string;
    value?: unknown;
    id?: string;
    outputs?: Record<string, unknown>;
}
