/**
 * prompt-modal.ts
 * 交互式实时弹窗输入框 (JIT Prompt Modal)
 *
 * 当 Pipeline/命令执行到含有 {{prompt}} 或 {{prompt:提示文案}} 时挂起并弹出模态框，
 * 等待用户输入后解封 Promise 并返回输入值。
 */

import { Dialog } from "siyuan";

export function promptUserModal(title = "请输入参数内容", defaultValue = ""): Promise<string | null> {
    return new Promise((resolve) => {
        let isResolved = false;

        const dialog = new Dialog({
            title: `💬 交互式输入`,
            content: `
                <div class="b3-dialog__content" style="padding: 16px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;">
                    <div style="font-size: 13px; font-weight: 600; color: var(--b3-theme-on-background); line-height: 1.4;">
                        ${title}
                    </div>
                    <input 
                        type="text" 
                        id="indexos-prompt-input" 
                        class="b3-text-field fn__block" 
                        style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 6px 10px;" 
                        placeholder="请输入内容..." 
                        value="${defaultValue.replace(/"/g, '&quot;')}"
                    />
                    <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;">
                        <button id="indexos-prompt-cancel" class="b3-button b3-button--cancel" style="font-size: 12px; padding: 4px 12px;">取消</button>
                        <button id="indexos-prompt-confirm" class="b3-button b3-button--text" style="font-size: 12px; padding: 4px 12px;">确定</button>
                    </div>
                </div>
            `,
            width: "420px",
            destroyCallback: () => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(null);
                }
            }
        });

        const container = dialog.element;
        const inputEl = container.querySelector("#indexos-prompt-input") as HTMLInputElement;
        const confirmBtn = container.querySelector("#indexos-prompt-confirm") as HTMLButtonElement;
        const cancelBtn = container.querySelector("#indexos-prompt-cancel") as HTMLButtonElement;

        if (inputEl) {
            setTimeout(() => {
                inputEl.focus();
                inputEl.select();
            }, 50);

            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    doConfirm();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    doCancel();
                }
            });
        }

        function doConfirm() {
            if (!isResolved) {
                isResolved = true;
                const val = inputEl ? inputEl.value : "";
                dialog.destroy();
                resolve(val);
            }
        }

        function doCancel() {
            if (!isResolved) {
                isResolved = true;
                dialog.destroy();
                resolve(null);
            }
        }

        if (confirmBtn) confirmBtn.addEventListener("click", doConfirm);
        if (cancelBtn) cancelBtn.addEventListener("click", doCancel);
    });
}
