import { post } from "../../../shared/api-client/request";
import { showMessage } from "siyuan";
import type { CommandContext } from "../command-dispatcher";
import { SupertagRenderer } from "../supertag";

export async function triggerTurnIntoTask(
    params: Record<string, unknown>,
    context: CommandContext
): Promise<any> {
    const rawBlockEl = context.blockEl;
    const targetBlockId = (params?.id as string) || (params?.block_id as string) || (context as any).blockId || rawBlockEl?.getAttribute("data-node-id");

    if (!targetBlockId) {
        showMessage("❌ 转换为任务失败：无法获取目标块或页面 ID", 5000, "error");
        return { success: false };
    }

    // 查找当前 DOM 中真实的块节点或页面元素
    const liveBlockEl = (document.querySelector(`[data-node-id="${targetBlockId}"]`) as HTMLElement) || rawBlockEl;
    const editorEl = liveBlockEl ? (liveBlockEl.closest(".protyle") as HTMLElement) : (document.querySelector(".protyle") as HTMLElement);

    // 查询当前块或页面的 custom-index-task 属性
    let currentTaskAttr = liveBlockEl ? liveBlockEl.getAttribute("custom-index-task") : null;
    if (!currentTaskAttr) {
        const attrsRes = await post("/api/attr/getBlockAttrs", { id: targetBlockId });
        currentTaskAttr = attrsRes?.["custom-index-task"] || "";
    }

    const isAlreadyTask = Boolean(currentTaskAttr);

    console.log(`[TurnIntoTask] Toggling task state for target ${targetBlockId}. Currently task: ${isAlreadyTask}`);

    try {
        if (isAlreadyTask) {
            // 取消任务状态
            await post("/api/attr/setBlockAttrs", {
                id: targetBlockId,
                attrs: {
                    "custom-index-task": ""
                }
            });

            if (liveBlockEl) {
                liveBlockEl.removeAttribute("custom-index-task");
            }
            if (rawBlockEl && rawBlockEl !== liveBlockEl) {
                rawBlockEl.removeAttribute("custom-index-task");
            }

            if (liveBlockEl) {
                SupertagRenderer.renderSingleBlockElement(liveBlockEl);
            }
            if (editorEl) {
                const pageDocId = editorEl.querySelector(".protyle-title")?.getAttribute("data-node-id");
                if (pageDocId) {
                    await SupertagRenderer.renderDocumentTags(pageDocId, editorEl);
                }
            }

            showMessage("✨ 已取消虚拟任务状态");
            return { success: true, isTask: false };
        } else {
            // 转换为任务状态
            await post("/api/attr/setBlockAttrs", {
                id: targetBlockId,
                attrs: {
                    "custom-index-task": "pending"
                }
            });

            if (liveBlockEl) {
                liveBlockEl.setAttribute("custom-index-task", "pending");
            }
            if (rawBlockEl && rawBlockEl !== liveBlockEl) {
                rawBlockEl.setAttribute("custom-index-task", "pending");
            }

            if (liveBlockEl) {
                SupertagRenderer.renderSingleBlockElement(liveBlockEl);
            }
            if (editorEl) {
                const pageDocId = editorEl.querySelector(".protyle-title")?.getAttribute("data-node-id");
                if (pageDocId) {
                    await SupertagRenderer.renderDocumentTags(pageDocId, editorEl);
                }
            }

            showMessage("✨ 已成功转换为虚拟任务");
            return { success: true, isTask: true };
        }
    } catch (err: any) {
        console.error("[TurnIntoTask] Execution error:", err);
        showMessage(`❌ 转换出错: ${err.message}`, 5000, "error");
        return { success: false, detail: err.message };
    }
}
