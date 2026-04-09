import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage, type Protyle, type Menu } from "siyuan";
import { dispatchCommand, focusBlockForDispatch, cleanupAfterDispatch } from "./command-dispatcher";
import { getSqliteEngine, runQuery, saveDatabaseToDisk } from "../sqlite/sqlite-manager";
import { getSystemTableNames, initSystemTables } from "../sqlite/indexos/command-sqlite";

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
 * 优先尝试从 SQLite 加载以获得更好的性能和统一性
 */
export async function refreshSupertagRegistry() {
    try {
        const { db } = await getSqliteEngine();
        if (db) {
            const success = await refreshRegistryFromSqlite();
            if (success) return;
        }
    } catch (e) {
        console.warn("[Supertag] SQLite not ready, falling back to API refresh", e);
    }
    await refreshRegistryFromApi();
}

/**
 * 从 SQLite 引擎刷新注册表 (核心内置数据库逻辑)
 * SQLite 现在是 Source of Truth，不再依赖思源文档
 */
async function refreshRegistryFromSqlite(): Promise<boolean> {
    try {
        await initSystemTables(); // Ensure tables ready
        const { commands, types } = getSystemTableNames();

        // 1. Load Commands (Layer 2)
        const cmdRes = await runQuery(`SELECT label, commandID, paramMapping FROM ${commands} WHERE enabled = 1`);
        if (!cmdRes || !cmdRes.values) return false;

        COMMAND_REGISTRY = {};
        for (const row of cmdRes.values) {
            const label = row[0];
            const cmdId = row[1];
            const param = row[2];
            if (label && cmdId) {
                COMMAND_REGISTRY[String(label).trim()] = {
                    methodName: String(label).trim(),
                    commandRef: String(cmdId).trim(),
                    paramMapping: String(param || "").trim()
                };
            }
        }

        // 2. Load Type Bindings (Layer 3)
        const typeRes = await runQuery(`SELECT supertag, blockIconMenu, pageMenu FROM ${types} WHERE enabled = 1`);
        if (!typeRes || !typeRes.values) return false;

        const newRegistry: SupertagCommand[] = [];
        for (const row of typeRes.values) {
            const typeTagRaw = row[0];
            const blockMenuRaw = row[1];
            const pageMenuRaw = row[2];

            if (typeTagRaw) {
                const cleanTag = String(typeTagRaw).toLowerCase().trim();

                const processMenu = (raw: any, location: "BlockIconMenu" | "PageMenu") => {
                    if (!raw) return;
                    const mappedCmds = String(raw).split(/[,，]/).map(s => s.trim()).filter(Boolean);
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
                                uiLocation: location
                            });
                        }
                    }
                };

                processMenu(blockMenuRaw, "BlockIconMenu");
                processMenu(pageMenuRaw, "PageMenu");
            }
        }

        SUPERTAG_REGISTRY = newRegistry;
        console.log(`[SQLite-IndexOS] Registry refreshed from Source of Truth. Commands: ${Object.keys(COMMAND_REGISTRY).length}, Supertags: ${SUPERTAG_REGISTRY.length}`);
        return true;
    } catch (e) {
        console.error("[SQLite-IndexOS] Failed to refresh registry from SQL:", e);
        return false;
    }
}

/**
 * 传统的 API 方式刷新 (作为降级方案)
 */
async function refreshRegistryFromApi() {
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

                const processMenu = (raw: string, location: string) => {
                    if (!raw) return;
                    const mappedCmds = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
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
                                uiLocation: location
                            });
                        }
                    }
                }
                processMenu(blockMenuRaw, "BlockIconMenu");
                processMenu(pageMenuRaw, "PageMenu");
            }
        }
        SUPERTAG_REGISTRY = newRegistry;
    } catch (e) {
        console.error("[Supertag] API Refresh failed:", e);
    }
}

/** 
 * 生成用于 Slash (/) 召唤出的初始构建指令选项
 */
export function getInitSystemSlashCommand() {
    if (!DEV_ENABLE_INIT_SYS) return null;

    return [
        {
            filter: ["init system db", "初始化体系", "cshi"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.initSystemDB}</span><span class="b3-list-item__meta">Legacy AV</span></div>`,
            id: "initSystemDB",
            async callback(protyle: Protyle) {
                console.log("[IndexPlugin] Slash initSystemDB");
                protyle.insert("");
                await constructCommandStorage();
                await refreshSupertagRegistry();
            }
        },
        {
            filter: ["reset sqlite", "重置数据库", "czsqlite"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">重置内置 SQLite 数据库</span><span class="b3-list-item__meta">Source of Truth</span></div>`,
            id: "resetSqliteDB",
            async callback(protyle: Protyle) {
                protyle.insert("");
                const { db } = await getSqliteEngine();
                const { commands, types } = getSystemTableNames();
                
                db.run(`DROP TABLE IF EXISTS ${commands}`);
                db.run(`DROP TABLE IF EXISTS ${types}`);
                await initSystemTables();
                await saveDatabaseToDisk();
                await refreshSupertagRegistry();
                showMessage("内置 SQLite 数据库已重置并加载默认数据");
            }
        }
    ];
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
    menu.addItem({
        icon: "iconRefresh",
        label: "重置内置 SQLite 数据库",
        click: async () => {
            const { db } = await getSqliteEngine();
            const { commands, types } = getSystemTableNames();
            
            db.run(`DROP TABLE IF EXISTS ${commands}`);
            db.run(`DROP TABLE IF EXISTS ${types}`);
            await initSystemTables();
            await saveDatabaseToDisk();
            await refreshSupertagRegistry();
            showMessage("内置 SQLite 数据库已重置并加载默认数据");
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

