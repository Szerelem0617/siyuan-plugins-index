/**
 * inspector-controller.ts
 *
 * 统一属性工作台控制器：管理弹窗生命周期与入口调用
 */

import { Dialog } from "siyuan";
import UnifiedAttributeInspectorDialog from "./UnifiedAttributeInspectorDialog.svelte";
import { activeBlockTracker } from "./active-block-tracker";

export function openUnifiedAttributeInspector(blockId: string, protyle?: any) {
    if (!blockId) return;

    const dialog = new Dialog({
        title: "🏷️ IndexOS 统一属性工作台",
        content: `<div id="indexos-attribute-inspector-container" style="height: 100%; min-height: 480px;"></div>`,
        width: "560px",
        height: "620px",
        destroyCallback: () => {
            activeBlockTracker.clearHighlight();
        }
    });

    dialog.element.classList.add("indexos-dialog", "indexos-inspector-dialog");
    dialog.element.querySelector('.b3-dialog__header')?.remove();

    new UnifiedAttributeInspectorDialog({
        target: dialog.element.querySelector("#indexos-attribute-inspector-container") as HTMLElement,
        props: {
            blockId,
            dialog
        }
    });
}
