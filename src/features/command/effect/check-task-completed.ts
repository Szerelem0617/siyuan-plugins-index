import { post } from "../../../shared/api-client/request";
import type { CommandContext } from "../command-dispatcher";
import { dispatchCommand } from "../command-dispatcher";

export async function triggerCheckTaskCompleted(
    params: Record<string, unknown>,
    context: CommandContext
): Promise<void> {
    const blockEl = context.blockEl;
    if (!blockEl) return;
    const blockId = blockEl.getAttribute("data-node-id");
    if (!blockId) return;

    // 查询块以确认其是否为已完成的任务列表项
    const res = await post("/api/query/sql", {
        stmt: `SELECT type, subtype, markdown FROM blocks WHERE id = '${blockId}' LIMIT 1`
    });
    if (!res || res.length === 0) return;

    const block = res[0];
    
    // 思源中，块类型 'i' 代表 ListItem，子类型 't' 代表 Task List Item
    const isTask = block.type === "i" && block.subtype === "t";
    if (!isTask) return;

    const markdown = (block.markdown || "").trim();
    const isCompleted = /^[-*+]\s+\[[xX]\]/.test(markdown);
    
    if (isCompleted) {
        console.log(`[CheckTaskCompleted] Task ${blockId} is completed! Firing fireworks.`);
        
        // 1. 触发放烟花特效
        await dispatchCommand("plugin-index.effect.fireworks", "{}", context);
        
        // 2. 触发消息气泡提示
        await dispatchCommand("siyuan.ui.toast", JSON.stringify({
            message: "🎉 恭喜！你完成了一个任务！",
            timeout: 3000
        }), context);
    }
}
