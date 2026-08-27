import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { getSqliteEngine, runQuery, checkTableExists, instantiateAV, tableNameToAvId, registerFriendlyTableName } from "../../sqlite/sqlite-manager";
import { initSystemTables } from "../indexos/command-sqlite";
import { getSeedCommandRows, getSeedSupertagRows } from "../indexos/seed-data";
import { syncCompositesFromCommandDb } from "../composite/manager";
import { parseManualConfig, type ManualCommandEntry } from "./manual-config";
import { parseSupertags } from "../../unified-attributes/core/supertag-diff";
import { 
    isDevInitSysEnabled,
    getCommandAvId,
    getTypeAvId,
    getCommandDocId,
    getTypeDocId,
    setCommandAvId,
    setTypeAvId,
    setCommandDocId,
    setTypeDocId,
    setCommandBindings,
    setSupertagRegistry,
    SUPERTAG_REGISTRY,
    globalSupertagsCache,
    type CommandBinding,
    type SupertagCommand
} from "../registration";
import { commandRegistry } from "../registry/command-registry";
import { supertagBinder } from "../../unified-attributes/core/supertag-binder";

/**
 * Preload supertags mapping into cache.
 */
export async function syncGlobalSupertagsCache() {
    try {
        const res = await post("/api/query/sql", {
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
 * 已实例化：返回思源 AV 对应的 av_* 镜像表名。
 * 未实例化：返回空表名，调用方应改走 seed-data.ts 种子常量（不再有 SQLite 种子表）。
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
        commandsTable: "",
        typesTable: "",
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
    try {
        const { db } = await getSqliteEngine();
        await getTargetTablesInfo();
        const cmdAvId = getCommandAvId();
        const tAvId = getTypeAvId();

        if (cmdAvId && tAvId) {
            // 已实例化：从思源 AV 刷新（经 av_ SQLite 镜像）
            await instantiateAV(cmdAvId, true);
            await instantiateAV(tAvId, true);
            const success = await refreshRegistryFromSqlite();
            if (success) return;
            await refreshRegistryFromApi();
            if (SUPERTAG_REGISTRY.length > 0) return;
        }
    } catch (e) {
        console.warn("[Supertag Sync] SQLite/AV check failed, using seed data fallback:", e);
    }

    // 未实例化状态（或数据库未创建）：直接从 seed-data.ts 常量构建 Layer 2/3 注册表
    refreshRegistryFromSeed();
}

/**
 * 未实例化路径：从 seed-data.ts 常量构建 Layer 2/3 注册表。
 * 解析规则与 refreshRegistryFromSqlite 保持一致
 * （Icon Menu 精确/模糊匹配 + Conditional 脚本 dispatch 引用 + 兜底注册标签）。
 */
function refreshRegistryFromSeed() {
    const newCommandBindings: Record<string, CommandBinding> = {};
    for (const row of getSeedCommandRows()) {
        const label = row.label.trim();
        if (label && row.commandID) {
            newCommandBindings[label] = {
                methodName: label,
                commandRef: row.commandID.trim(),
                inputMapping: row.inputMapping.trim(),
                outputMapping: row.outputMapping.trim()
            };
        }
    }
    setCommandBindings(newCommandBindings);

    const newRegistry: SupertagCommand[] = [];
    for (const row of getSeedSupertagRows()) {
        const cleanTag = row.supertag.replace(/\\/g, "").replace(/#/g, "").split("|")[0].split("(")[0].trim().toLowerCase();
        if (!cleanTag) continue;

        const findBinding = (token: string) => {
            const lower = token.toLowerCase();
            const exact = Object.values(newCommandBindings).find(b => b.commandRef.toLowerCase() === lower);
            if (exact) return exact;
            const byName = Object.values(newCommandBindings).find(b => b.methodName.toLowerCase() === lower);
            if (byName) return byName;

            const sysCmd = commandRegistry.getCommand(token);
            if (sysCmd) {
                const hasOutputs = sysCmd.outputs && sysCmd.outputs.length > 0;
                return {
                    methodName: sysCmd.name,
                    commandRef: sysCmd.id,
                    inputMapping: "",
                    outputMapping: hasOutputs ? "{}" : ""
                };
            }
            return undefined;
        };

        // 1. Manual 列：4 态分流分发
        const manualEntries = parseManualConfig(row.manual || row.iconMenu || "");
        const pushEntry = (entry: ManualCommandEntry, uiLocation: "IconMenu" | "Slash" | "Button" | "VirtualButton") => {
            const cmdInfo = findBinding(entry.id);
            if (!cmdInfo) return;
            const hasParams = entry.params && Object.keys(entry.params).length > 0;
            const inputMapping = hasParams ? JSON.stringify(entry.params) : cmdInfo.inputMapping;
            if (!newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === cmdInfo.commandRef && r.uiLocation === uiLocation)) {
                newRegistry.push({
                    typeTag: cleanTag,
                    methodName: cmdInfo.methodName,
                    commandRef: cmdInfo.commandRef,
                    inputMapping,
                    outputMapping: cmdInfo.outputMapping,
                    uiLocation,
                    condition: entry.condition || entry.blockFilter,
                    blockFilter: entry.condition || entry.blockFilter,
                    buttonLabel: entry.buttonLabel
                });
            }
        };
        for (const e of manualEntries) {
            if (e.showInMenu) pushEntry(e, "IconMenu");
            if (e.showInSlash) pushEntry(e, "Slash");
            if (e.showInButton) pushEntry(e, "Button");
            if (e.showInVirtualButton) pushEntry(e, "VirtualButton");
        }

        // 2. Auto 规则脚本中的 dispatch 引用：标记为 BoundOnly
        if (row.auto) {
            const matches = String(row.auto).matchAll(/dispatch\(\s*["']([^"']+)["']/g);
            for (const m of matches) {
                const cmdRef = m[1];
                const foundCmd = Object.values(newCommandBindings).find(c => c.commandRef === cmdRef);
                if (foundCmd
                    && !newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === foundCmd.commandRef && r.uiLocation === "IconMenu")
                    && !newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === foundCmd.commandRef)) {
                    newRegistry.push({ typeTag: cleanTag, methodName: foundCmd.methodName, commandRef: foundCmd.commandRef, inputMapping: foundCmd.inputMapping, outputMapping: foundCmd.outputMapping, uiLocation: "BoundOnly" });
                }
            }
        }

        // 3. 确保标签本身已注册（即使没有绑定任何命令）
        if (!newRegistry.some(r => r.typeTag === cleanTag)) {
            newRegistry.push({ typeTag: cleanTag, methodName: "", commandRef: "", inputMapping: "", outputMapping: "", uiLocation: "IconMenu" });
        }
    }
    setSupertagRegistry(newRegistry);
    console.log(`[Supertag] Registry loaded from seed data: ${Object.keys(newCommandBindings).length} commands, ${newRegistry.length} supertags.`);
}

/**
 * 从 SQLite 引擎刷新注册表 (核心内置数据库逻辑)
 * 已实例化路径：从 av_* 镜像表刷新（数据源是思源 AV，SQLite 仅为查询镜像）。
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

        // 1. Resolve actual SQLite column names for Layer 2 (Command-DB)
        const { db } = await getSqliteEngine();
        let cmdIdCol = "Command_ID";
        let inputCol = "Input";
        let outputCol = "Output";
        try {
            const cmdIdRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Command ID' OR key_name = 'command id' OR key_name = 'Command_ID')`, [cmdAvId]);
            if (cmdIdRes.length > 0 && cmdIdRes[0].values.length > 0) cmdIdCol = String(cmdIdRes[0].values[0][0]);
            const inRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Input' OR key_name = 'input')`, [cmdAvId]);
            if (inRes.length > 0 && inRes[0].values.length > 0) inputCol = String(inRes[0].values[0][0]);
            const outRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Output' OR key_name = 'output')`, [cmdAvId]);
            if (outRes.length > 0 && outRes[0].values.length > 0) outputCol = String(outRes[0].values[0][0]);
        } catch { /* ignore */ }

        // 1. Load Commands (Layer 2)
        const cmdRes = await runQuery(`SELECT rowID, "${commandLabelCol}", "${cmdIdCol}", "${inputCol}", "${outputCol}" FROM ${commandsTable}`);
        if (!cmdRes || !cmdRes.values) return false;

        const newCommandBindings: Record<string, CommandBinding> = {};
        const cmdByRowId: Record<string, CommandBinding> = {};

        for (const row of cmdRes.values) {
            const rowID = String(row[0]);
            const label = row[1];
            const cmdId = row[2];
            const inputMap = row[3];
            const outputMap = row[4];
            if (label && cmdId) {
                const cmdInfo: CommandBinding = {
                    methodName: String(label).trim(),
                    commandRef: String(cmdId).trim(),
                    inputMapping: String(inputMap || "").trim(),
                    outputMapping: String(outputMap || "").trim()
                };
                newCommandBindings[String(label).trim()] = cmdInfo;
                cmdByRowId[rowID] = cmdInfo;
            }
        }
        setCommandBindings(newCommandBindings);

        // 2. Load Type Bindings (Layer 3 - Manual & Auto)
        let manualCol = "Manual";
        let autoCol = "Auto";
        let relatedAvCol = "Related av";
        try {
            const schemaCols = db.exec(`SELECT key_name, col_name FROM _av_schema WHERE av_id = ?`, [tAvId]);
            if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
                for (const row of schemaCols[0].values) {
                    const kName = String(row[0]);
                    const cName = String(row[1]);
                    if (kName === "Manual") {
                        manualCol = cName;
                    } else if (kName === "Auto") {
                        autoCol = cName;
                    } else if (kName === "Related av" || kName === "related_av") {
                        relatedAvCol = cName;
                    }
                }
            }
        } catch { /* ignore */ }

        let querySql = `SELECT "${typeSupertagCol}", "${manualCol}", "${autoCol}", "${relatedAvCol}" FROM ${typesTable}`;
        let typeRes = await runQuery(querySql);
        if (!typeRes || !typeRes.values) {
            // 降级只查 3 列
            querySql = `SELECT "${typeSupertagCol}", "${manualCol}", "${autoCol}" FROM ${typesTable}`;
            typeRes = await runQuery(querySql);
        }

        if (!typeRes || !typeRes.values) return false;

        const newRegistry: SupertagCommand[] = [];
        for (const row of typeRes.values) {
            const typeTagRaw = row[0];
            const manualText = row[1] || "";
            const autoText = row[2] || "";
            const relatedAvText = row[3] || "";

            if (typeTagRaw) {
                const cleanTag = String(typeTagRaw).replace(/\\/g, "").replace(/#/g, "").split("|")[0].split("(")[0].trim().toLowerCase();
                const avId = relatedAvText ? String(relatedAvText).trim() : "";

                // 0. 同步 Related av 关联数据库（若未绑定则自动建库并强绑定；若已绑定则检查重命名联动）
                if (avId) {
                    supertagBinder.setPref(cleanTag, avId);
                    // 检查并联动更新 AV 数据库名称
                    (async () => {
                        try {
                            const { syncSupertagDatabaseName } = await import("../../unified-attributes/core/supertag-schema");
                            await syncSupertagDatabaseName(cleanTag, avId);
                        } catch (_) {}
                    })();
                } else if (cleanTag) {
                    try {
                        const { isIdLike, SYSTEM_EXCLUDED_SUPERTAGS } = await import("../../unified-attributes/core/supertag-entity");
                        if (!isIdLike(cleanTag) && !SYSTEM_EXCLUDED_SUPERTAGS.has(cleanTag)) {
                            const { ensureSupertagDatabase } = await import("../../unified-attributes/core/supertag-schema");
                            ensureSupertagDatabase(cleanTag).catch(err => {
                                console.error(`[Supertag Sync] 自动为 #${cleanTag} 建库绑定异常:`, err);
                            });
                        }
                    } catch (err) {
                        console.error(`[Supertag Sync] 自动为 #${cleanTag} 建库绑定异常:`, err);
                    }
                }

                // 1. Manual 列：4 态分流分发 (;; 面板 / Icon Menu / 块下方实体按钮 / 虚拟悬浮按钮)
                const manualEntries = parseManualConfig(manualText);
                const resolveCmd = (token: string) => {
                    const lower = (token || "").toLowerCase();
                    const exact = Object.values(newCommandBindings).find(b => (b.commandRef || "").toLowerCase() === lower);
                    if (exact) return exact;
                    const byLabel = Object.values(newCommandBindings).find(b => (b.methodName || "").toLowerCase() === lower);
                    if (byLabel) return byLabel;
                    const foundKey = Object.keys(newCommandBindings).find(k =>
                        k.toLowerCase().includes(lower) || (newCommandBindings[k]?.commandRef || "").toLowerCase().includes(lower)
                    );
                    if (foundKey) return newCommandBindings[foundKey];

                    // 兜底：直接从内置 commandRegistry 获取，防止思源 AV 未同步新命令导致抛弃
                    try {
                        const sysCmd = commandRegistry.getCommand(token);
                        if (sysCmd) {
                            const hasOutputs = sysCmd.outputs && sysCmd.outputs.length > 0;
                            return {
                                methodName: sysCmd.name,
                                commandRef: sysCmd.id,
                                inputMapping: "",
                                outputMapping: hasOutputs ? "{}" : ""
                            };
                        }
                    } catch (_) {}
                    return undefined;
                };

                const pushEntry = (entry: ManualCommandEntry, uiLocation: "IconMenu" | "Slash" | "Button" | "VirtualButton") => {
                    const cmdInfo = resolveCmd(entry.id);
                    if (!cmdInfo) return;
                    const hasParams = entry.params && Object.keys(entry.params).length > 0;
                    const inputMapping = hasParams ? JSON.stringify(entry.params) : cmdInfo.inputMapping;
                    if (!newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === cmdInfo.commandRef && r.uiLocation === uiLocation)) {
                        newRegistry.push({
                            typeTag: cleanTag,
                            methodName: cmdInfo.methodName,
                            commandRef: cmdInfo.commandRef,
                            inputMapping,
                            outputMapping: cmdInfo.outputMapping,
                            uiLocation,
                            condition: entry.condition || entry.blockFilter,
                            blockFilter: entry.condition || entry.blockFilter,
                            buttonLabel: entry.buttonLabel
                        });
                    }
                };

                for (const e of manualEntries) {
                    if (e.showInMenu) pushEntry(e, "IconMenu");
                    if (e.showInSlash) pushEntry(e, "Slash");
                    if (e.showInButton) pushEntry(e, "Button");
                    if (e.showInVirtualButton) pushEntry(e, "VirtualButton");
                }

                // 2. 解析 Auto 规则脚本中引用的命令 (如 dispatch("index.safeUpdateBlock"))，标记为 BoundOnly
                if (autoText) {
                    const matches = String(autoText).matchAll(/dispatch\(\s*["']([^"']+)["']/g);
                    for (const m of matches) {
                        const cmdRef = m[1];
                        const foundCmd = Object.values(newCommandBindings).find(c => c.commandRef === cmdRef);
                        if (foundCmd) {
                            const inIconMenu = newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === foundCmd.commandRef && r.uiLocation === "IconMenu");
                            if (!inIconMenu) {
                                const exists = newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === foundCmd.commandRef);
                                if (!exists) {
                                    newRegistry.push({
                                        typeTag: cleanTag,
                                        methodName: foundCmd.methodName,
                                        commandRef: foundCmd.commandRef,
                                        inputMapping: foundCmd.inputMapping,
                                        outputMapping: foundCmd.outputMapping,
                                        uiLocation: "BoundOnly"
                                    });
                                }
                            }
                        }
                    }
                }

                // 确保每一个定义在 supertag-db 中的标签都能作为合法 Supertag 注册
                if (cleanTag && !newRegistry.some(r => r.typeTag === cleanTag)) {
                    newRegistry.push({
                        typeTag: cleanTag,
                        methodName: "",
                        commandRef: "",
                        inputMapping: "",
                        outputMapping: "",
                        uiLocation: "IconMenu"
                    });
                }
            }
        }
        setSupertagRegistry(newRegistry);
        console.log("[Supertag Sync] Registry loaded from SQLite:", { count: newRegistry.length, tags: newRegistry.map(r => r.typeTag) });

        // 触发前端编辑器重新渲染 Supertag 与 Virtual Buttons
        try {
            const { SupertagRenderer } = await import("../../unified-attributes/renderer/SupertagRenderer");
            const activeProtyle = (window as any).activeProtyleInstance || (window as any).siyuan?.ws?.protyle;
            const editorEl = activeProtyle?.element || document.querySelector(".protyle-content") || document.body;
            if (editorEl) {
                SupertagRenderer.renderBlockTags(editorEl as HTMLElement);
            }
        } catch (_) {}

        // 加载并注册复合命令（Pipeline）
        await syncCompositesFromCommandDb();
        return true;
    } catch (e) {
        console.error("[Supertag Sync] refreshRegistryFromSqlite critical error:", e);
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
        const cmdByRowId: Record<string, CommandBinding> = {};

        const newCommandBindings: Record<string, CommandBinding> = {};

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
                        const inputMapping = getCellText("Input") || getCellText("Input Mapping") || getCellText("Param Mapping");
                        const outputMapping = getCellText("Output") || getCellText("Output Mapping");

                        if (pk && cmdId) {
                            const cmdInfo: CommandBinding = {
                                methodName: pk.trim(),
                                commandRef: cmdId.trim(),
                                inputMapping: inputMapping.trim(),
                                outputMapping: outputMapping.trim()
                            };
                            newCommandBindings[pk.trim()] = cmdInfo;
                            cmdByRowId[row.id] = cmdInfo;
                        }
                    }
                    setCommandBindings(newCommandBindings);
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

            const typeTagRaw = getCellText("Supertag") || getCellText("主键") || (row.cells[0]?.value?.block?.content) || "";
            const manualRaw = getCellText("Manual");
            const autoRaw = getCellText("Auto");

            if (typeTagRaw) {
                const cleanTag = typeTagRaw.replace(/\\/g, "").replace(/#/g, "").split("|")[0].split("(")[0].trim().toLowerCase();

                // 1. Manual 列：4 态分流分发
                const manualEntries = parseManualConfig(manualRaw);
                const resolveCmd = (token: string) => {
                    const lower = token.toLowerCase();
                    const exact = Object.values(newCommandBindings).find(b => b.commandRef.toLowerCase() === lower);
                    if (exact) return exact;
                    const byName = Object.values(newCommandBindings).find(b => b.methodName.toLowerCase() === lower);
                    if (byName) return byName;
                    const sysCmd = commandRegistry.getCommand(token);
                    if (sysCmd) {
                        return {
                            methodName: sysCmd.name,
                            commandRef: sysCmd.id,
                            inputMapping: "",
                            outputMapping: ""
                        };
                    }
                    return undefined;
                };

                const pushEntry = (entry: ManualCommandEntry, uiLocation: "IconMenu" | "Slash" | "Button" | "VirtualButton") => {
                    const cmdInfo = resolveCmd(entry.id);
                    if (!cmdInfo) return;
                    const hasParams = entry.params && Object.keys(entry.params).length > 0;
                    const inputMapping = hasParams ? JSON.stringify(entry.params) : cmdInfo.inputMapping;
                    if (!newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === cmdInfo.commandRef && r.uiLocation === uiLocation)) {
                        newRegistry.push({
                            typeTag: cleanTag,
                            methodName: cmdInfo.methodName,
                            commandRef: cmdInfo.commandRef,
                            inputMapping,
                            outputMapping: cmdInfo.outputMapping,
                            uiLocation,
                            condition: entry.condition || entry.blockFilter,
                            blockFilter: entry.condition || entry.blockFilter,
                            buttonLabel: entry.buttonLabel
                        });
                    }
                };
                for (const e of manualEntries) {
                    if (e.showInMenu) pushEntry(e, "IconMenu");
                    if (e.showInSlash) pushEntry(e, "Slash");
                    if (e.showInButton) pushEntry(e, "Button");
                    if (e.showInVirtualButton) pushEntry(e, "VirtualButton");
                }

                // 2. Auto 列：解析 dispatch("...") 引用的命令
                if (autoRaw) {
                    const matches = String(autoRaw).matchAll(/dispatch\(\s*["']([^"']+)["']/g);
                    for (const m of matches) {
                        const cmdRef = m[1];
                        const foundCmd = Object.values(newCommandBindings).find(c => c.commandRef === cmdRef);
                        if (foundCmd && !newRegistry.some(r => r.typeTag === cleanTag && r.commandRef === foundCmd.commandRef)) {
                            newRegistry.push({
                                typeTag: cleanTag,
                                methodName: foundCmd.methodName,
                                commandRef: foundCmd.commandRef,
                                inputMapping: foundCmd.inputMapping,
                                outputMapping: foundCmd.outputMapping,
                                uiLocation: "BoundOnly"
                            });
                        }
                    }
                }

                // 确保每一个定义在 supertag-db 中的标签都能作为合法 Supertag 注册
                if (cleanTag && !newRegistry.some(r => r.typeTag === cleanTag)) {
                    newRegistry.push({
                        typeTag: cleanTag,
                        methodName: "",
                        commandRef: "",
                        inputMapping: "",
                        outputMapping: "",
                        uiLocation: "IconMenu"
                    });
                }
            }
        }
        setSupertagRegistry(newRegistry);
        console.log("[Supertag Sync] Registry loaded from API fallback:", { count: newRegistry.length, tags: newRegistry.map(r => r.typeTag) });
    } catch (e) {
        console.error("[Supertag Sync] API sync failed:", e);
    }
}

export const syncService = {
    refreshSupertagRegistry,
    syncGlobalSupertagsCache
};
