/**
 * constraint-checker.ts
 * 命令约束与前后台执行上下文检查器 (Command Constraint & Execution Mode Evaluator)
 *
 * 统一管理与评估命令在 前台 (foreground) / 后台 (background) 模式下的运行契约与限制。
 */

import type { CommandDef } from "../registry/command-registry";

export type ExecutionMode = "foreground" | "background";

export interface ConstraintCheckResult {
    /** 是否允许派发执行该命令 */
    allowed: boolean;
    /** 若不允许或建议跳过时的日志/提示原因 */
    reason?: string;
    /** 在后台模式下是否应当对 {{prompt}} 交互参走静默回退（不弹窗） */
    usePromptFallback?: boolean;
}

/**
 * 评估命令在特定上下文模式（前台/后台）下的可执行状态与约束行为
 */
export function evaluateCommandConstraints(
    def: CommandDef,
    mode: ExecutionMode = "foreground",
    resolvedParams?: Record<string, unknown>
): ConstraintCheckResult {
    const constraints = def.constraints || {};
    const envConstraint = constraints.environment || "universal";

    // 1. 检查运行环境限制 (environment: "foreground" | "background" | "universal")
    if (mode === "background" && envConstraint === "foreground") {
        return {
            allowed: false,
            reason: `命令 "${def.name}" (${def.id}) 限制仅能在前台 UI 环境运行，后台静默触发时已自动跳过`
        };
    }

    // 2. 检查前台 DOM / 编辑器焦点依赖
    if (mode === "background" && constraints.requiresFocus) {
        return {
            allowed: false,
            reason: `命令 "${def.name}" (${def.id}) 依赖前台编辑器焦点，后台模式下已自动跳过`
        };
    }

    // 3. 后台模式下且无显式传参时，对交互参 (prompt) 开启静默回退模式
    if (mode === "background") {
        return {
            allowed: true,
            usePromptFallback: true
        };
    }

    return {
        allowed: true,
        usePromptFallback: false
    };
}
