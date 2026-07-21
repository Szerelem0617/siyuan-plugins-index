import { post } from "../../../shared/api-client/request";
import { showMessage } from "siyuan";
import type { CommandContext } from "../command-dispatcher";
import { SupertagRenderer } from "../supertag/SupertagRenderer";

export async function triggerTurnIntoTask(
    params: Record<string, unknown>,
    context: CommandContext
): Promise<any> {
    const rawBlockEl = context.blockEl;
    if (!rawBlockEl) {
        showMessage("❌ 转换为任务失败：未提供有效的目标块", 5000, "error");
        return { success: false };
    }

    const blockId = rawBlockEl.getAttribute("data-node-id");
    if (!blockId) {
        showMessage("❌ 转换为任务失败：无法获取块 ID", 5000, "error");
        return { success: false };
    }

    // 查找当前 DOM 中真实的块节点 (包含全局 DOM 查找降级)
    const liveBlockEl = (document.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement) || rawBlockEl;

    const currentTaskAttr = liveBlockEl.getAttribute("custom-index-task") || rawBlockEl.getAttribute("custom-index-task");
    const isAlreadyTask = Boolean(currentTaskAttr);

    console.log(`[TurnIntoTask] Toggling task state for block ${blockId}. Currently task: ${isAlreadyTask}`);

    try {
        if (isAlreadyTask) {
            // 取消任务状态
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-index-task": ""
                }
            });

            liveBlockEl.removeAttribute("custom-index-task");
            if (rawBlockEl !== liveBlockEl) {
                rawBlockEl.removeAttribute("custom-index-task");
            }

            SupertagRenderer.renderSingleBlockElement(liveBlockEl);
            showMessage("✨ 已取消虚拟任务状态");
            return { success: true, isTask: false };
        } else {
            // 转换为任务状态
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-index-task": "pending"
                }
            });

            liveBlockEl.setAttribute("custom-index-task", "pending");
            if (rawBlockEl !== liveBlockEl) {
                rawBlockEl.setAttribute("custom-index-task", "pending");
            }

            SupertagRenderer.renderSingleBlockElement(liveBlockEl);
            showMessage("✨ 已成功转换为虚拟任务块");
            return { success: true, isTask: true };
        }
    } catch (err: any) {
        console.error("[TurnIntoTask] Execution error:", err);
        showMessage(`❌ 转换出错: ${err.message}`, 5000, "error");
        return { success: false, detail: err.message };
    }
}
