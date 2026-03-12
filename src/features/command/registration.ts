import { constructCommandStorage } from "./construct-dir";
import { i18n, plugin } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { globalCommand } from "siyuan";
import type { Protyle, Menu } from "siyuan";

export const DEV_ENABLE_INIT_SYS = true;

/** 
 * 生成用于 Slash (/) 召唤出的初始构建指令选项
 */
export function getInitSystemSlashCommand() {
    if (!DEV_ENABLE_INIT_SYS) return null;

    return {
        filter: ["init system db", "初始化体系", "cshi"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.initSystemDB}</span><span class="b3-list-item__meta"></span></div>`,
        id: "initSystemDB",
        async callback(protyle: Protyle) {
            console.log("[IndexPlugin] Slash initSystemDB");
            protyle.insert("");
            await constructCommandStorage();
        }
    };
}

/**
 * 将初始构建按钮注入到顶栏的右键菜单中
 */
export function appendInitSystemMenu(menu: Menu) {
    if (!DEV_ENABLE_INIT_SYS) return;

    menu.addSeparator();
    menu.addItem({
        icon: "iconDatabase",
        label: i18n.initSystemDB,
        click: async () => {
            await constructCommandStorage();
        }
    });
}

/**
 * 监听块图标点击，注入“执行测试”按钮 (方案 A 测试)
 * 通过 eventBus("click-blockicon") 触发
 */
export function addCommandTestMenuItem({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;

    const blockElements = detail.blockElements;
    const menu = detail.menu;
    if (!blockElements || blockElements.length === 0 || !menu) return;

    menu.addSeparator();

    menu.addItem({
        icon: "iconRocket",
        label: "🚀 (生产测) 执行数据库绑定的指令",
        click: async () => {
            console.log(`[IndexOS Debug] 🚀 Rocket menu item clicked. activeElement: ${(document.activeElement as HTMLElement)?.tagName}.${(document.activeElement as HTMLElement)?.className?.split(' ')[0]}`);
            const targetEl = blockElements[0] as HTMLElement;

            // 打印所有属性辅助调试
            const allAttrs: Record<string, string> = {};
            for (let i = 0; i < targetEl.attributes.length; i++) {
                allAttrs[targetEl.attributes[i].name] = targetEl.attributes[i].value;
            }

            const itemID = targetEl.getAttribute("custom-av-item-id");

            // 调试日志：初次点击的信息
            console.log("[IndexOS Debug] Clicked Block Full Info:", {
                id: targetEl.getAttribute("data-node-id"),
                type: targetEl.getAttribute("data-type"),
                itemID: itemID,
                allAttributes: allAttrs
            });

            // 向上溯源：寻找带有 custom-index-linked-av 的祖先块
            let current: HTMLElement | null = targetEl;
            let avID = null;
            while (current && current !== document.body) {
                avID = current.getAttribute("custom-index-linked-av");
                if (avID) {
                    console.log(`[IndexOS Debug] Found linked avID: ${avID} on block:`, {
                        id: current.getAttribute("data-node-id"),
                        type: current.getAttribute("data-type")
                    });
                    break;
                }
                current = current.parentElement;
            }

            if (!itemID || !avID) {
                console.warn("[IndexOS] Execution failed: Missing Item ID or AV ID link.", { itemID, avID });
                return;
            }

            try {
                console.log(`[IndexOS] Rendering AV [${avID}] to find Item [${itemID}]...`);

                // 1. 直接渲染属性视图，它包含了列定义和行数据
                const renderRes = await post("/api/av/renderAttributeView", { id: avID });
                const view = renderRes.view || renderRes;
                const rows = view.rows || [];
                const columns = view.columns || [];

                if (!columns || columns.length === 0) throw new Error("数据库未包含任何列定义");

                // 2. 定位 "Command ID" 列的索引
                // 注意：在 renderAttributeView 的返回中，列 ID 字段名为 keyID 或 id
                const cmdColIdx = columns.findIndex((col: any) =>
                    (col.name === "Command ID") || (col.keyName === "Command ID")
                );

                if (cmdColIdx === -1) {
                    console.error("[IndexOS Debug] Columns list:", columns.map((c: any) => `${c.name || c.keyName} (${c.keyID || c.id})`));
                    throw new Error("未找到 Command ID 列 (请确保列名完全匹配)");
                }

                const cmdCol = columns[cmdColIdx];
                const cmdKeyID = cmdCol.keyID || cmdCol.id;

                // 3. 寻找行
                const row = rows.find((r: any) => r.id === itemID);
                if (!row) {
                    console.error(`[IndexOS Debug] Row NOT found. itemID: ${itemID}. Available row IDs:`, rows.map((r: any) => r.id));
                    throw new Error(`在数据库中未找到对应条目`);
                }

                // 4. 按索引提取单元格
                const cell = row.cells[cmdColIdx];

                console.log(`[IndexOS Debug] Found Cell at index ${cmdColIdx} for key ${cmdKeyID}:`, JSON.stringify(cell));

                // 极端兼容性提取：尝试所有可能的路径
                const commandText: string =
                    cell?.value?.text?.content ||
                    cell?.value?.mText?.content ||
                    cell?.value?.block?.content ||
                    (cell?.value?.type === "text" ? cell.value.content : "") ||
                    "";

                if (!commandText || commandText.trim() === "") {
                    console.warn("[IndexOS] Command execution skipped: Command ID cell is empty. Full cell data:", JSON.stringify(cell));
                    return;
                }

                // 5. 执行
                const protyleEl = targetEl.closest('.protyle-content');
                focusBlock(targetEl);

                // 思源的 globalCommand() 只接受裸命令名（如 "graphView"、"splitLR"），
                // 不接受 keymap 的点分格式（如 "general.graphView"）。
                // 所以我们把数据库里存的 "general.graphView" 取最后一段即可。
                const fullCmd = commandText.trim();
                const finalCmd = fullCmd.includes(".")
                    ? fullCmd.split(".").pop()!
                    : fullCmd;

                console.log(`[IndexOS Debug] Execution Probe:`, {
                    rawCommand: fullCmd,
                    resolvedCommand: finalCmd,
                    appObject: !!plugin.app,
                    targetBlockID: targetEl.getAttribute("data-node-id"),
                    protyleFound: !!protyleEl
                });

                // 强制关闭上下文菜单，交还焦点给主编辑器
                document.querySelectorAll(".b3-menu").forEach(menu => menu.remove());

                // 强制给文档外层容器重新赋予焦点
                if (protyleEl instanceof HTMLElement) {
                    protyleEl.focus();
                }

                // 给思源内部状态刷新留出时间
                console.log(`[IndexOS] 🚀 Dispatching [${fullCmd}]...`);
                setTimeout(() => {
                    try {
                        const result = dispatchSiyuanCommand(fullCmd, targetEl, protyleEl as HTMLElement | null);
                        console.log(`[IndexOS] Command dispatched. Result:`, result);
                    } catch (err) {
                        console.error("[IndexOS] Command Execution Failed:", err);
                    } finally {
                        // 无论成功失败，都必须清理我们留下的状态，否则下次右键会出现异常
                        console.log("[IndexOS Debug] Cleaning up focus state...");
                        cleanupFocusState();
                    }
                }, 250);

            } catch (e) {
                console.error("[IndexOS] Action Dispatch Error:", e);
            }
        }
    });
}

/**
 * 清理执行命令后留下的临时焦点状态，避免影响后续交互
 */
function cleanupFocusState() {
    try {
        // 移除我们自己加的选中 class
        document.querySelectorAll(".protyle-wysiwyg--select").forEach(el => {
            el.classList.remove("protyle-wysiwyg--select");
        });
        // 清空 Selection，避免范围残留
        window.getSelection()?.removeAllRanges();
        console.log("[IndexOS Debug] Focus state cleaned up.");
    } catch (e) {
        console.warn("[IndexOS Debug] Cleanup failed:", e);
    }
}

/**
 * 核心命令分发器。
 * - 对于编辑器内命令（editor.general.*、editor.list.* 等），
 *   先查出对应的快捷键，再通过模拟 KeyboardEvent 触发 wysiwyg 的 keydown 处理器。
 * - 对于全局命令（general.*），回退到 globalCommand()。
 */
function dispatchSiyuanCommand(
    fullCmd: string,
    blockEl: HTMLElement,
    protyleEl: HTMLElement | null
): string {
    const siyuan = (window as any).siyuan;
    const keymap = siyuan?.config?.keymap;

    // 1. 尝试在 keymap 里查找快捷键（按点分路径走）
    let hotkey: string | null = null;
    if (keymap && fullCmd.includes(".")) {
        const parts = fullCmd.split("."); // e.g. ["editor","list","checkToggle"]
        let node: any = keymap;
        for (const part of parts) {
            node = node?.[part];
            if (!node) break;
        }
        // keymap leaf 节点形如 { default: "⌘↩", custom: "⌘↩" }
        hotkey = node?.custom || node?.default || null;
        console.log(`[IndexOS Debug] Keymap lookup [${fullCmd}] → hotkey: ${hotkey}`);
    }

    // 2. 如果找到快捷键，通过模拟 keydown 事件触发
    if (hotkey) {
        const synthTarget = (protyleEl?.querySelector('.protyle-wysiwyg')
            || blockEl.closest('.protyle-wysiwyg')) as HTMLElement | null;

        if (synthTarget) {
            const keyEvent = hotkeyToKeyboardEvent(hotkey);
            if (keyEvent) {
                console.log(`[IndexOS] Synthesizing KeyboardEvent for [${fullCmd}]: key=${keyEvent.key} ctrl=${keyEvent.ctrlKey} shift=${keyEvent.shiftKey} alt=${keyEvent.altKey} meta=${keyEvent.metaKey}`);
                synthTarget.dispatchEvent(keyEvent);
                return `keyboard:${hotkey}`;
            }
        } else {
            console.warn(`[IndexOS Debug] No wysiwyg element found for keyboard event dispatch.`);
        }
    }

    // 3. 回退：用 SDK 导入的 globalCommand（适用于全局命令，如 splitLR/graphView/inbox）
    const bareCmd = fullCmd.includes(".") ? fullCmd.split(".").pop()! : fullCmd;
    console.log(`[IndexOS Debug] Falling back to globalCommand(${bareCmd})`);
    globalCommand(bareCmd, plugin.app);
    return `global:${bareCmd}`;
}

/**
 * 将 SiYuan 快捷键字符串（Mac 符号格式）转换为 KeyboardEventInit
 * ⌘=Meta/Ctrl, ⇧=Shift, ⌥=Alt, ⌫=Backspace, ⌦=Delete, ↩=Enter, ⇥=Tab
 */
function hotkeyToKeyboardEvent(hotkey: string): KeyboardEvent | null {
    try {
        let ctrlKey = false, shiftKey = false, altKey = false, metaKey = false;
        let keyStr = hotkey;
        if (keyStr.includes("⌘")) { ctrlKey = true; metaKey = true; keyStr = keyStr.replace("⌘", ""); }
        if (keyStr.includes("⇧")) { shiftKey = true; keyStr = keyStr.replace("⇧", ""); }
        if (keyStr.includes("⌥")) { altKey = true; keyStr = keyStr.replace("⌥", ""); }
        const keyMap: Record<string, string> = {
            "↩": "Enter", "⌫": "Backspace", "⌦": "Delete", "⇥": "Tab",
            "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight",
            "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4", "F5": "F5",
        };
        const key = keyMap[keyStr] || keyStr || "Unidentified";
        return new KeyboardEvent("keydown", {
            key, ctrlKey, shiftKey, altKey, metaKey,
            bubbles: true, cancelable: true, composed: true,
            keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
        });
    } catch (e) {
        console.warn(`[IndexOS Debug] hotkeyToKeyboardEvent failed for "${hotkey}":`, e);
        return null;
    }
}


/**
 * 让 SiYuan 编辑器的焦点指向目标块，使命令可以正确获取到"当前块"。
 * 注意：故意不派发 mousedown/mouseup/click 事件，因为它们会冒泡进
 * SiYuan 的 wysiwyg 事件处理器，触发额外的选区和编辑状态变化，
 * 导致后续右键操作异常。只通过 Selection API 设置光标即可。
 */
function focusBlock(blockEl: HTMLElement) {
    if (!blockEl) return;

    console.log(`[IndexOS Debug] focusBlock called on: ${blockEl.getAttribute("data-node-id")}`);

    // 1. 挂上选中态 Class（让思源认为该块处于焦点状态）
    document.querySelectorAll(".protyle-wysiwyg--select").forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    blockEl.classList.add("protyle-wysiwyg--select");

    // 2. 通过 Selection API 把光标折叠到块开头，避免模拟点击
    try {
        const contentEl = blockEl.querySelector('[contenteditable="true"]') || blockEl;

        const range = document.createRange();
        range.selectNodeContents(contentEl);
        range.collapse(true); // 折叠到开头

        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // 注意：故意不调用 contentEl.focus()，因为会把焦点锁定在 contenteditable 元素上，
        // 导致后续对其他块的右键触发 blockicon click 事件时，activeElement 指向错误，菜单无法弹出。
        // 思源的 wysiwyg keydown 处理器通过 getSelection().getRangeAt(0) 来定位块，不需要 focus()。

        console.log(`[IndexOS Debug] Cursor collapsed in: ${blockEl.getAttribute("data-node-id")} | activeElement: ${(document.activeElement as HTMLElement)?.tagName}.${(document.activeElement as HTMLElement)?.className?.split(' ')[0]}`);
    } catch (e) {
        console.warn("[IndexOS Debug] Focus application failed", e);
    }
}
