import { dispatchCommand } from "../command-dispatcher";
import { showMessage, Dialog } from "siyuan";

function getButtonCSS() {
    return `
        span[data-type~="a"][data-href^="siyuan-btn://"] {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 2px 8px; 
            margin: 0 4px;
            border: 1px solid var(--b3-border-color, #d1d5db); 
            background-color: var(--b3-theme-background-light, #ffffff); 
            border-radius: 5px; 
            cursor: pointer; 
            font-size: 1em; 
            line-height: inherit;
            color: var(--b3-theme-on-background, #374151);
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            transition: all 0.2s;
            vertical-align: middle;
            user-select: none;
            text-decoration: none;
        }
        span[data-type~="a"][data-href^="siyuan-btn://"]:hover {
            background-color: var(--b3-theme-hover, #f3f4f6);
            border-color: var(--b3-border-color-hover, #9ca3af);
        }
    `;
}

function injectButtonCSS() {
    if (!document.getElementById("siyuan-plugin-btn-css")) {
        const style = document.createElement("style");
        style.id = "siyuan-plugin-btn-css";
        style.innerHTML = getButtonCSS();
        document.head.appendChild(style);
    }
}

export interface InlineButtonCmd {
    id: string;
    label: string;
    commandId: string;
    commandParam: string;
    commandType: string;
}

let availableInlineCommands: InlineButtonCmd[] = [];

export function updateInlineButtonList(buttonCmds: InlineButtonCmd[]) {
    availableInlineCommands = buttonCmds;
}

export function getInlineButtonSlashCommand() {
    return {
        filter: ["btn", "button", "按钮"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">插入智能按钮 (基础配置块)</span><span class="b3-list-item__meta">插件</span></div>`,
        id: "insertSmartButton",
        callback: (protyle: any) => {
            if (typeof protyle.insert === 'function') {
                protyle.insert("");
            }

            const configObj = { commandId: "sys.configure", commandType: "System", param: "" };
            const encodedConfig = btoa(encodeURIComponent(JSON.stringify(configObj)));
            const btnHref = `siyuan-btn://${encodedConfig}`;
            const btnText = `⚙️ 配置智能按钮`;

            const inlineDOM = `<span data-type="a" data-href="${btnHref}">${btnText}</span>&#8203;`;

            const selection = window.getSelection();
            let savedRange: Range | null = null;
            if (selection && selection.rangeCount > 0) {
                savedRange = selection.getRangeAt(0).cloneRange();
            }

            setTimeout(() => {
                try {
                    if (savedRange && selection) {
                        selection.removeAllRanges();
                        selection.addRange(savedRange);
                        if (!selection.isCollapsed) document.execCommand('delete');
                    }
                    if (typeof protyle.insert === 'function') protyle.insert(inlineDOM, false);
                    else document.execCommand("insertHTML", false, inlineDOM);
                } catch (e) {
                    console.error("[InlineButton] Insert failed:", e);
                }
            }, 50);
        }
    };
}

/**
 * Handle clicks on inline smart buttons anywhere in the window
 */
export function handleInlineButtonClick(event: MouseEvent) {
    const path = event.composedPath();
    const linkEl = path.find((element: any) =>
        element instanceof HTMLElement &&
        element.tagName === "SPAN" &&
        element.getAttribute("data-type")?.includes("a") &&
        element.getAttribute("data-href")?.startsWith("siyuan-btn://")
    ) as HTMLElement;

    if (!linkEl) return;

    event.stopPropagation();
    event.preventDefault();

    try {
        const href = linkEl.getAttribute("data-href")!;
        const payload = href.substring("siyuan-btn://".length);
        const configStr = decodeURIComponent(atob(payload));
        const config = JSON.parse(configStr);

        console.log(`[InlineButton] Executing link command: `, config);

        if (config.commandId === "sys.configure") {
            const range = document.createRange();
            range.selectNode(linkEl);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }

            openButtonConfigurationDialog(range);
            return;
        }

        if (config.commandId) {
            const mockContext = { blockEl: linkEl.closest('[data-node-id]') || document.body, protyleEl: null };
            dispatchCommand(config.commandId, config.param, mockContext as any);
        } else {
            showMessage(`未知功能配置`, -1, "error");
        }
    } catch (e) {
        console.error("[InlineButton] Error executing link button:", e);
    }
}

function openButtonConfigurationDialog(targetRange: Range) {
    let optionsHtml = availableInlineCommands.map(cmd =>
        `<option value="${cmd.id}">${cmd.label} (${cmd.commandId})</option>`
    ).join("");

    if (!optionsHtml) {
        optionsHtml = `<option value="">没有启用的内联按钮，请前往 Command-DB 勾选</option>`;
    }

    const dialog = new Dialog({
        title: "配置智能按钮",
        content: `
            <div class="b3-dialog__content">
                <div class="fn__flex b3-label">
                    <div class="fn__flex-1">
                        选择要绑定的功能菜单：
                        <div class="b3-label__text">该选项列表来源于 Command-DB 勾选的 Inline Button</div>
                    </div>
                    <select class="b3-select" id="btn-action-select" style="width: 200px;">
                        ${optionsHtml}
                    </select>
                </div>
                <div class="fn__flex b3-label">
                    <div class="fn__flex-1">
                        定制按钮显示名称（选填）:
                    </div>
                    <input class="b3-text-field" id="btn-custom-label" style="width: 200px;" placeholder="覆盖默认名称">
                </div>
                <div class="fn__flex b3-label">
                    <div class="fn__flex-1">
                        附加运行参数（选填）:
                    </div>
                    <input class="b3-text-field" id="btn-custom-param" style="width: 200px;" placeholder="选填参数">
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel">取消</button>
                <button class="b3-button b3-button--text" id="btn-config-confirm">确认绑定</button>
            </div>
        `,
        width: "520px"
    });

    const confirmBtn = dialog.element.querySelector("#btn-config-confirm");
    if (!confirmBtn) return;

    confirmBtn.addEventListener("click", () => {
        const selectEl = dialog.element.querySelector("#btn-action-select") as HTMLSelectElement;
        const customLabelEl = dialog.element.querySelector("#btn-custom-label") as HTMLInputElement;
        const customParamEl = dialog.element.querySelector("#btn-custom-param") as HTMLInputElement;

        const selectedId = selectEl.value;
        const targetCmd = availableInlineCommands.find(c => c.id === selectedId);

        if (!targetCmd) {
            showMessage("请先选择一个功能关联", -1, "error");
            return;
        }

        const finalLabel = customLabelEl.value.trim() || targetCmd.label;
        const finalParam = customParamEl.value.trim() || targetCmd.commandParam;

        const configObj = { commandId: targetCmd.commandId, commandType: targetCmd.commandType, param: finalParam };
        const encodedConfig = btoa(encodeURIComponent(JSON.stringify(configObj)));
        const btnHref = `siyuan-btn://${encodedConfig}`;

        const inlineDOM = `<span data-type="a" data-href="${btnHref}">${finalLabel}</span>&#8203;`;

        // Restore precisely the range covering the old button and overwrite it
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(targetRange);
            document.execCommand("insertHTML", false, inlineDOM);
        }

        dialog.destroy();
    });

    dialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => {
        dialog.destroy();
    });
}

let listenerAttached = false;

export function initInlineButtonListener() {
    injectButtonCSS();
    if (!listenerAttached) {
        // Must use capture:true to intercept link clicks before SiYuan native handling does
        window.addEventListener("click", handleInlineButtonClick, true);
        listenerAttached = true;
        console.log("[InlineButton] Global click listener attached.");
    }
}

export function destroyInlineButtonListener() {
    if (listenerAttached) {
        window.removeEventListener("click", handleInlineButtonClick, true);
        listenerAttached = false;
        console.log("[InlineButton] Global click listener removed.");
    }
}
