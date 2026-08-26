import { Dialog, showMessage } from "siyuan";
import { commandRegistry } from "../registry/command-registry";
import { decodeBtnHref, encodeBtnHref } from "./inline-button";
import InputConfigDialog from "../av-interaction/dialogs/InputConfigDialog.svelte";

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

    let currentInputParams: Record<string, any> = {};
    if (payload.param) {
        try {
            currentInputParams = JSON.parse(payload.param);
        } catch (_) {
            currentInputParams = { param: payload.param };
        }
    } else {
        for (const p of paramsSchema) {
            if (p.default !== undefined) {
                currentInputParams[p.key] = p.default;
            }
        }
    }

    const dialog = new Dialog({
        title: "配置脱钩按钮独立参数 (Detached)",
        content: `<div class="b3-dialog__content" id="detached-param-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
        width: "520px",
        height: "520px"
    });
    dialog.element.classList.add("indexos-dialog");

    new InputConfigDialog({
        target: dialog.element.querySelector("#detached-param-config-container")!,
        props: {
            dialog,
            commandName: cmdDef.name || payload.command,
            commandId: cmdDef.id,
            paramsSchema,
            currentInputParams,
            onSave: async (updatedInput: Record<string, any>) => {
                // 生成携带最新独立参数的脱钩 url
                const newHref = encodeBtnHref({
                    command: cmdDef.id,
                    param: JSON.stringify(updatedInput)
                });
                
                // 替换编辑器中的 DOM 节点，确保思源自动持久化变更
                const range = document.createRange();
                range.selectNode(linkEl);
                const selection = window.getSelection();
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                    
                    const labelText = linkEl.textContent || cmdDef.name;
                    const newInlineDOM = `<span data-type="a" data-href="${newHref}">${labelText}</span>&#8203;`;
                    document.execCommand("insertHTML", false, newInlineDOM);
                    showMessage("已成功更新并保存脱钩按钮独立参数 👑");
                } else {
                    linkEl.setAttribute("data-href", newHref);
                    showMessage("已更新底层属性");
                }
            }
        }
    });
}
