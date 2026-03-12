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
                console.log(`[IndexOS] 🚀 Dispatching [${finalCmd}] (from ${fullCmd})...`);
                setTimeout(() => {
                    try {
                        let result;
                        if (typeof globalCommand === "function") {
                            result = globalCommand(finalCmd, plugin.app);
                        } else {
                            throw new Error("siyuan.globalCommand 导入失败或不可用");
                        }
                        console.log(`[IndexOS] Command dispatched. Return value:`, result);
                        if (result === false) {
                            console.warn(`[IndexOS] Command [${finalCmd}] returned false – command not found or no valid context.`);
                        }
                    } catch (err) {
                        console.error("[IndexOS] Command Execution Failed:", err);
                    }
                }, 250);

            } catch (e) {
                console.error("[IndexOS] Action Dispatch Error:", e);
            }
        }
    });
}

/**
 * 伪造焦点，让 SiYuan 内核认为当前块被选中，从而能正确应用命令
 */
function focusBlock(blockEl: HTMLElement) {
    if (!blockEl) return;

    // 1. 模拟完整鼠标点击链
    ['mousedown', 'mouseup', 'click'].forEach(evtType => {
        const evt = new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window });
        blockEl.dispatchEvent(evt);
    });

    // 2. 挂上选中态 Class
    document.querySelectorAll(".protyle-wysiwyg--select").forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    blockEl.classList.add("protyle-wysiwyg--select");

    // 3. 将光标折叠进该元素
    try {
        const range = document.createRange();
        const contentEl = blockEl.querySelector('[contenteditable="true"]') || blockEl;

        range.selectNodeContents(contentEl);
        range.collapse(true);

        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // 强制 Focus
        if (contentEl instanceof HTMLElement) contentEl.focus();

        console.log(`[IndexOS Debug] Cursor collapsed in: ${blockEl.getAttribute("data-node-id")}`);
    } catch (e) {
        console.warn("[IndexOS Debug] Focus application failed", e);
    }
}
