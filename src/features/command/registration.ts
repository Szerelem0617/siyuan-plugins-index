import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { dispatchCommand, focusBlockForDispatch, cleanupAfterDispatch } from "./command-dispatcher";
import type { Protyle, Menu } from "siyuan";

export const DEV_ENABLE_INIT_SYS = true;

// --- 内存缓存：Supertag 注册表 ---
export interface CommandDef {
    methodName: string;
    commandRef: string;
    paramMapping: string;
}

export interface SupertagCommand {
    typeTag: string;      // 匹配核心标签 (如 Project)
    methodName: string;   // UI 显示的方法名
    commandRef: string;   // 执行的命令 ID
    paramMapping: string;
    uiLocation: string;   // 绑定的界面位置
    autoSync?: boolean;    
    targetDbId?: string;   
    typeFieldId?: string; 
    mappedValue?: any; 
}
export let COMMAND_REGISTRY: Record<string, CommandDef> = {};
export let SUPERTAG_REGISTRY: SupertagCommand[] = [];
export let commandAvId: string = "";
export let typeAvId: string = "";

/**
 * 刷新 Supertag 注册表：从 Command-DB (Layer 2) 和 Type-DB (Layer 3) 联合加载数据
 */
export async function refreshSupertagRegistry() {
    try {
        // --- 1. Load Layer 2 (Command-DB) ---
        const cmdSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`;
        const cmdDocs = await post("/api/query/sql", { stmt: cmdSql });
        if (cmdDocs && cmdDocs.length > 0) {
            const docId = cmdDocs[0].root_id;
            const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' LIMIT 1`;
            const listRes = await post("/api/query/sql", { stmt: listSql });
            if (listRes && listRes.length > 0) {
                const listId = listRes[0].id;
                const listAttrsRes = await client.getBlockAttrs({ id: listId });
                const avId = (listAttrsRes.data || {})["custom-index-linked-av"];
                if (avId) {
                    commandAvId = avId;
                    const renderRes = await post("/api/av/renderAttributeView", { id: avId });
                    const view = renderRes.view || renderRes;
                    const rows: any[] = view.rows || [];
                    const columns: any[] = view.columns || [];

                    COMMAND_REGISTRY = {};
                    for (const row of rows) {
                        const getCellText = (colName: string): string => {
                            const idx = columns.findIndex((c: any) => c.name === colName || c.keyName === colName);
                            if (idx < 0) return "";
                            const cell = row.cells[idx];
                            return cell?.value?.text?.content || cell?.value?.mText?.content || cell?.value?.block?.content || "";
                        };
                        const pk = getCellText("Primary Key") || (row.cells[0]?.value?.block?.content) || "";
                        const cmdId = getCellText("Command ID");
                        const paramMapping = getCellText("Param Mapping");
                        
                        if (pk && cmdId) {
                            COMMAND_REGISTRY[pk.trim()] = {
                                methodName: pk.trim(),
                                commandRef: cmdId.trim(),
                                paramMapping: paramMapping.trim()
                            };
                        }
                    }
                }
            }
        }

        // --- 2. Load Layer 3 (Type-DB) ---
        const sql = `SELECT root_id FROM attributes WHERE name = 'custom-index-type-db' LIMIT 1`;
        const existingDocs = await post("/api/query/sql", { stmt: sql });
        if (!existingDocs || existingDocs.length === 0) {
            // console.log("[Supertag] Type-DB (Layer 3) not found.");
            return;
        }
        const docId = existingDocs[0].root_id;

        const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' LIMIT 1`;
        const listRes = await post("/api/query/sql", { stmt: listSql });
        if (!listRes || listRes.length === 0) {
            // console.log("[Supertag] Type-DB list block not found.");
            return;
        }
        const listId = listRes[0].id;

        const listAttrsRes = await client.getBlockAttrs({ id: listId });
        const avId = (listAttrsRes.data || {})["custom-index-linked-av"];
        if (!avId) {
            // console.log("[Supertag] Type-DB does not have custom-index-linked-av attribute.");
            return;
        }
        typeAvId = avId;

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
            const blockMenuRaw = getCellText("Block Icon Menu");
            const pageMenuRaw = getCellText("Current Page Menu");


            const enableColIdx = columns.findIndex((c: any) => c.name === "Enable" || c.keyName === "Enable");
            let enableStatus = true;
            if (enableColIdx >= 0) {
                const cell = row.cells[enableColIdx];
                if (cell && cell.value && cell.value.checkbox) {
                    enableStatus = cell.value.checkbox.checked;
                }
            }

            if (enableStatus && typeTagRaw) {
                const cleanTag = typeTagRaw.replace(/\\/g, "").replace(/#/g, "").split("|")[0].split("(")[0].trim().toLowerCase();

                // 解析 Block Icon Menu
                if (blockMenuRaw) {
                    const mappedCmds = blockMenuRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                    for (const cmdName of mappedCmds) {
                        const cmdNameLower = cmdName.toLowerCase();
                        const foundKey = Object.keys(COMMAND_REGISTRY).find(k => k.toLowerCase().includes(cmdNameLower));
                        const cmdInfo = foundKey ? COMMAND_REGISTRY[foundKey] : undefined;
                        
                        if (cmdInfo) {
                            newRegistry.push({
                                typeTag: cleanTag,
                                methodName: cmdInfo.methodName,
                                commandRef: cmdInfo.commandRef,
                                paramMapping: cmdInfo.paramMapping,
                                uiLocation: "BlockIconMenu"
                            });
                        } else {
                            console.warn(`[Supertag] Command "${cmdName}" defined in ${cleanTag} not found in Layer 2 (COMMAND_REGISTRY keys: ${Object.keys(COMMAND_REGISTRY).join(", ")}).`);
                        }
                    }
                }

                // 解析 Current Page Menu
                if (pageMenuRaw) {
                    const mappedCmds = pageMenuRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                    for (const cmdName of mappedCmds) {
                        const cmdNameLower = cmdName.toLowerCase();
                        const foundKey = Object.keys(COMMAND_REGISTRY).find(k => k.toLowerCase().includes(cmdNameLower));
                        const cmdInfo = foundKey ? COMMAND_REGISTRY[foundKey] : undefined;

                        if (cmdInfo) {
                            newRegistry.push({
                                typeTag: cleanTag,
                                methodName: cmdInfo.methodName,
                                commandRef: cmdInfo.commandRef,
                                paramMapping: cmdInfo.paramMapping,
                                uiLocation: "PageMenu"
                            });
                        }
                    }
                }
            }
        }
        SUPERTAG_REGISTRY = newRegistry;
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
            (item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag))
            && item.uiLocation === "BlockIconMenu"
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

