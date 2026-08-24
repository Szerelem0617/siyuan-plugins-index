/**
 * inspector-controller.ts
 *
 * 统一属性工作台控制器：管理弹窗生命周期与入口调用
 */

import { Dialog } from "siyuan";
import UnifiedAttributeInspectorDialog from "./UnifiedAttributeInspectorDialog.svelte";

export function openUnifiedAttributeInspector(blockId: string, protyle?: any) {
    if (!blockId) return;

    const dialog = new Dialog({
        title: "🏷️ IndexOS 统一属性工作台",
        content: `<div id="indexos-attribute-inspector-container" style="height: 100%; min-height: 480px;"></div>`,
        width: "560px",
        height: "620px",
        destroyCallback: () => {
            // 弹窗关闭后，若传入了 protyle 实例，可触发小幅度视口微调
        }
    });

    dialog.element.classList.add("indexos-dialog");

    new UnifiedAttributeInspectorDialog({
        target: dialog.element.querySelector("#indexos-attribute-inspector-container") as HTMLElement,
        props: {
            blockId,
            dialog,
            protyle
        }
    });
}
