import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage, type Protyle, type Menu } from "siyuan";
import { dispatchCommand, focusBlockForDispatch, cleanupAfterDispatch } from "./command-dispatcher";
import { getSqliteEngine, runQuery, saveDatabaseToDisk, checkTableExists, instantiateAV, tableNameToAvId, registerFriendlyTableName } from "../sqlite/sqlite-manager";
import { getSystemTableNames, initSystemTables } from "./indexos/command-sqlite";
import { reverseDbToList } from "./hierarchy/db-reverse-list";
import { isDevModeActive } from "../dev-mode";

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
export const globalSupertagsCache = new Map<string, string[]>();

export async function syncGlobalSupertagsCache() {
    try {
        const res = await post("/api/query", {
            stmt: "SELECT block_id, value FROM attributes WHERE name = 'custom-supertags'"
        });
        const rows = res?.data || res || [];
        globalSupertagsCache.clear();
        if (Array.isArray(rows)) {
            for (const row of rows) {
                const blockId = row.block_id;
                const value = row.value;
                if (blockId && value) {
                    try {
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed)) {
                            globalSupertagsCache.set(blockId, parsed.map(t => String(t).trim().toLowerCase()));
                        }
                    } catch (_) {
                        const tags = value.split(/[, ]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
                        globalSupertagsCache.set(blockId, tags);
                    }
                }
            }
        }
        console.log(`[Supertag-Cache] Preloaded ${globalSupertagsCache.size} supertags mappings into cache.`);
    } catch (e) {
        console.error("[Supertag-Cache] Failed to sync supertags cache:", e);
    }
}
export let commandAvId: string = "";
export let typeAvId: string = "";
export let commandDocId: string = "";
export let typeDocId: string = "";
export function setCommandAvId(val: string) {
    commandAvId = val;
    if (val) registerFriendlyTableName("Command-DB", val);
}
export function setTypeAvId(val: string) {
    typeAvId = val;
    if (val) registerFriendlyTableName("Type-DB", val);
}
export function setCommandDocId(val: string) { commandDocId = val; }
export function setTypeDocId(val: string) { typeDocId = val; }
export function getCommandAvId() { return commandAvId; }
export function getTypeAvId() { return typeAvId; }
export function getCommandDocId() { return commandDocId; }
export function getTypeDocId() { return typeDocId; }

/**
 * Dynamically resolves active table names and primary key column names.
 * Falls back to sys_command_db / sys_type_db if Siyuan AVs are not initialized.
 */
export async function getTargetTablesInfo() {
    if (!commandAvId || !typeAvId || !commandDocId || !typeDocId) {
        try {
            // 1. Resolve Command-DB
            const cmdDocSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`;
            const cmdDocs = await post("/api/query/sql", { stmt: cmdDocSql });
            if (cmdDocs && cmdDocs.length > 0) {
                const docId = cmdDocs[0].root_id;
                commandDocId = docId;

                const avLinkSql = `SELECT a.value FROM attributes a JOIN blocks b ON a.block_id = b.id WHERE b.root_id = '${docId}' AND a.name = 'custom-index-linked-av' LIMIT 1`;
                const avLinkRes = await post("/api/query/sql", { stmt: avLinkSql });
                if (avLinkRes && avLinkRes.length > 0) {
                    commandAvId = avLinkRes[0].value || "";
                } else {
                    // Fallback for Pure Database Mode
                    const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
                    const avRes = await post("/api/query/sql", { stmt: avSql });
                    if (avRes && avRes.length > 0) {
                        const domRes = await client.getBlockDOM({ id: avRes[0].id });
                        const html = domRes.data?.dom || "";
                        const match = html.match(/data-av-id="([^"]+)"/);
                        commandAvId = match ? match[1] : avRes[0].id;
                    }
                }
            }

            // 2. Resolve Type-DB
            const typeDocSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-type-db' LIMIT 1`;
            const typeDocs = await post("/api/query/sql", { stmt: typeDocSql });
            if (typeDocs && typeDocs.length > 0) {
                const docId = typeDocs[0].root_id;
                typeDocId = docId;

                const avLinkSql = `SELECT a.value FROM attributes a JOIN blocks b ON a.block_id = b.id WHERE b.root_id = '${docId}' AND a.name = 'custom-index-linked-av' LIMIT 1`;
                const avLinkRes = await post("/api/query/sql", { stmt: avLinkSql });
                if (avLinkRes && avLinkRes.length > 0) {
                    typeAvId = avLinkRes[0].value || "";
                } else {
                    // Fallback for Pure Database Mode
                    const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
                    const avRes = await post("/api/query/sql", { stmt: avSql });
                    if (avRes && avRes.length > 0) {
                        const domRes = await client.getBlockDOM({ id: avRes[0].id });
                        const html = domRes.data?.dom || "";
                        const match = html.match(/data-av-id="([^"]+)"/);
                        typeAvId = match ? match[1] : avRes[0].id;
                    }
                }
            }
        } catch (e) {
            console.warn("[IndexOS] Error fetching AV IDs on registry load:", e);
        }
    }

    if (commandAvId && typeAvId) {
        registerFriendlyTableName("Command-DB", commandAvId);
        registerFriendlyTableName("Type-DB", typeAvId);
        const cmdTable = `av_${commandAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const typeTable = `av_${typeAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;

        let commandLabelCol = "label";
        let typeSupertagCol = "supertag";

        try {
            const { db } = await getSqliteEngine();
            const cmdColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [commandAvId]);
            if (cmdColRes.length > 0 && cmdColRes[0].values.length > 0) {
                commandLabelCol = cmdColRes[0].values[0][0];
            }
            const typeColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [typeAvId]);
            if (typeColRes.length > 0 && typeColRes[0].values.length > 0) {
                typeSupertagCol = typeColRes[0].values[0][0];
            }
        } catch (e) {
            console.warn("[IndexOS] Error reading schema from _av_schema, using defaults:", e);
        }

        return {
            commandsTable: cmdTable,
            typesTable: typeTable,
            commandLabelCol,
            typeSupertagCol,
            isInitialized: true
        };
    }

    return {
        commandsTable: "sys_command_db",
        typesTable: "sys_type_db",
        commandLabelCol: "label",
        typeSupertagCol: "supertag",
        isInitialized: false
    };
}

/**
 * 刷新 Supertag 注册表：从 Command-DB (Layer 2) 和 Type-DB (Layer 3) 联合加载数据
 * 优先尝试从 SQLite 加载以获得更好的性能和统一性
 */
export async function refreshSupertagRegistry() {
    if (DEV_ENABLE_INIT_SYS) {
        try {
            const { db } = await getSqliteEngine();
            if (db) {
                // Force re-instantiation of our system AV tables so SQLite is guaranteed to be fully in sync with Siyuan AV updates
                await getTargetTablesInfo();
                if (commandAvId) {
                    await instantiateAV(commandAvId, true);
                }
                if (typeAvId) {
                    await instantiateAV(typeAvId, true);
                }
                const success = await refreshRegistryFromSqlite();
                if (success) return;
            }
        } catch (e) {
            console.warn("[Supertag] SQLite sync/refresh failed, falling back to API refresh", e);
        }
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
        const { commandsTable, typesTable, commandLabelCol, typeSupertagCol } = await getTargetTablesInfo();

        // Check and auto-instantiate if tables do not exist in SQLite
        if (commandsTable.startsWith("av_")) {
            const exists = await checkTableExists(commandsTable);
            if (!exists) {
                const avId = commandAvId || tableNameToAvId(commandsTable);
                await instantiateAV(avId, true);
            }
        }
        if (typesTable.startsWith("av_")) {
            const exists = await checkTableExists(typesTable);
            if (!exists) {
                const avId = typeAvId || tableNameToAvId(typesTable);
                await instantiateAV(avId, true);
            }
        }

        // 1. Load Commands (Layer 2)
        const cmdRes = await runQuery(`SELECT rowID, "${commandLabelCol}", Command_ID, Param_Mapping FROM ${commandsTable}`);
        if (!cmdRes || !cmdRes.values) return false;

        COMMAND_REGISTRY = {};
        const cmdByRowId: Record<string, { methodName: string, commandRef: string, paramMapping: string }> = {};

        for (const row of cmdRes.values) {
            const rowID = String(row[0]);
            const label = row[1];
            const cmdId = row[2];
            const param = row[3];
            if (label && cmdId) {
                const cmdInfo = {
                    methodName: String(label).trim(),
                    commandRef: String(cmdId).trim(),
                    paramMapping: String(param || "").trim()
                };
                COMMAND_REGISTRY[String(label).trim()] = cmdInfo;
                cmdByRowId[rowID] = cmdInfo;
            }
        }

        // 2. Query relation column name for '绑定命令' in Type-DB
        const { db } = await getSqliteEngine();
        let typeRelationCol = "绑定命令";
        let hasRelationCol = false;
        try {
            const relColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name = '绑定命令'`, [typeAvId]);
            if (relColRes.length > 0 && relColRes[0].values.length > 0) {
                typeRelationCol = relColRes[0].values[0][0];
                hasRelationCol = true;
            }
        } catch (e) {
            // ignore
        }

        // 3. Load Type Bindings (Layer 3)
        let querySql = "";
        if (hasRelationCol) {
            querySql = `SELECT "${typeSupertagCol}", "${typeRelationCol}" FROM ${typesTable}`;
        } else {
            // Check if Icon_Menu exists in column names, if not fallback to Block_Icon_Menu
            const checkCols = await runQuery(`PRAGMA table_info(${typesTable})`);
            const colNames = checkCols?.values?.map((c: any) => c[1]) || [];
            if (colNames.includes("Icon_Menu")) {
                querySql = `SELECT "${typeSupertagCol}", Icon_Menu FROM ${typesTable}`;
            } else if (colNames.includes("Block_Icon_Menu")) {
                querySql = `SELECT "${typeSupertagCol}", Block_Icon_Menu, Current_Page_Menu FROM ${typesTable}`;
            } else {
                querySql = `SELECT "${typeSupertagCol}" FROM ${typesTable}`;
            }
        }
        const typeRes = await runQuery(querySql);
        if (!typeRes || !typeRes.values) return false;

        const newRegistry: SupertagCommand[] = [];
        for (const row of typeRes.values) {
            const typeTagRaw = row[0];

            if (typeTagRaw) {
                const cleanTag = String(typeTagRaw).replace(/\\/g, "").replace(/#/g, "").split("|")[0].split("(")[0].trim().toLowerCase();

                if (hasRelationCol) {
                    const relationRaw = row[1];
                    if (relationRaw) {
                        try {
                            const linkedRowIds: string[] = JSON.parse(relationRaw);
                            if (Array.isArray(linkedRowIds)) {
                                for (const cmdRowId of linkedRowIds) {
                                    const cmdInfo = cmdByRowId[cmdRowId];
                                    if (cmdInfo) {
                                        // Check if already bound to avoid duplicates in the same UI location
                                        const exists = newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === cmdInfo.commandRef && r.uiLocation === "IconMenu");
                                        if (!exists) {
                                            newRegistry.push({
                                                typeTag: cleanTag,
                                                methodName: cmdInfo.methodName,
                                                commandRef: cmdInfo.commandRef,
                                                paramMapping: cmdInfo.paramMapping,
                                                uiLocation: "IconMenu"
                                            });
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                        }
                    }
                } else {
                    const processMenu = (raw: any, location: string) => {
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

                    if (row.length === 2) {
                        processMenu(row[1], "IconMenu");
                    } else if (row.length === 3) {
                        processMenu(row[1], "IconMenu");
                        processMenu(row[2], "IconMenu");
                    }
                }
            }
        }
        SUPERTAG_REGISTRY = newRegistry;
        return true;
    } catch (e) {
        return false;
    }
}

async function refreshRegistryFromApi() {
    try {
        // --- 1. Load Layer 2 (Command-DB) ---
        const cmdSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`;
        const cmdDocs = await post("/api/query/sql", { stmt: cmdSql });
        const cmdByRowId: Record<string, { methodName: string, commandRef: string, paramMapping: string }> = {};

        if (cmdDocs && cmdDocs.length > 0) {
            const docId = cmdDocs[0].root_id;
            commandDocId = docId;
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
                            const cmdInfo = {
                                methodName: pk.trim(),
                                commandRef: cmdId.trim(),
                                paramMapping: paramMapping.trim()
                            };
                            COMMAND_REGISTRY[pk.trim()] = cmdInfo;
                            cmdByRowId[row.id] = cmdInfo;
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
        typeDocId = docId;

        const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' LIMIT 1`;
        const listRes = await post("/api/query/sql", { stmt: listSql });
        if (!listRes || listRes.length === 0) return;
        const listId = listRes[0].id;

        const listAttrsRes = await client.getBlockAttrs({ id: listId });
        const avId = (listAttrsRes.data || {})["custom-index-linked-av"];
        if (!avId) return;
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

            const getRelationIds = (colName: string): string[] => {
                const idx = columns.findIndex((c: any) => c.name === colName || c.keyName === colName);
                if (idx < 0) return [];
                const cell = row.cells[idx];
                const relContents = cell?.value?.relation?.contents || [];
                return relContents.map((rc: any) => rc.block?.id || rc.blockID || rc.content).filter(Boolean);
            };

            const typeTagRaw = getCellText("Primary Key") || (row.cells[0]?.value?.block?.content) || "";
            const iconMenuRaw = getCellText("Icon Menu") || getCellText("iconMenu") || getCellText("Block Icon Menu") || getCellText("Current Page Menu");
            const linkedRowIds = getRelationIds("绑定命令");

            const hasRelationCol = columns.some((c: any) => c.name === "绑定命令" || c.keyName === "绑定命令");

            if (typeTagRaw) {
                const cleanTag = typeTagRaw.replace(/\\/g, "").replace(/#/g, "").split("|")[0].split("(")[0].trim().toLowerCase();

                if (hasRelationCol) {
                    // Parse relations only
                    for (const cmdRowId of linkedRowIds) {
                        const cmdInfo = cmdByRowId[cmdRowId];
                        if (cmdInfo) {
                            const exists = newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === cmdInfo.commandRef && r.uiLocation === "IconMenu");
                            if (!exists) {
                                newRegistry.push({
                                    typeTag: cleanTag,
                                    methodName: cmdInfo.methodName,
                                    commandRef: cmdInfo.commandRef,
                                    paramMapping: cmdInfo.paramMapping,
                                    uiLocation: "IconMenu"
                                });
                            }
                        }
                    }
                } else {
                    // Parse text menus only
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
                    };
                    processMenu(iconMenuRaw, "IconMenu");
                }
            }
        }
        SUPERTAG_REGISTRY = newRegistry;
    } catch (e) {
    }
}

/** 
 * 生成用于 Slash (/) 召唤出的初始构建指令选项
 */
export function getInitSystemSlashCommand() {
    if (!DEV_ENABLE_INIT_SYS || !isDevModeActive()) return null;

    return [
        {
            filter: ["init system db", "实例化", "sxl"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.initSystemDB}</span><span class="b3-list-item__meta">Legacy AV</span></div>`,
            id: "initSystemDB",
            async callback(protyle: Protyle) {
                protyle.insert("");
                await constructCommandStorage();
                await refreshSupertagRegistry();
            }
        },
        {
            filter: ["reverse db list", "生成列表", "sxlm"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">生成列表</span><span class="b3-list-item__meta">Outline</span></div>`,
            id: "reverseDbList",
            async callback(protyle: Protyle) {
                protyle.insert("");
                const success = await reverseDbToList();
                if (success) {
                    await refreshSupertagRegistry();
                }
            }
        }
    ];
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
    
    // Extract custom supertags from block attribute (or page DOM container if it's title block)
    let customTags: string[] = [];
    const isTitleBlock = targetEl.classList.contains("protyle-title") || targetEl.querySelector(".protyle-title");
    if (isTitleBlock) {
        const docPills = document.querySelectorAll(".index-doc-supertags .index-supertag-pill");
        customTags = Array.from(docPills).map(pill => {
            const text = pill.textContent || "";
            // The pill ends with 'x' to remove it, clean that up
            const cleanText = text.trim();
            if (cleanText.endsWith("x")) {
                return cleanText.substring(0, cleanText.length - 1).trim().toLowerCase();
            }
            return cleanText.toLowerCase();
        }).filter(Boolean);
    } else {
        const rawCustom = targetEl.getAttribute("custom-supertags");
        if (rawCustom) {
            try {
                const parsed = JSON.parse(rawCustom);
                if (Array.isArray(parsed)) {
                    customTags = parsed.map(t => String(t).trim().toLowerCase());
                }
            } catch (_) {}
        }
    }
    
    const currentBlockTags = Array.from(new Set([...domTags, ...inlineTags, ...customTags]));

    const blockId = targetEl.getAttribute("data-node-id") || "";

    if (currentBlockTags.length === 0) return;

    // 2. 在缓存中同步查找匹配项
    let separatorAdded = false;

    for (const tag of currentBlockTags) {
        const matches = SUPERTAG_REGISTRY.filter(item =>
            (item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag))
            && (item.uiLocation === "IconMenu" || item.uiLocation === "BlockIconMenu" || item.uiLocation === "PageMenu")
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

                        // Dispatch

                        setTimeout(async () => {
                            try {
                                focusBlockForDispatch(targetEl, protyleEl);
                                // Force reload registry from Siyuan/SQLite to get the latest parameter mappings
                                await refreshSupertagRegistry();
                                const freshMatch = SUPERTAG_REGISTRY.find(item =>
                                    item.commandRef === match.commandRef && item.typeTag === match.typeTag
                                ) || match;

                                await dispatchCommand(freshMatch.commandRef, freshMatch.paramMapping, { blockEl: targetEl, protyleEl, supertag: tag });
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

/**
 * Handle document sidebar tree item right click menu
 */
export function addDoctreeMenuItems({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;
    const menu = detail.menu;
    console.log("[Supertag-Debug] addDoctreeMenuItems triggered synchronously. detail:", detail);
    if (!menu || !detail.elements || detail.elements.length === 0) {
        console.log("[Supertag-Debug] addDoctreeMenuItems missing menu or elements");
        return;
    }

    const el = detail.elements[0];
    const docId = el.getAttribute("data-node-id");
    console.log("[Supertag-Debug] doctree el:", el, "docId:", docId);
    if (!docId) return;

    try {
        const tags = globalSupertagsCache.get(docId) || [];
        console.log("[Supertag-Debug] doctree tags from cache:", tags);
        if (tags.length === 0) return;

        for (const tag of tags) {
            const matches = SUPERTAG_REGISTRY.filter(item =>
                (item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag))
                && (item.uiLocation === "IconMenu" || item.uiLocation === "BlockIconMenu" || item.uiLocation === "PageMenu")
            );
            console.log("[Supertag-Debug] doctree matched commands:", matches);

            if (matches.length > 0) {
                for (const match of matches) {
                    menu.addItem({
                        icon: "iconPlay",
                        label: `⚡ (#${tag}) ${match.methodName}`,
                        click: async () => {
                            const activeProtyle = (window as any).activeProtyleInstance;
                            const protyleEl = activeProtyle?.element || null;
                            const blockEl = protyleEl?.querySelector(`[data-node-id="${docId}"]`) || null;

                            await refreshSupertagRegistry();
                            const freshMatch = SUPERTAG_REGISTRY.find(item =>
                                item.commandRef === match.commandRef && item.typeTag === match.typeTag
                            ) || match;

                            await dispatchCommand(freshMatch.commandRef, freshMatch.paramMapping, { 
                                blockEl: blockEl || document.createElement("div"), 
                                protyleEl, 
                                supertag: tag 
                            });
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error("[IndexOS] Doctree Menu Add Failed:", e);
    }
}

/**
 * Handle editor page title icon click menu
 */
export function addEditorTitleIconMenuItems({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;
    const menu = detail.menu;
    const protyle = detail.protyle;
    console.log("[Supertag-Debug] addEditorTitleIconMenuItems triggered synchronously. detail:", detail);
    if (!menu || !protyle) {
        console.log("[Supertag-Debug] addEditorTitleIconMenuItems missing menu or protyle");
        return;
    }

    const docId = protyle.block?.rootID || protyle.blockId;
    console.log("[Supertag-Debug] editor title docId:", docId);
    if (!docId) return;

    try {
        const tags = globalSupertagsCache.get(docId) || [];
        console.log("[Supertag-Debug] editor title tags from cache:", tags);
        if (tags.length === 0) return;

        for (const tag of tags) {
            const matches = SUPERTAG_REGISTRY.filter(item =>
                (item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag))
                && (item.uiLocation === "IconMenu" || item.uiLocation === "BlockIconMenu" || item.uiLocation === "PageMenu")
            );
            console.log("[Supertag-Debug] editor title matched commands:", matches);

            if (matches.length > 0) {
                for (const match of matches) {
                    menu.addItem({
                        icon: "iconPlay",
                        label: `⚡ (#${tag}) ${match.methodName}`,
                        click: async () => {
                            const protyleEl = protyle.element || null;
                            const blockEl = protyleEl?.querySelector(`[data-node-id="${docId}"]`) || null;

                            await refreshSupertagRegistry();
                            const freshMatch = SUPERTAG_REGISTRY.find(item =>
                                item.commandRef === match.commandRef && item.typeTag === match.typeTag
                            ) || match;

                            await dispatchCommand(freshMatch.commandRef, freshMatch.paramMapping, { 
                                blockEl: blockEl || document.createElement("div"), 
                                protyleEl, 
                                supertag: tag 
                            });
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error("[IndexOS] Title Icon Menu Add Failed:", e);
    }
}

