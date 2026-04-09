import { plugin } from "../../../shared/utils";
import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { dispatchCommand } from "../command-dispatcher";
import { updateInlineButtonList, InlineButtonCmd } from "./inline-button";
import { updateCommandPaletteList, PaletteCommand } from "./command-palette";

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
        const { getSqliteEngine } = await import("../../sqlite/sqlite-manager");
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
        const { getSystemTableNames, initSystemTables } = await import("../../sqlite/indexos/command-sqlite");
        const { runQuery } = await import("../../sqlite/sqlite-manager");

        await initSystemTables();
        const { commands } = getSystemTableNames();

        const cmdRes = await runQuery(`SELECT * FROM ${commands} WHERE enabled = 1`);
        if (!cmdRes || !cmdRes.values) {
            console.warn("[TopBar-SQLite] No enabled commands found in DB.");
            return false;
        }

        console.log(`[TopBar-SQLite] Found ${cmdRes.values.length} enabled commands. Columns:`, cmdRes.columns);

        const newTopBars: TopBarCommand[] = [];
        const newInlineBtns: InlineButtonCmd[] = [];
        const newPaletteCmds: PaletteCommand[] = [];

        const colIdx = (name: string) => {
            const idx = cmdRes.columns.findIndex(c => c.toLowerCase() === name.toLowerCase());
            if (idx === -1) console.error(`[TopBar-SQLite] Column NOT FOUND: ${name}`);
            return idx;
        };

        const idIdx = colIdx("id");
        const labelIdx = colIdx("label");
        const cmdIdIdx = colIdx("commandID");
        const paramIdx = colIdx("paramMapping");
        const typeIdx = colIdx("commandType");
        const topBarIdx = colIdx("topBar");
        const ibIdx = colIdx("inlineButton");
        const paletteIdx = colIdx("commandPalette");

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

            console.log(`[TopBar-SQLite] Row[${rowIndex}] "${label}": topBar=${isTopBar}, ib=${isIB}, palette=${isPalette}`);

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

/**
 * Handle database changes and automatically trigger a debounced Top Bar refresh
 */
export function handleTopBarEvents({ detail }: any) {
    if (detail.cmd !== "transactions") return;

    // We only care about operations that might be AV cell updates (often setting attrs on a block)
    let hasPotentialUpdate = false;
    for (const trans of detail.data) {
        for (const op of trans.doOperations) {
            if (op.action === "update" || op.action === "setAttrs" || op.action === "updateAttrs") {
                hasPotentialUpdate = true;
                break;
            }
        }
        if (hasPotentialUpdate) break;
    }

    if (hasPotentialUpdate) {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTopBarCommands();
        }, 1500); // 1.5s debounce to allow batch updates to settle
    }
}
