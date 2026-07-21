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

    console.log(`[TurnIntoTask] Converting block ${blockId} to virtual task. Live DOM element found: ${Boolean(liveBlockEl)}`);

    try {
        // 1. 设置思源后台块属性 (持久化)
        await post("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs: {
                "custom-index-task": "pending"
            }
        });

        // 2. 实时更新 DOM 节点上的属性
        liveBlockEl.setAttribute("custom-index-task", "pending");
        if (rawBlockEl !== liveBlockEl) {
            rawBlockEl.setAttribute("custom-index-task", "pending");
        }

        // 3. 立刻对该目标块做无刷新 DOM 渲染
        SupertagRenderer.renderSingleBlockElement(liveBlockEl);

        // 4. 触发全局/编辑器渲染
        const protyle = (context as any).protyle || (window as any).siyuan?.ws?.protyle || null;
        if (protyle) {
            SupertagRenderer.render(protyle);
        } else {
            const editorEl = document.querySelector(".protyle-wysiwyg") as HTMLElement;
            if (editorEl) {
                // @ts-ignore
                SupertagRenderer.renderBlockTags(editorEl);
            }
        }

        showMessage("✨ 已成功转换为虚拟任务块");
        return { success: true, value: true };
    } catch (err: any) {
        console.error("[TurnIntoTask] Execution error:", err);
        showMessage(`❌ 转换出错: ${err.message}`, 5000, "error");
        return { success: false, detail: err.message };
    }
}
