import { post } from "../../../shared/api-client/request";
import { showMessage } from "siyuan";
import type { CommandContext } from "../command-dispatcher";
import { SupertagRenderer } from "../supertag/SupertagRenderer";

export async function triggerTurnIntoTask(
    params: Record<string, unknown>,
    context: CommandContext
): Promise<any> {
    const blockEl = context.blockEl;
    if (!blockEl) {
        showMessage("❌ 转换为任务失败：未提供有效的目标块", 5000, "error");
        return { success: false };
    }

    const blockId = blockEl.getAttribute("data-node-id");
    if (!blockId) {
        showMessage("❌ 转换为任务失败：无法获取块 ID", 5000, "error");
        return { success: false };
    }

    console.log(`[TurnIntoTask] Converting block ${blockId} to virtual task`);

    try {
        // 1. 设置思源后台块属性
        await post("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs: {
                "custom-is-task": "true",
                "custom-task-status": "pending"
            }
        });

        // 2. 实时更新 DOM 上的属性以触发渲染
        blockEl.setAttribute("custom-is-task", "true");
        blockEl.setAttribute("custom-task-status", "pending");

        // 3. 强制触发重新渲染
        const protyle = (context as any).protyle || (window as any).siyuan?.ws?.protyle || null;
        if (protyle) {
            SupertagRenderer.render(protyle);
        } else {
            // 如果是在其他编辑器上下文中，尝试找到编辑器容器重新渲染
            const editorEl = document.querySelector(".protyle-wysiwyg") as HTMLElement;
            if (editorEl) {
                // @ts-ignore
                SupertagRenderer.renderBlockTags(editorEl);
            }
        }

        showMessage("✨ 已成功转换为虚拟任务块");
        return { success: true, value: true };
    } catch (err: any) {
        console.error("[TurnIntoTask] Fallback execution error:", err);
        showMessage(`❌ 转换出错: ${err.message}`, 5000, "error");
        return { success: false, detail: err.message };
    }
}
