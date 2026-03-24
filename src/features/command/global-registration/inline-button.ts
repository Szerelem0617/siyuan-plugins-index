import { dispatchCommand } from "../command-dispatcher";
import { showMessage } from "siyuan";

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

export function getInlineButtonSlashCommand() {
    return {
        filter: ["btn", "button", "按钮"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">插入智能按钮 (全局关系图 Demo)</span><span class="b3-list-item__meta">插件</span></div>`,
        id: "insertSmartButton",
        callback: (protyle: any) => {
            // First, clear the slash command string (e.g., "/btn")
            if (typeof protyle.insert === 'function') {
                protyle.insert("");
            }

            const configObj = { commandId: "general.graphView", commandType: "Native", param: "" };
            const encodedConfig = btoa(encodeURIComponent(JSON.stringify(configObj)));
            const btnHref = `siyuan-btn://${encodedConfig}`;
            const btnText = `🌐 打开全局关系图`;

            // Inserting a native SiYuan Link element with our custom protocol! 
            // This natively survives Lute serialization in SiYuan 3.5.x perfectly.
            const inlineDOM = `<span data-type="a" data-href="${btnHref}">${btnText}</span>&#8203;`;

            // Fetch the selection before we lose focus
            const selection = window.getSelection();
            let savedRange: Range | null = null;
            if (selection && selection.rangeCount > 0) {
                savedRange = selection.getRangeAt(0).cloneRange();
            }

            // Defer execution slightly to mimic the Dialog behavior and let Slash menu close
            setTimeout(() => {
                try {
                    if (savedRange && selection) {
                        selection.removeAllRanges();
                        selection.addRange(savedRange);
                        if (!selection.isCollapsed) {
                            document.execCommand('delete');
                        }
                    }

                    if (typeof protyle.insert === 'function') {
                        protyle.insert(inlineDOM, false);
                    } else {
                        document.execCommand("insertHTML", false, inlineDOM);
                    }
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

        if (config.commandId) {
            const mockContext = { blockEl: document.body, protyleEl: null };
            dispatchCommand(config.commandId, config.param, mockContext as any);
        } else {
            showMessage(`未知功能配置`, -1, "error");
        }
    } catch (e) {
        console.error("[InlineButton] Error executing link button:", e);
    }
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
