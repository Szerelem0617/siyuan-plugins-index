import { constructCommandStorage } from "./construct-dir";
import { i18n, plugin } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
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

    menu.addItem({
        icon: "iconRocket",
        label: "🚀 (生产测) 执行数据库绑定的指令",
        click: async () => {
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
                console.log(`[IndexOS] Fetching Command ID from AV [${avID}] for Item [${itemID}]...`);
                // 1. 获取该 AV 的所有列，定位 "Command ID"
                const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID });
                const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
                const cmdKey = currentKeys.find((k: any) => k.name === "Command ID");

                if (!cmdKey) throw new Error("未找到 Command ID 列 (请检查列名是否完全匹配 'Command ID')");

                // 2. 获取该行的内容
                const renderRes = await post("/api/av/renderAttributeView", { id: avID });
                const rows = renderRes.view?.rows || renderRes.rows || [];
                const row = rows.find((r: any) => r.id === itemID);

                if (!row) throw new Error(`在数据库 [${avID}] 中未找到对应行 ID: ${itemID}`);

                const cell = row.cells.find((c: any) => c.keyID === cmdKey.id);

                // 打印完整的 cell 对象结构，帮助锁定到底值在哪里
                console.log("[IndexOS Debug] raw cell object:", JSON.stringify(cell));

                // 极端兼容性提取：尝试所有可能的路径
                const commandText: string =
                    cell?.value?.text?.content ||
                    cell?.value?.mText?.content ||
                    cell?.value?.block?.content ||
                    (cell?.value?.type === "text" ? cell.value.content : "") ||
                    "";

                if (!commandText || commandText.trim() === "") {
                    console.warn("[IndexOS] Command execution skipped: Command ID cell is empty. Full cell data:", cell);
                    return;
                }

                // 3. 执行
                focusBlock(targetEl);
                const finalCmd = commandText.trim();
                console.log(`[IndexOS] 🚀 Triggering: [${finalCmd}] for block [${targetEl.getAttribute("data-node-id")}]`);
                setTimeout(() => {
                    (window as any).siyuan?.globalCommand?.(finalCmd, plugin.app);
                }, 50);

            } catch (e) {
                console.error("[IndexOS] Command Dispatch Error:", e);
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
