import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { dispatchCommand, focusBlockForDispatch, cleanupAfterDispatch } from "./command-dispatcher";
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
            const itemID = targetEl.getAttribute("custom-av-item-id");

            // 向上溺源：寻找带有 custom-index-linked-av 的祖先块
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
                // 1. 渲染数据库获取列定义和行数据
                const renderRes = await post("/api/av/renderAttributeView", { id: avID });
                const view = renderRes.view || renderRes;
                const rows: any[] = view.rows || [];
                const columns: any[] = view.columns || [];

                if (!columns.length) throw new Error("数据库未包含任何列定义");

                // 2. 定位列索引
                const findCol = (name: string) => columns.findIndex(
                    (c: any) => c.name === name || c.keyName === name
                );
                const cmdColIdx = findCol("Command ID");
                const paramColIdx = findCol("Command Param");

                if (cmdColIdx === -1) throw new Error("未找到 Command ID 列");

                // 3. 定位行
                const row = rows.find((r: any) => r.id === itemID);
                if (!row) throw new Error(`在数据库中未找到该条目（id=${itemID}）`);

                // 4. 提取单元格内容
                const getCellText = (idx: number): string => {
                    if (idx < 0) return "";
                    const cell = row.cells[idx];
                    return cell?.value?.text?.content
                        || cell?.value?.mText?.content
                        || cell?.value?.block?.content
                        || "";
                };

                const commandId = getCellText(cmdColIdx).trim();
                const rawParam = getCellText(paramColIdx).trim();

                if (!commandId) {
                    console.warn("[IndexOS] Command ID 单元格为空，跳过执行");
                    return;
                }

                const protyleEl = targetEl.closest(".protyle-content") as HTMLElement | null;

                // 5. 先关菜单（同步），保证 isOpen 状态被正确重置
                try { (window as any).siyuan?.menus?.menu?.remove(); }
                catch (_) { document.querySelectorAll(".b3-menu").forEach((m: any) => m.remove()); }

                // 6. 延迟：菜单关闭后再设置焦点并派发命令
                console.log(`[IndexOS] 🚀 Dispatching [${commandId}]${rawParam ? ` param=${rawParam}` : ""}`);
                setTimeout(async () => {
                    try {
                        focusBlockForDispatch(targetEl, protyleEl);
                        const result = await dispatchCommand(commandId, rawParam, { blockEl: targetEl, protyleEl });
                        console.log(`[IndexOS] Dispatch result:`, result);
                    } catch (err) {
                        console.error("[IndexOS] Command Execution Failed:", err);
                    } finally {
                        setTimeout(() => cleanupAfterDispatch(), 100);
                    }
                }, 150);

            } catch (e) {
                console.error("[IndexOS] Action Dispatch Error:", e);
            }
        }
    });
}

