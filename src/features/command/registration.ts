import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
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
export async function addCommandTestMenuItem({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;

    const blockElements = detail.blockElements;
    const menu = detail.menu;
    if (!blockElements || blockElements.length === 0 || !menu) return;

    const targetEl = blockElements[0] as HTMLElement;
    const textContent = targetEl.textContent || "";
    const tags = Array.from(textContent.matchAll(/#([^\s#]+)/g)).map(m => "#" + m[1]);

    // 如果没有任何标签，则不额外挂载方法
    if (tags.length === 0) return;

    try {
        // 1. 获取 Type-DB 的 AV ID
        const sql = `SELECT root_id FROM attributes WHERE name = 'custom-index-type-db' LIMIT 1`;
        const existingDocs = await post("/api/query/sql", { stmt: sql });
        if (!existingDocs || existingDocs.length === 0) return;
        const docId = existingDocs[0].root_id;

        const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' LIMIT 1`;
        const listRes = await post("/api/query/sql", { stmt: listSql });
        if (!listRes || listRes.length === 0) return;
        const listId = listRes[0].id;

        const listAttrsRes = await client.getBlockAttrs({ id: listId });
        const avId = (listAttrsRes.data || {})["custom-index-linked-av"];
        if (!avId) return;

        // 2. 获取 Type-DB 里的全部方法映射
        const renderRes = await post("/api/av/renderAttributeView", { id: avId });
        const view = renderRes.view || renderRes;
        const rows: any[] = view.rows || [];
        const columns: any[] = view.columns || [];

        let separatorAdded = false;

        // 3. 遍历当前块的标签，看有没有匹配的方法
        for (const tag of tags) {
            const matchedRows = rows.filter((r: any) => {
                const firstCell = r.cells[0];
                const label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
                return label.includes(tag);
            });

            if (matchedRows.length > 0) {
                if (!separatorAdded) {
                    menu.addSeparator();
                    separatorAdded = true;
                }

                for (const row of matchedRows) {
                    const getCellText = (colName: string): string => {
                        const idx = columns.findIndex((c: any) => c.name === colName || c.keyName === colName);
                        if (idx < 0) return "";
                        const cell = row.cells[idx];
                        return cell?.value?.text?.content || cell?.value?.mText?.content || cell?.value?.block?.content || "";
                    };

                    const methodName = getCellText("Method Name");
                    const commandRef = getCellText("Command Reference");
                    const paramMapping = getCellText("Param Mapping");

                    // 获取 Enable 复选框状态，默认开启
                    const enableColIdx = columns.findIndex((c: any) => c.name === "Enable" || c.keyName === "Enable");
                    let enableStatus = true;
                    if (enableColIdx >= 0) {
                        const cell = row.cells[enableColIdx];
                        if (cell && cell.value && cell.value.checkbox) {
                            enableStatus = cell.value.checkbox.checked;
                        }
                    }

                    if (!enableStatus || !commandRef) continue;

                    menu.addItem({
                        icon: "iconPlay",
                        label: `⚡ (${tag}) ${methodName}`,
                        click: async () => {
                            const protyleEl = targetEl.closest(".protyle-content") as HTMLElement | null;

                            // 关闭右键菜单
                            try { (window as any).siyuan?.menus?.menu?.remove(); }
                            catch (_) { document.querySelectorAll(".b3-menu").forEach((m: any) => m.remove()); }

                            console.log(`[IndexOS] 🚀 Dispatching [${commandRef}] for Supertag [${tag}]`);

                            // 暂时将 Param Mapping 原样透传当做 param（以后这里是组装逻辑）
                            setTimeout(async () => {
                                try {
                                    focusBlockForDispatch(targetEl, protyleEl);
                                    const result = await dispatchCommand(commandRef, paramMapping, { blockEl: targetEl, protyleEl });
                                    console.log(`[IndexOS] Dispatch result:`, result);
                                } catch (err) {
                                    console.error("[IndexOS] Command Execution Failed:", err);
                                } finally {
                                    setTimeout(() => cleanupAfterDispatch(), 100);
                                }
                            }, 150);
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error("[IndexOS] Error fetching Type-DB methods:", e);
    }
}

