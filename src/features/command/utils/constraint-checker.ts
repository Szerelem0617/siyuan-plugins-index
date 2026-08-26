/**
 * constraint-checker.ts
 * 命令约束与前后台执行上下文检查器 (Command Constraint & Execution Scope Evaluator)
 *
 * 统一评估命令在 前台 (foreground) / 后台 (background) 运行契约，
 * 以及目标节点作用域 targetScope ("none" | "block" | "doc" | "any") 的匹配状态。
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
 * 评估命令在特定上下文模式（前台/后台）下的可执行状态与 targetScope 作用域约束
 */
export function evaluateCommandConstraints(
    def: CommandDef,
    mode: ExecutionMode = "foreground",
    targetNodeType?: string
): ConstraintCheckResult {
    const envConstraint = def.constraints?.environment || "universal";
    const targetScope = def.constraints?.targetScope || "any";

    // 1. 检查运行环境限制 (environment: "ui" | "universal")
    // "ui" 仅限前台 UI 环境运行，后台静默触发时自动跳过；
    // "universal" 为前后台双端通用，任何场景均可放心触发。
    if (mode === "background" && envConstraint === "ui") {
        return {
            allowed: false,
            reason: `命令 "${def.name}" (${def.id}) 限制仅能在前端 UI 环境运行，后台静默触发时已自动跳过`
        };
    }

    // 2. 检查目标节点作用域匹配 (targetScope: "none" | "block" | "doc" | "any")
    if (targetNodeType) {
        const isDocNode = targetNodeType === "d";
        if (targetScope === "doc" && !isDocNode) {
            return {
                allowed: false,
                reason: `命令 "${def.name}" (${def.id}) 限制仅适用于文档页面 (doc)，当前目标块为普通内容块`
            };
        }
        if (targetScope === "block" && isDocNode) {
            return {
                allowed: false,
                reason: `命令 "${def.name}" (${def.id}) 限制仅适用于普通内容块 (block)，当前目标为文档页面`
            };
        }
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
