import { commandRegistry } from "../registry/command-registry";
import { plugin } from "../../../shared/utils";
import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { dispatchCommand } from "../command-dispatcher";
import { updateInlineButtonList, InlineButtonCmd } from "./inline-button";
import { updateCommandPaletteList, PaletteCommand } from "./command-palette";
import { getSqliteEngine, runQuery, instantiateAV, checkTableExists, tableNameToAvId, instantiatedAvIdsCache, tableSyncTimes } from "../../sqlite/sqlite-manager";
import { getCommandAvId, getTypeAvId, getCommandDocId, getTypeDocId } from "../registration";
import { getTargetTablesInfo, refreshSupertagRegistry } from "../utils/sync-service";
import { initSystemTables } from "../indexos/command-sqlite";
import { isDevModeActive } from "../../dev-mode";

export interface TopBarCommand {
    id: string;
    label: string;
    commandId: string;
    commandParam: string;
    requiresParams: string;
}

let registeredTopBars: { id: string, element: HTMLElement }[] = [];
let refreshTimer: any = null;

/**
 * Scan the Command-DB (Layer 2) and read which commands should be placed on the Top Bar 
 */
export async function refreshTopBarCommands() {
    if (!plugin) return;

    try {
        const { db } = await getSqliteEngine();
        if (db) {
            const success = await refreshTopBarFromSqlite();
            if (success) return;
        }
    } catch (e) {
        console.warn("[TopBar] SQLite not ready, falling back to API refresh", e);
    }
    await refreshTopBarFromApi();
}

/**
 * Newer SQLite Source of Truth approach
 */
async function refreshTopBarFromSqlite(): Promise<boolean> {
    try {
        await initSystemTables();
        const { commandsTable, commandLabelCol } = await getTargetTablesInfo();

        // Check and auto-instantiate if table does not exist in SQLite
        if (commandsTable.startsWith("av_")) {
            const exists = await checkTableExists(commandsTable);
            if (!exists) {
                const avId = getCommandAvId() || tableNameToAvId(commandsTable);
                await instantiateAV(avId, true);
            }
        }

        const cmdRes = await runQuery(`SELECT * FROM ${commandsTable}`);
        if (!cmdRes || !cmdRes.values) {
            return false;
        }

        const newTopBars: TopBarCommand[] = [];
        const newInlineBtns: InlineButtonCmd[] = [];
        const newPaletteCmds: PaletteCommand[] = [];

        const colIdx = (name: string) => {
            return cmdRes.columns.findIndex(c => c.toLowerCase() === name.toLowerCase());
        };

        const idIdx = colIdx("rowID");
        const labelIdx = colIdx(commandLabelCol);
        const cmdIdIdx = colIdx("Command_ID");
        const paramIdx = colIdx("Param_Mapping");
        const uiEntriesIdx = colIdx("UI_Entries");

        for (const row of cmdRes.values) {
            const id = String(row[idIdx]);
            const label = String(row[labelIdx] || "");
            const commandId = String(row[cmdIdIdx] || "");
            const commandParam = String(row[paramIdx] || "");
            
            const cmdDef = commandRegistry.getCommand(commandId);
            const requiresParams = (cmdDef && cmdDef.params && cmdDef.params.length > 0) ? "true" : "false";
            
            const uiEntries = uiEntriesIdx > -1 ? String(row[uiEntriesIdx] || "") : "";
            const hasEntry = (type: string) => uiEntries.includes(type);

            if (commandId && label) {
                if (hasEntry("顶栏")) {
                    newTopBars.push({ id, label, commandId, commandParam, requiresParams });
                }
                if (hasEntry("行内按钮")) {
                    newInlineBtns.push({ id, label, commandId, commandParam, requiresParams });
                }
                if (hasEntry("快捷命令")) {
                    newPaletteCmds.push({ id, label, commandId, commandParam, requiresParams });
                }
            }
        }

        applyTopBarUpdates(newTopBars, newInlineBtns, newPaletteCmds);
        return true;
    } catch (e) {
        return false;
    }
}

function applyTopBarUpdates(newTopBars: TopBarCommand[], newInlineBtns: InlineButtonCmd[], newPaletteCmds: PaletteCommand[]) {
    if (!plugin) return;

    // 1. Remove commands that are no longer ticked
    const toRemove = registeredTopBars.filter(r => !newTopBars.find(n => n.id === r.id));
    for (const rem of toRemove) {
        if (rem.element) rem.element.remove();
    }
    registeredTopBars = registeredTopBars.filter(r => newTopBars.find(n => n.id === r.id));

    // 2. Add new commands
    for (const tb of newTopBars) {
        if (!registeredTopBars.find(r => r.id === tb.id)) {
            const el = plugin.addTopBar({
                icon: "iconPlay",
                title: tb.label,
                position: "right",
                callback: () => {
                    console.log(`[TopBar] Executing: ${tb.label}`, tb.commandId);
                    // Mock context for global Top Bar commands
                    const mockContext = { blockEl: document.body, protyleEl: null };
                    dispatchCommand(tb.commandId, tb.commandParam, mockContext as any);
                }
            });
            registeredTopBars.push({ id: tb.id, element: el });
        }
    }

    updateInlineButtonList(newInlineBtns);
    updateCommandPaletteList(newPaletteCmds);
}

export function destroyTopBarCommands() {
    for (const rem of registeredTopBars) {
        if (rem.element) rem.element.remove();
    }
    registeredTopBars = [];
}

/**
 * Original API approach (Fallback)
 */
async function refreshTopBarFromApi() {
    try {
        const sql = `SELECT root_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`;
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

        const newTopBars: TopBarCommand[] = [];
        const newInlineBtns: InlineButtonCmd[] = [];
        const newPaletteCmds: PaletteCommand[] = [];

        for (const row of rows) {
            const getCellText = (colName: string): string => {
                const idx = columns.findIndex((c: any) => c.name === colName || c.keyName === colName);
                if (idx < 0) return "";
                const cell = row.cells[idx];
                return cell?.value?.text?.content || cell?.value?.mText?.content || cell?.value?.block?.content || "";
            };

            let label = getCellText("Primary Key") || (row.cells[0]?.value?.block?.content) || "";
            label = label.replace(/#/g, "").split("|")[0].split("(")[0].trim();
            const commandId = getCellText("Command ID");
            const commandParam = getCellText("Command Param") || getCellText("Param Mapping");
            
            const cmdDef = commandRegistry.getCommand(commandId);
            const requiresParams = (cmdDef && cmdDef.params && cmdDef.params.length > 0) ? "true" : "false";
            
            const uiEntries = getCellText("UI 入口") || getCellText("UI Entries") || getCellText("注册位置") || "";
            const hasEntry = (type: string) => uiEntries.includes(type);

            if (commandId) {
                if (hasEntry("顶栏") && label) newTopBars.push({ id: row.id, label, commandId, commandParam, requiresParams });
                if (hasEntry("行内按钮") && label) newInlineBtns.push({ id: row.id, label, commandId, commandParam, requiresParams });
                if (hasEntry("快捷命令") && label) newPaletteCmds.push({ id: row.id, label, commandId, commandParam, requiresParams });
            }
        }

        applyTopBarUpdates(newTopBars, newInlineBtns, newPaletteCmds);
    } catch (e) {
        console.error("[TopBar-API] Failed:", e);
    }
}

let isCommandDbUpdatedGlobal = false;
let isTypeDbUpdatedGlobal = false;
let userAvUpdates = new Set<string>();

/**
 * Handle database changes and automatically trigger a debounced Top Bar refresh
 */
export async function handleTopBarEvents({ detail }: any) {
    if (detail.cmd !== "transactions") return;

    // Resolve IDs on demand if they aren't initialized yet
    if (!getCommandAvId() || !getTypeAvId()) {
        try {
            await getTargetTablesInfo();
        } catch (e) {
            // passive catch
        }
    }

    const cmdAvId = getCommandAvId();
    const cmdDocId = getCommandDocId();
    const tAvId = getTypeAvId();
    const tDocId = getTypeDocId();

    let localCmdUpdate = false;
    let localTypeUpdate = false;

    for (const trans of detail.data) {
        for (const op of trans.doOperations) {
            const opAvId = op.avID || op.avId || "";

            // Process op

            // Check if it targets Command-DB
            const isCmdTarget = 
                (cmdAvId && opAvId === cmdAvId) ||
                (cmdDocId && (op.rootID === cmdDocId || op.id === cmdDocId || op.parentID === cmdDocId));
                 
            // Check if it targets Type-DB
            const isTypeTarget = 
                (tAvId && opAvId === tAvId) ||
                (tDocId && (op.rootID === tDocId || op.id === tDocId || op.parentID === tDocId));

            if (isCmdTarget) {
                localCmdUpdate = true;
            }
            if (isTypeTarget) {
                localTypeUpdate = true;
            }

            // Check if it targets an instantiated user AV database or active cached table
            if (opAvId && opAvId !== cmdAvId && opAvId !== tAvId && (instantiatedAvIdsCache.has(opAvId) || tableSyncTimes.has(opAvId))) {
                userAvUpdates.add(opAvId);
            }
        }
    }

    if (localCmdUpdate || localTypeUpdate || userAvUpdates.size > 0) {
        if (localCmdUpdate) isCommandDbUpdatedGlobal = true;
        if (localTypeUpdate) isTypeDbUpdatedGlobal = true;

        // Updates detected

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            const syncCmd = isCommandDbUpdatedGlobal;
            const syncType = isTypeDbUpdatedGlobal;
            const userDbsToSync = Array.from(userAvUpdates);
            
            // Reset global flags before async actions to prevent race conditions
            isCommandDbUpdatedGlobal = false;
            isTypeDbUpdatedGlobal = false;
            userAvUpdates.clear();

            try {
                if (syncCmd && cmdAvId) {
                    tableSyncTimes.delete(cmdAvId);
                    await instantiateAV(cmdAvId, true);
                }
                if (syncType && tAvId) {
                    tableSyncTimes.delete(tAvId);
                    await instantiateAV(tAvId, true);
                }
                for (const avId of userDbsToSync) {
                    tableSyncTimes.delete(avId);
                    await instantiateAV(avId, true);
                }

                // Now refresh the registry and top bars
                await refreshSupertagRegistry();
                await refreshTopBarCommands();
            } catch (e) {
                console.error("[IndexOS-Sync] Debounced sync execution failed:", e);
            }
        }, 1500); // 1.5s debounce to allow batch updates to settle
    }
}
