import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { dispatchCommand, focusBlockForDispatch, cleanupAfterDispatch } from "./command-dispatcher";
import type { Protyle, Menu } from "siyuan";

export const DEV_ENABLE_INIT_SYS = true;

// --- 内存缓存：Supertag 注册表 ---
export interface SupertagCommand {
    typeTag: string;      // 匹配的核心标签 (如 Project)
    methodName: string;   // UI 显示的方法名
    commandRef: string;   // 执行的命令 ID
    paramMapping: string;
    autoSync: boolean;    // 是否在标签添加时自动入库
    targetDbId: string;   // 目标数据库的源块 ID 或内容，用于路由
    typeFieldId?: string; // 目标数据库的分类字段 ID (可选)
    mappedValue?: string; // 映射值 (可选)
}
export let SUPERTAG_REGISTRY: SupertagCommand[] = [];

/**
 * 刷新 Supertag 注册表：从 Type-DB 加载数据到内存
 */
export async function refreshSupertagRegistry() {
    console.log("[Supertag] Refreshing registry from Type-DB...");
    try {
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

        const renderRes = await post("/api/av/renderAttributeView", { id: avId });
        const view = renderRes.view || renderRes;
        const rows: any[] = view.rows || [];
        const columns: any[] = view.columns || [];

        const newRegistry: SupertagCommand[] = [];

        for (const row of rows) {
            const getCellText = (colName: string): string => {
                const idx = columns.findIndex((c: any) => c.name === colName || c.keyName === colName);
                if (idx < 0) return "";
                const cell = row.cells[idx];
                return cell?.value?.text?.content || cell?.value?.mText?.content || cell?.value?.block?.content || "";
            };

            const typeTagRaw = getCellText("Primary Key") || (row.cells[0]?.value?.block?.content) || "";
            const methodName = getCellText("Method Name");
            const commandRef = getCellText("Command Reference");
            const paramMapping = getCellText("Param Mapping");

            // 获取 Enable 复选框状态
            const enableColIdx = columns.findIndex((c: any) => c.name === "Enable" || c.keyName === "Enable");
            let enableStatus = true;
            if (enableColIdx >= 0) {
                const cell = row.cells[enableColIdx];
                if (cell && cell.value && cell.value.checkbox) {
                    enableStatus = cell.value.checkbox.checked;
                }
            }

            // 获取 Auto Sync 复选框状态
            const autoSyncColIdx = columns.findIndex((c: any) => c.name === "Auto Sync" || c.keyName === "Auto Sync");
            let autoSync = false;
            if (autoSyncColIdx >= 0) {
                const cell = row.cells[autoSyncColIdx];
                if (cell && cell.value && cell.value.checkbox) {
                    autoSync = cell.value.checkbox.checked;
                }
            }

            // 获取 Target AV ID (Text，最高优先级)
            let targetDbId = "";
            const targetAvIdIdx = columns.findIndex((c: any) => c.name === "Target AV ID" || c.keyName === "Target AV ID");
            if (targetAvIdIdx >= 0) {
                const cell = row.cells[targetAvIdIdx];
                targetDbId = cell?.value?.text?.content || cell?.value?.mText?.content || "";
            }

            // 获取 Target AV Block ID (Text，备选引用)
            let targetBlockId = "";
            const targetBlockIdIdx = columns.findIndex((c: any) => c.name === "Target AV Block ID" || c.keyName === "Target AV Block ID");
            if (targetBlockIdIdx >= 0) {
                const cell = row.cells[targetBlockIdIdx];
                targetBlockId = cell?.value?.text?.content || cell?.value?.mText?.content || "";
            }

            // 如果 Target AV ID 为空，则尝试用 Block ID
            if (!targetDbId && targetBlockId) {
                targetDbId = targetBlockId;
            }

            // 获取 Type Column ID 和 Type Value (Multi-mode 支持)
            let typeFieldId = "";
            let mappedValue = "";
            const fieldIdx = columns.findIndex((c: any) => c.name === "Type Column ID" || c.keyName === "Type Column ID");
            const valueIdx = columns.findIndex((c: any) => c.name === "Type Value" || c.keyName === "Type Value");
            if (fieldIdx >= 0) typeFieldId = row.cells[fieldIdx]?.value?.text?.content || row.cells[fieldIdx]?.value?.mText?.content || "";
            if (valueIdx >= 0) mappedValue = row.cells[valueIdx]?.value?.text?.content || row.cells[valueIdx]?.value?.mText?.content || "";

            if (enableStatus && typeTagRaw) {
                // 清洗逻辑：移除所有 #，移除转义符，移除不可见字符，移除 | 之后的注释，取小写
                const cleanTag = typeTagRaw.replace(/\\/g, "").replace(/#/g, "").split("|")[0].split("(")[0].trim().toLowerCase();

                newRegistry.push({
                    typeTag: cleanTag,
                    methodName,
                    commandRef,
                    paramMapping,
                    autoSync,
                    targetDbId,
                    typeFieldId: typeFieldId || undefined,
                    mappedValue: mappedValue || undefined
                });
            }
        }
        SUPERTAG_REGISTRY = newRegistry;
        console.log(`[Supertag] Registry refreshed: ${SUPERTAG_REGISTRY.length} types.`, SUPERTAG_REGISTRY);
    } catch (e) {
        console.error("[Supertag] Failed to refresh registry:", e);
    }
}

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
            await refreshSupertagRegistry();
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
            await refreshSupertagRegistry();
        }
    });
}

/**
 * 从缓存同步挂载方法 (同步执行，确保菜单显示)
 */
export function addCommandTestMenuItem({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;

    const blockElements = detail.blockElements;
    const menu = detail.menu;
    if (!blockElements || blockElements.length === 0 || !menu) return;

    const targetEl = blockElements[0] as HTMLElement;

    // 1. 提取当前块的所有标签
    const tagElements = targetEl.querySelectorAll('span[data-type="tag"]');
    const domTags = Array.from(tagElements).map(el => (el.textContent || "").replace(/#/g, "").trim().toLowerCase());
    const inlineTags = Array.from((targetEl.textContent || "").matchAll(/#([^\s#]+)/g)).map(m => m[1].toLowerCase());
    const currentBlockTags = Array.from(new Set([...domTags, ...inlineTags]));

    if (currentBlockTags.length === 0) return;

    // 2. 在缓存中同步查找匹配项
    let separatorAdded = false;

    for (const tag of currentBlockTags) {
        const matches = SUPERTAG_REGISTRY.filter(item =>
            item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag)
        );

        if (matches.length > 0) {
            if (!separatorAdded) {
                menu.addSeparator();
                separatorAdded = true;
            }

            for (const match of matches) {
                menu.addItem({
                    icon: "iconPlay",
                    label: `⚡ (#${tag}) ${match.methodName}`,
                    click: async () => {
                        const protyleEl = targetEl.closest(".protyle-content") as HTMLElement | null;

                        // 关闭右键菜单
                        try { (window as any).siyuan?.menus?.menu?.remove(); }
                        catch (_) { document.querySelectorAll(".b3-menu").forEach((m: any) => m.remove()); }

                        console.log(`[IndexOS] 🚀 Dispatching [${match.commandRef}] via Supertag Cache`);

                        setTimeout(async () => {
                            try {
                                focusBlockForDispatch(targetEl, protyleEl);
                                await dispatchCommand(match.commandRef, match.paramMapping, { blockEl: targetEl, protyleEl });
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
}

