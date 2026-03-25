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
            label = label.replace(/#/g, "").split("|")[0].split("(")[0].trim(); // Apply label processing once
            const commandId = getCellText("Command ID");
            const commandParam = getCellText("Command Param");
            const commandType = getCellText("Command Type");

            // Check if Enable is true
            const enableColIdx = columns.findIndex((c: any) => c.name === "Enable" || c.keyName === "Enable");
            let enableStatus = true;
            if (enableColIdx >= 0) {
                const cell = row.cells[enableColIdx];
                if (cell && cell.value && cell.value.checkbox) {
                    enableStatus = cell.value.checkbox.checked;
                }
            }

            // Check if Top Bar is true
            const topBarColIdx = columns.findIndex((c: any) => c.name === "Top Bar" || c.keyName === "Top Bar");
            let topBarStatus = false;
            if (topBarColIdx >= 0) {
                const cell = row.cells[topBarColIdx];
                if (cell && cell.value && cell.value.checkbox) {
                    topBarStatus = cell.value.checkbox.checked;
                }
            }

            // Check if Inline Button is true
            const ibColIdx = columns.findIndex((c: any) => c.name === "Inline Button" || c.keyName === "Inline Button");
            let ibStatus = false;
            if (ibColIdx >= 0) {
                const cell = row.cells[ibColIdx];
                if (cell && cell.value && cell.value.checkbox) {
                    ibStatus = cell.value.checkbox.checked;
                }
            }

            // Check if Command Palette is true
            const paletteColIdx = columns.findIndex((c: any) => c.name === "Command Palette" || c.keyName === "Command Palette");
            let paletteStatus = false;
            if (paletteColIdx >= 0) {
                const cell = row.cells[paletteColIdx];
                if (cell && cell.value && cell.value.checkbox) {
                    paletteStatus = cell.value.checkbox.checked;
                }
            }


            if (enableStatus && commandId) {
                if (topBarStatus && label) {
                    newTopBars.push({
                        id: row.id,
                        label,
                        commandId,
                        commandParam,
                        commandType
                    });
                } else if (topBarStatus) {
                    console.warn(`[TopBar] Skipped row despite TopBar=true. label="${label}", commandId="${commandId}"`);
                }

                if (ibStatus && label) {
                    newInlineBtns.push({
                        id: row.id,
                        label,
                        commandId,
                        commandParam,
                        commandType
                    });
                }

                // Only push to ;; palette if "Command Palette" column is ticked
                if (paletteStatus && label) {
                    newPaletteCmds.push({
                        id: row.id,
                        label,
                        commandId,
                        commandParam,
                        commandType
                    });
                }
            }
        }


        // 1. Remove commands that are no longer ticked
        const toRemove = registeredTopBars.filter(r => !newTopBars.find(n => n.id === r.id));
        for (const rem of toRemove) {
            if (rem.element) {
                rem.element.remove();
            }
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

        // --- Push to Inline Button Registry ---
        updateInlineButtonList(newInlineBtns);
        // --- Push all enabled commands to the ;; Command Palette ---
        updateCommandPaletteList(newPaletteCmds);

    } catch (e) {
        console.error("[TopBar] Failed to refresh Top Bar registrations:", e);
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
