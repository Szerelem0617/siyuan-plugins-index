/**
 * open-target.ts
 * 多态 "打开中枢" 命令执行器 (index.openTarget)
 *
 * 功能：
 * 1. 系统视图分流：
 *    - target === 'graph' ➔ 唤起全局关系图 (globalCommand('graphView'))
 *    - target === 'inbox' ➔ 唤起收集箱 (globalCommand('inbox'))
 * 2. 实体导航分流：
 *    - 页面 ID / 块 ID ➔ 根据 position ('tab' | 'right' | 'bottom') 在普通页签或分屏中打开，并支持高亮/聚焦。
 */

import { openTab, globalCommand } from "siyuan";
import { plugin } from "../../../shared/utils";
import type { CommandContext, DispatchResult } from "../command-dispatcher";

export async function handleOpenTargetCommand(
    params: Record<string, unknown>,
    context?: CommandContext
): Promise<DispatchResult> {
    // 兼容 target 与 id 两个参数 key
    let target = String(params.target || params.id || "").trim();

    // 自动捕获：未传 target 参数时，从当前上下文 DOM 节点抓取 ID
    if (!target && context?.blockEl) {
        target = context.blockEl.getAttribute("data-node-id")
            || context.blockEl.getAttribute("data-id")
            || "";
    }

    // 1. 系统全局视图分流
    if (target === "graph" || target === "graphView") {
        try {
            (globalCommand as any)("graphView", plugin?.app);
            return { success: true, method: "custom", detail: "Opened graphView" };
        } catch (e: any) {
            return { success: false, method: "custom", detail: e.message };
        }
    }

    if (target === "inbox") {
        try {
            (globalCommand as any)("inbox", plugin?.app);
            return { success: true, method: "custom", detail: "Opened inbox" };
        } catch (e: any) {
            return { success: false, method: "custom", detail: e.message };
        }
    }

    // 2. 普通块 / 页面实体导航
    if (!target) {
        console.warn("[Command:OpenTarget] 未能从参数或上下文获取有效的目标 ID");
        return { success: false, method: "custom", detail: "Missing target ID" };
    }

    const shouldHl = params.highlight !== false && params.highlight !== "false" && params.highlight !== 0;
    const rawPos = String(params.position || "tab").toLowerCase();
    const position: "right" | "bottom" | undefined = (rawPos === "right" || rawPos === "bottom") ? rawPos : undefined;

    try {
        openTab({
            app: plugin.app,
            doc: {
                id: target,
                action: shouldHl ? ["cb-get-focus", "cb-get-hl"] : ["cb-get-focus"]
            },
            position
        });
        return { success: true, method: "custom", detail: `Opened target ${target}`, id: target };
    } catch (err: any) {
        console.error("[Command:OpenTarget] 唤起 openTab 失败:", err);
        return { success: false, method: "custom", detail: String(err) };
    }
}
