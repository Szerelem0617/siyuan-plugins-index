import { constructCommandStorage } from "./construct-dir";
import { i18n, plugin } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { globalCommand } from "siyuan";
import type { Protyle, Menu } from "siyuan";

export const DEV_ENABLE_INIT_SYS = false;

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
            const targetEl = blockElements[0] as HTMLElement;
            const itemID = targetEl.getAttribute("custom-av-item-id");

            // 向上溯源：寻找带有 custom-index-linked-av 的祖先块
            let current: HTMLElement | null = targetEl;
            let avID: string | null = null;
            while (current && current !== document.body) {
                avID = current.getAttribute("custom-index-linked-av");
                if (avID) break;
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
                const protyleEl = targetEl.closest('.protyle-content') as HTMLElement | null;
                const fullCmd = commandText.trim();

                // 先关菜单（同步），保证 isOpen 被正确重置
                try {
                    (window as any).siyuan?.menus?.menu?.remove();
                } catch (_) {
                    document.querySelectorAll(".b3-menu").forEach((m: any) => m.remove());
                }

                // 在菜单完全关闭后再设置焦点并派发命令
                // 这样 contentEl.focus() + addRange() 才能真正落到 contenteditable 里
                console.log(`[IndexOS] 🚀 Dispatching [${fullCmd}]...`);
                setTimeout(() => {
                    try {
                        // 菜单已关闭，现在可以安全地把焦点切到目标块
                        focusBlock(targetEl, protyleEl);
                        console.log(`[IndexOS Debug] After focusBlock — activeElement: ${(document.activeElement as HTMLElement)?.tagName}.${(document.activeElement as HTMLElement)?.className?.split(' ')[0]}, hasSelection: ${window.getSelection()?.rangeCount}`);

                        // 派发命令
                        const result = dispatchSiyuanCommand(fullCmd, targetEl, protyleEl);
                        console.log(`[IndexOS] Command dispatched. Result:`, result);
                    } catch (err) {
                        console.error("[IndexOS] Command Execution Failed:", err);
                    } finally {
                        // 稍后清理，避免在键盘事件处理器还在运行时就清掉 Selection
                        setTimeout(() => cleanupFocusState(), 100);
                    }
                }, 150);

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
 * 将 SiYuan 快捷键字符串（Mac 符号格式）转换为 KeyboardEvent
 *
 * 平台差异（参见 SiYuan 源码 isOnlyMeta）：
 *   - Mac:     ⌘ → metaKey=true,  ctrlKey=false
 *   - Windows: ⌘ → metaKey=false, ctrlKey=true
 * ⌃ 始终映射为 ctrlKey=true（仅 Mac 独有按键）
 */
function hotkeyToKeyboardEvent(hotkey: string): KeyboardEvent | null {
    try {
        const isMacPlatform = navigator.platform.toUpperCase().indexOf("MAC") > -1;

        let ctrlKey = false, shiftKey = false, altKey = false, metaKey = false;
        let keyStr = hotkey;

        // ⌃ 始终是 ctrlKey（Mac 上的 Control 键）
        if (keyStr.includes("⌃")) { ctrlKey = true; keyStr = keyStr.replace("⌃", ""); }

        // ⌘ 在 Mac 上是 metaKey，在 Windows 上是 ctrlKey
        if (keyStr.includes("⌘")) {
            if (isMacPlatform) {
                metaKey = true;
            } else {
                ctrlKey = true;  // Windows: isOnlyMeta() 要求 !metaKey && ctrlKey
            }
            keyStr = keyStr.replace("⌘", "");
        }

        if (keyStr.includes("⇧")) { shiftKey = true; keyStr = keyStr.replace("⇧", ""); }
        if (keyStr.includes("⌥")) { altKey = true; keyStr = keyStr.replace("⌥", ""); }

        const keyMap: Record<string, string> = {
            "↩": "Enter", "⌫": "Backspace", "⌦": "Delete", "⇥": "Tab",
            "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight",
        };
        const key = keyMap[keyStr] || keyStr || "Unidentified";

        // keyCode 供旧版检测路径使用（现代 SiYuan 主要用 key 字段）
        let keyCode = 0;
        if (key.length === 1) keyCode = key.toUpperCase().charCodeAt(0);
        else if (key === "Enter") keyCode = 13;
        else if (key === "Backspace") keyCode = 8;
        else if (key === "Delete") keyCode = 46;
        else if (key === "Tab") keyCode = 9;

        console.log(`[IndexOS Debug] hotkeyToKeyboardEvent: "${hotkey}" → key="${key}" ctrl=${ctrlKey} shift=${shiftKey} alt=${altKey} meta=${metaKey} (${isMacPlatform ? "Mac" : "Win"})`);

        return new KeyboardEvent("keydown", {
            key, ctrlKey, shiftKey, altKey, metaKey,
            bubbles: true, cancelable: true, composed: true,
            keyCode,
        });
    } catch (e) {
        console.warn(`[IndexOS] hotkeyToKeyboardEvent failed for "${hotkey}":`, e);
        return null;
    }
}



/**
 * 让 SiYuan 编辑器的焦点指向目标块，使 KeyboardEvent 可以正确定位到当前块。
 * 此函数应当在菜单完全关闭之后才被调用（在 setTimeout 回调内），
 * 这样 contentEl.focus() 才不会干扰菜单的 isOpen 状态。
 */
function focusBlock(blockEl: HTMLElement, protyleEl: HTMLElement | null = null) {
    if (!blockEl) return;

    // 1. 挂上选中态 class，让思源认为该块被选中
    document.querySelectorAll(".protyle-wysiwyg--select").forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    blockEl.classList.add("protyle-wysiwyg--select");

    // 2. 先 focus wysiwyg container，让浏览器知道焦点在编辑器区域
    const wysiwygEl = (protyleEl?.querySelector('.protyle-wysiwyg')
        || blockEl.closest('.protyle-wysiwyg')) as HTMLElement | null;
    if (wysiwygEl) {
        wysiwygEl.focus({ preventScroll: true });
    }

    // 3. 把光标通过 Selection API 折叠到块开头
    // 此时 contenteditable 的父元素已有焦点，addRange 可以正确生效
    try {
        const contentEl = (blockEl.querySelector('[contenteditable="true"]') || wysiwygEl || blockEl) as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(contentEl);
        range.collapse(true);

        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
    } catch (e) {
        console.warn("[IndexOS] focusBlock: failed to set range", e);
    }
}

