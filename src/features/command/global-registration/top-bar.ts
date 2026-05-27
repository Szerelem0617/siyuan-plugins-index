import { plugin } from "../../../shared/utils";
import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { dispatchCommand } from "../command-dispatcher";
import { updateInlineButtonList, InlineButtonCmd } from "./inline-button";
import { updateCommandPaletteList, PaletteCommand } from "./command-palette";
import { getSqliteEngine, runQuery, instantiateAV } from "../../sqlite/sqlite-manager";
import { getTargetTablesInfo, refreshSupertagRegistry, getCommandAvId, getTypeAvId, getCommandDocId, getTypeDocId } from "../registration";
import { initSystemTables } from "../indexos/command-sqlite";

export interface TopBarCommand {
    id: string;
    label: string;
    commandId: string;
    commandParam: string;
    commandType: string;
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

        const cmdRes = await runQuery(`SELECT * FROM ${commandsTable} WHERE Enable = 1`);
        if (!cmdRes || !cmdRes.values) {
            console.warn("[TopBar-SQLite] No enabled commands found in DB.");
            return false;
        }

        console.log(`[TopBar-SQLite] Found ${cmdRes.values.length} enabled commands in ${commandsTable}. Columns:`, cmdRes.columns);

        const newTopBars: TopBarCommand[] = [];
        const newInlineBtns: InlineButtonCmd[] = [];
        const newPaletteCmds: PaletteCommand[] = [];

        const colIdx = (name: string) => {
            const idx = cmdRes.columns.findIndex(c => c.toLowerCase() === name.toLowerCase());
            if (idx === -1) console.error(`[TopBar-SQLite] Column NOT FOUND: ${name}`);
            return idx;
        };

        const idIdx = colIdx("rowID");
        const labelIdx = colIdx(commandLabelCol);
        const cmdIdIdx = colIdx("Command_ID");
        const paramIdx = colIdx("Param_Mapping");
        const typeIdx = colIdx("Command_Type");
        const topBarIdx = colIdx("Top_Bar");
        const ibIdx = colIdx("Inline_Button");
        const paletteIdx = colIdx("Command_Palette");

        for (const [rowIndex, row] of cmdRes.values.entries()) {
            const id = String(row[idIdx]);
            const label = String(row[labelIdx] || "");
            const commandId = String(row[cmdIdIdx] || "");
            const commandParam = String(row[paramIdx] || "");
            const commandType = String(row[typeIdx] || "");
            
            // Critical check: SQLite INTEGER might be returned as number 1
            const isTopBar = Number(row[topBarIdx]) === 1;
            const isIB = Number(row[ibIdx]) === 1;
            const isPalette = Number(row[paletteIdx]) === 1;

            console.log(`[TopBar-SQLite] Row[${rowIndex}] "${label}": Top_Bar=${isTopBar}, Inline_Button=${isIB}, Command_Palette=${isPalette}`);

            if (isTopBar && label && commandId) {
                newTopBars.push({ id, label, commandId, commandParam, commandType });
            }
            if (isIB && label && commandId) {
                newInlineBtns.push({ id, label, commandId, commandParam, commandType });
            }
            if (isPalette && label && commandId) {
                newPaletteCmds.push({ id, label, commandId, commandParam, commandType });
            }
        }

        console.log(`[TopBar-SQLite] Final results: TopBars=${newTopBars.length}, InlineBtns=${newInlineBtns.length}, Palette=${newPaletteCmds.length}`);
        applyTopBarUpdates(newTopBars, newInlineBtns, newPaletteCmds);
        return true;
    } catch (e) {
        console.error("[TopBar-SQLite] Failed to refresh:", e);
        return false;
    }
}

function applyTopBarUpdates(newTopBars: TopBarCommand[], newInlineBtns: InlineButtonCmd[], newPaletteCmds: PaletteCommand[]) {
    if (!plugin) return;

    // 1. Remove all dynamically registered top bar buttons
    for (const rem of registeredTopBars) {
        if (rem.element) rem.element.remove();
    }
    registeredTopBars = [];

    // 2. Do NOT add new commands to the Siyuan topbar anymore (removed as requested)

    updateInlineButtonList(newInlineBtns);
    updateCommandPaletteList(newPaletteCmds);
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
            const commandParam = getCellText("Command Param");
            const commandType = getCellText("Command Type");

            const getBool = (name: string) => {
                const idx = columns.findIndex((c: any) => c.name === name || c.keyName === name);
                if (idx < 0) return false;
                const cell = row.cells[idx];
                return cell?.value?.checkbox?.checked || false;
            }

            if (getBool("Enable") && commandId) {
                if (getBool("Top Bar") && label) newTopBars.push({ id: row.id, label, commandId, commandParam, commandType });
                if (getBool("Inline Button") && label) newInlineBtns.push({ id: row.id, label, commandId, commandParam, commandType });
                if (getBool("Command Palette") && label) newPaletteCmds.push({ id: row.id, label, commandId, commandParam, commandType });
            }
        }

        applyTopBarUpdates(newTopBars, newInlineBtns, newPaletteCmds);
    } catch (e) {
        console.error("[TopBar-API] Failed:", e);
    }
}

let isCommandDbUpdatedGlobal = false;
let isTypeDbUpdatedGlobal = false;

/**
 * Handle database changes and automatically trigger a debounced Top Bar refresh
 */
export function handleTopBarEvents({ detail }: any) {
    if (detail.cmd !== "transactions") return;

    let localCmdUpdate = false;
    let localTypeUpdate = false;

    const cmdAvId = getCommandAvId();
    const cmdDocId = getCommandDocId();
    const tAvId = getTypeAvId();
    const tDocId = getTypeDocId();

    console.log(`[IndexOS-Sync] Received transactions. commandAvId="${cmdAvId}", typeAvId="${tAvId}", commandDocId="${cmdDocId}", typeDocId="${tDocId}"`);

    for (const trans of detail.data) {
        for (const op of trans.doOperations) {
            const opAvId = op.avID || op.avId || "";
            console.log(`[IndexOS-Sync] Operation: action="${op.action}", avID="${opAvId}", id="${op.id}", rootID="${op.rootID}", parentID="${op.parentID}"`);

            // Check if it targets Command-DB
            const isCmdTarget = 
                (cmdAvId && opAvId === cmdAvId) ||
                (cmdDocId && (op.rootID === cmdDocId || op.id === cmdDocId || op.parentID === cmdDocId));
                 
            // Check if it targets Type-DB
            const isTypeTarget = 
                (tAvId && opAvId === tAvId) ||
                (tDocId && (op.rootID === tDocId || op.id === tDocId || op.parentID === tDocId));

            if (isCmdTarget) {
                console.log(`[IndexOS-Sync] Matched Command-DB target!`);
                localCmdUpdate = true;
            }
            if (isTypeTarget) {
                console.log(`[IndexOS-Sync] Matched Type-DB target!`);
                localTypeUpdate = true;
            }
        }
    }

    if (localCmdUpdate || localTypeUpdate) {
        if (localCmdUpdate) isCommandDbUpdatedGlobal = true;
        if (localTypeUpdate) isTypeDbUpdatedGlobal = true;

        console.log(`[IndexOS-Sync] AV updates detected. Queued sync: Command-DB=${isCommandDbUpdatedGlobal}, Type-DB=${isTypeDbUpdatedGlobal}`);

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            const syncCmd = isCommandDbUpdatedGlobal;
            const syncType = isTypeDbUpdatedGlobal;
            
            // Reset global flags before async actions to prevent race conditions
            isCommandDbUpdatedGlobal = false;
            isTypeDbUpdatedGlobal = false;

            try {
                if (syncCmd && cmdAvId) {
                    console.log(`[IndexOS-Sync] Re-instantiating Command-DB AV: ${cmdAvId}`);
                    await instantiateAV(cmdAvId, true);
                }
                if (syncType && tAvId) {
                    console.log(`[IndexOS-Sync] Re-instantiating Type-DB AV: ${tAvId}`);
                    await instantiateAV(tAvId, true);
                }

                // Now refresh the registry and top bars
                console.log(`[IndexOS-Sync] Refreshing registrations and UI...`);
                await refreshSupertagRegistry();
                await refreshTopBarCommands();
            } catch (e) {
                console.error("[IndexOS-Sync] Debounced sync execution failed:", e);
            }
        }, 1500); // 1.5s debounce to allow batch updates to settle
    }
}
