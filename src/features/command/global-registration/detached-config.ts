import { Dialog, showMessage } from "siyuan";
import { commandRegistry } from "../registry/command-registry";
import { decodeBtnHref, encodeBtnHref } from "./inline-button";
import ParamConfigDialog from "../av-interaction/dialogs/ParamConfigDialog.svelte";

export function configureDetachedCommand(linkEl: HTMLElement) {
    const href = linkEl.getAttribute("data-href");
    if (!href) return;

    const payload = decodeBtnHref(href);
    if (!payload) {
        showMessage("无法解析按钮链接", -1, "error");
        return;
    }

    const cmdDef = commandRegistry.findByNameOrId(payload.command);
    if (!cmdDef) {
        showMessage(`未找到命令 "${payload.command}"`, -1, "error");
        return;
    }

    const paramsSchema = cmdDef.params || [];
    if (paramsSchema.length === 0) {
        showMessage(`命令 "${cmdDef.name || payload.command}" 不支持参数配置`);
        return;
    }

    let currentParams = {};
    if (payload.param) {
        try {
            currentParams = JSON.parse(payload.param);
        } catch (_) {
            currentParams = {};
        }
    } else if (cmdDef.seed?.paramMapping) {
        try {
            currentParams = JSON.parse(cmdDef.seed.paramMapping);
        } catch (_) {
            currentParams = {};
        }
    }

    const dialog = new Dialog({
        title: "配置命令参数 (Detached)",
        content: `<div class="b3-dialog__content" id="detached-param-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
        width: "480px",
        height: "500px"
    });

    new ParamConfigDialog({
        target: dialog.element.querySelector("#detached-param-config-container")!,
        props: {
            dialog,
            commandName: cmdDef.name || payload.command,
            commandId: cmdDef.id,
            paramsSchema,
            currentParams,
            onSave: async (updated: Record<string, any>) => {
                // Generate new href with parameters
                const newHref = encodeBtnHref({
                    command: cmdDef.id,
                    param: JSON.stringify(updated)
                });
                
                // Replace the element in the editor to ensure Siyuan saves the changes properly
                const range = document.createRange();
                range.selectNode(linkEl);
                const selection = window.getSelection();
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                    
                    const labelText = linkEl.textContent || cmdDef.name;
                    const newInlineDOM = `<span data-type="a" data-href="${newHref}">${labelText}</span>&#8203;`;
                    document.execCommand("insertHTML", false, newInlineDOM);
                    showMessage("已成功更新并保存脱钩(Detached)命令参数");
                } else {
                    showMessage("更新失败：未找到编辑器焦点", -1, "error");
                }
            }
        }
    });
}
