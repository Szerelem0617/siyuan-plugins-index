import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { getSqliteEngine, runQuery, checkTableExists, instantiateAV, tableNameToAvId, registerFriendlyTableName } from "../../sqlite/sqlite-manager";
import { initSystemTables } from "../indexos/command-sqlite";
import { parseSupertags } from "./supertag-helper";
import { 
    DEV_ENABLE_INIT_SYS,
    getCommandAvId,
    getTypeAvId,
    getCommandDocId,
    getTypeDocId,
    setCommandAvId,
    setTypeAvId,
    setCommandDocId,
    setTypeDocId,
    setCommandRegistry,
    setSupertagRegistry,
    globalSupertagsCache,
    type CommandDef,
    type SupertagCommand
} from "../registration";

/**
 * Preload supertags mapping into cache.
 */
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
                    globalSupertagsCache.set(blockId, parseSupertags(value));
                }
            }
        }
        console.log(`[Supertag-Cache] Preloaded ${globalSupertagsCache.size} supertags mappings into cache.`);
    } catch (e) {
        console.error("[Supertag-Cache] Failed to sync supertags cache:", e);
    }
}

/**
 * Dynamically resolves active table names and primary key column names.
 * Falls back to sys_command_db / sys_type_db if Siyuan AVs are not initialized.
 */
export async function getTargetTablesInfo() {
    let cmdAvId = getCommandAvId();
    let tAvId = getTypeAvId();
    let cmdDocId = getCommandDocId();
    let tDocId = getTypeDocId();

    if (!cmdAvId || !tAvId || !cmdDocId || !tDocId) {
        try {
            // 1. Resolve Command-DB
            const cmdDocSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`;
            const cmdDocs = await post("/api/query/sql", { stmt: cmdDocSql });
            if (cmdDocs && cmdDocs.length > 0) {
                const docId = cmdDocs[0].root_id;
                setCommandDocId(docId);
                cmdDocId = docId;

                const avLinkSql = `SELECT a.value FROM attributes a JOIN blocks b ON a.block_id = b.id WHERE b.root_id = '${docId}' AND a.name = 'custom-index-linked-av' LIMIT 1`;
                const avLinkRes = await post("/api/query/sql", { stmt: avLinkSql });
                if (avLinkRes && avLinkRes.length > 0) {
                    const val = avLinkRes[0].value || "";
                    setCommandAvId(val);
                    cmdAvId = val;
                } else {
                    // Fallback for Pure Database Mode
                    const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
                    const avRes = await post("/api/query/sql", { stmt: avSql });
                    if (avRes && avRes.length > 0) {
                        const domRes = await client.getBlockDOM({ id: avRes[0].id });
                        const html = domRes.data?.dom || "";
                        const match = html.match(/data-av-id="([^"]+)"/);
                        const val = match ? match[1] : avRes[0].id;
                        setCommandAvId(val);
                        cmdAvId = val;
                    }
                }
            }

            // 2. Resolve Type-DB
            const typeDocSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-supertag-db' LIMIT 1`;
            const typeDocs = await post("/api/query/sql", { stmt: typeDocSql });
            if (typeDocs && typeDocs.length > 0) {
                const docId = typeDocs[0].root_id;
                setTypeDocId(docId);
                tDocId = docId;

                const avLinkSql = `SELECT a.value FROM attributes a JOIN blocks b ON a.block_id = b.id WHERE b.root_id = '${docId}' AND a.name = 'custom-index-linked-av' LIMIT 1`;
                const avLinkRes = await post("/api/query/sql", { stmt: avLinkSql });
                if (avLinkRes && avLinkRes.length > 0) {
                    const val = avLinkRes[0].value || "";
                    setTypeAvId(val);
                    tAvId = val;
                } else {
                    // Fallback for Pure Database Mode
                    const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
                    const avRes = await post("/api/query/sql", { stmt: avSql });
                    if (avRes && avRes.length > 0) {
                        const domRes = await client.getBlockDOM({ id: avRes[0].id });
                        const html = domRes.data?.dom || "";
                        const match = html.match(/data-av-id="([^"]+)"/);
                        const val = match ? match[1] : avRes[0].id;
                        setTypeAvId(val);
                        tAvId = val;
                    }
                }
            }
        } catch (e) {
            console.warn("[IndexOS] Error fetching AV IDs on registry load:", e);
        }
    }

    if (cmdAvId && tAvId) {
        registerFriendlyTableName("command-db", cmdAvId);
        registerFriendlyTableName("supertag-db", tAvId);
        const cmdTable = `av_${cmdAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const typeTable = `av_${tAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;

        let commandLabelCol = "label";
        let typeSupertagCol = "supertag";

        try {
            const { db } = await getSqliteEngine();
            const cmdColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [cmdAvId]);
            if (cmdColRes.length > 0 && cmdColRes[0].values.length > 0) {
                commandLabelCol = cmdColRes[0].values[0][0];
            }
            const typeColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [tAvId]);
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
 * 优先尝试从 SQLite 加载以获得更好的性能 and 统一性
 */
export async function refreshSupertagRegistry() {
    if (DEV_ENABLE_INIT_SYS) {
        try {
            const { db } = await getSqliteEngine();
            if (db) {
                // Force re-instantiation of our system AV tables so SQLite is guaranteed to be fully in sync with Siyuan AV updates
                await getTargetTablesInfo();
                const cmdAvId = getCommandAvId();
                const tAvId = getTypeAvId();
                if (cmdAvId) {
                    await instantiateAV(cmdAvId, true);
                }
                if (tAvId) {
                    await instantiateAV(tAvId, true);
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

        const cmdAvId = getCommandAvId();
        const tAvId = getTypeAvId();

        // Check and auto-instantiate if tables do not exist in SQLite
        if (commandsTable.startsWith("av_")) {
            const exists = await checkTableExists(commandsTable);
            if (!exists) {
                const avId = cmdAvId || tableNameToAvId(commandsTable);
                await instantiateAV(avId, true);
            }
        }
        if (typesTable.startsWith("av_")) {
            const exists = await checkTableExists(typesTable);
            if (!exists) {
                const avId = tAvId || tableNameToAvId(typesTable);
                await instantiateAV(avId, true);
            }
        }

        // 1. Load Commands (Layer 2)
        const cmdRes = await runQuery(`SELECT rowID, "${commandLabelCol}", Command_ID, Param_Mapping FROM ${commandsTable}`);
        if (!cmdRes || !cmdRes.values) return false;

        const newCommandRegistry: Record<string, CommandDef> = {};
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
                newCommandRegistry[String(label).trim()] = cmdInfo;
                cmdByRowId[rowID] = cmdInfo;
            }
        }
        setCommandRegistry(newCommandRegistry);

        // 2. Query relation column name for '绑定命令' in Type-DB
        const { db } = await getSqliteEngine();
        let typeRelationCol = "绑定命令";
        let hasRelationCol = false;
        try {
            const relColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name = '绑定命令'`, [tAvId]);
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
                            const foundKey = Object.keys(newCommandRegistry).find(k => k.toLowerCase().includes(cmdNameLower));
                            const cmdInfo = foundKey ? newCommandRegistry[foundKey] : undefined;
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
        setSupertagRegistry(newRegistry);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 从 API 刷新注册表 (网络接口同步备用方案)
 */
async function refreshRegistryFromApi() {
    try {
        // --- 1. Load Layer 2 (Command-DB) ---
        const cmdSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`;
        const cmdDocs = await post("/api/query/sql", { stmt: cmdSql });
        const cmdByRowId: Record<string, { methodName: string, commandRef: string, paramMapping: string }> = {};

        const newCommandRegistry: Record<string, CommandDef> = {};

        if (cmdDocs && cmdDocs.length > 0) {
            const docId = cmdDocs[0].root_id;
            setCommandDocId(docId);
            const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' LIMIT 1`;
            const listRes = await post("/api/query/sql", { stmt: listSql });
            if (listRes && listRes.length > 0) {
                const listId = listRes[0].id;
                const listAttrsRes = await client.getBlockAttrs({ id: listId });
                const avId = (listAttrsRes.data || {})["custom-index-linked-av"];
                if (avId) {
                    setCommandAvId(avId);
                    const renderRes = await post("/api/av/renderAttributeView", { id: avId });
                    const view = renderRes.view || renderRes;
                    const rows: any[] = view.rows || [];
                    const columns: any[] = view.columns || [];

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
                            newCommandRegistry[pk.trim()] = cmdInfo;
                            cmdByRowId[row.id] = cmdInfo;
                        }
                    }
                    setCommandRegistry(newCommandRegistry);
                }
            }
        }

        // --- 2. Load Layer 3 (Type-DB) ---
        const sql = `SELECT root_id FROM attributes WHERE name = 'custom-index-supertag-db' LIMIT 1`;
        const existingDocs = await post("/api/query/sql", { stmt: sql });
        if (!existingDocs || existingDocs.length === 0) return;
        const docId = existingDocs[0].root_id;
        setTypeDocId(docId);

        const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' LIMIT 1`;
        const listRes = await post("/api/query/sql", { stmt: listSql });
        if (!listRes || listRes.length === 0) return;
        const listId = listRes[0].id;

        const listAttrsRes = await client.getBlockAttrs({ id: listId });
        const avId = (listAttrsRes.data || {})["custom-index-linked-av"];
        if (!avId) return;
        setTypeAvId(avId);

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
                            const foundKey = Object.keys(newCommandRegistry).find(k => k.toLowerCase().includes(cmdNameLower));
                            const cmdInfo = foundKey ? newCommandRegistry[foundKey] : undefined;
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
        setSupertagRegistry(newRegistry);
    } catch (e) {
    }
}
