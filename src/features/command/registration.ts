import { constructCommandStorage } from "./construct-dir";
import { i18n, plugin } from "../../shared/utils";
import type { Protyle, Menu } from "siyuan";

// 设置为 false 即可在发布时轻易关停此处的入口注册
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

    // 为了更便捷地做跑通测试：
    // 我们在这个菜单里增加一个“▶ 测试执行块内命令”。
    // 您可以在思源的一个 Block 里输入类似 'editor.general.duplicate' 的纯文本，然后右键这个块，点击执行测试。
    menu.addSeparator();
    menu.addItem({
        icon: "iconPlay",
        label: "▶️ (测试) 执行原生命令: 复制块",
        click: () => {
            // 默认测试动作: 复制当前块
            focusBlock(blockElements[0]);
            setTimeout(() => {
                (window as any).siyuan?.globalCommand?.("editor.general.duplicate", plugin.app);
                console.log("[IndexOS Test] Triggered duplicate on block.");
            }, 50);
        }
    });

    menu.addItem({
        icon: "iconPlay",
        label: "▶️ (测试) 将选中块视为 Command ID 并执行",
        click: () => {
            // 读取选择块的纯文本，作为命令 ID 尝试运行
            // 过滤掉不可见字符
            const text = blockElements[0].textContent?.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
            if (text) {
                focusBlock(blockElements[0]);
                console.log(`[IndexOS Test] Trying to execute global command: [${text}]`);
                setTimeout(() => {
                    try {
                        (window as any).siyuan?.globalCommand?.(text, plugin.app);
                        // showMessage(`尝试调度原生指令: ${text}`);
                    } catch (e) {
                        console.error("执行命令失败", e);
                    }
                }, 50);
            }
        }
    });
}

/**
 * 伪造焦点，让 SiYuan 内核认为当前块被选中，从而能正确应用命令
 */
function focusBlock(blockEl: HTMLElement) {
    if (!blockEl) return;

    // 1. 挂上选中态 Class
    document.querySelectorAll(".protyle-wysiwyg--select").forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    blockEl.classList.add("protyle-wysiwyg--select");

    // 2. 将光标折叠进该元素
    try {
        const range = document.createRange();
        range.selectNodeContents(blockEl);
        range.collapse(false); // 光标置于末尾
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    } catch (e) { }
}
