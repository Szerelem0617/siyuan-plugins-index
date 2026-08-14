/**
 * open-target.ts
 * 多态 "打开" 命令执行器 (Target Scope: "any")
 *
 * 功能：
 * - 目标为文档页面 ID ➔ 在新页签中打开该文档；
 * - 目标为普通内容块 ID ➔ 在新页签中打开包含该块的文档，并平滑滚动高亮/聚焦到该块的位置。
 */

import { openTab } from "siyuan";
import { plugin } from "../../../shared/utils";
import type { CommandContext } from "../dispatcher";

export async function handleOpenTargetCommand(
    params: Record<string, unknown>,
    context?: CommandContext
) {
    let targetId = String(params.id || "").trim();

    // 自动捕获：未传 id 参数时，从当前上下文 DOM 节点抓取 ID
    if (!targetId && context.blockEl) {
        targetId = context.blockEl.getAttribute("data-node-id")
            || context.blockEl.getAttribute("data-id")
            || "";
    }

    if (!targetId) {
        console.warn("[Command:Open] 未能从参数或上下文获取有效的目标 ID");
        return { success: false, detail: "Missing target ID" };
    }

    const shouldHl = params.highlight !== false && params.highlight !== "false" && params.highlight !== 0;

    try {
        openTab({
            app: plugin.app,
            doc: {
                id: targetId,
                action: shouldHl ? ["cb-get-focus", "cb-get-hl"] : ["cb-get-focus"]
            }
        });
        return { success: true, detail: `Opened target ${targetId}` };
    } catch (err: any) {
        console.error("[Command:Open] 唤起 openTab 失败:", err);
        return { success: false, detail: String(err) };
    }
}
