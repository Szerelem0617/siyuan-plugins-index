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
import { getSeedCommandRows } from "../indexos/seed-data";

export interface TopBarCommand {
    id: string;
    label: string;
    commandId: string;
    commandParam: string;
    requiresParams: string;
    position?: string;
    barSel?: string;
}

let registeredTopBars: { id: string, element: HTMLElement }[] = [];
let registeredStatusBars: { id: string, element: HTMLElement }[] = [];
let registeredDocks: { id: string, element: HTMLElement, barSel: string }[] = [];
let refreshTimer: any = null;

/** 从 AV 镜像单元格值提取 select 的文本（镜像存的是 JSON 数组） */
function selectContent(raw: string): string {
    const t = String(raw || "").trim();
    if (t.startsWith("[")) {
        try {
            const arr = JSON.parse(t);
            if (Array.isArray(arr) && arr.length > 0) {
                const first = arr[0];
                if (typeof first === "string") return first;
                return first?.content || first?.name || "";
            }
        } catch { /* ignore */ }
    }
    return t;
}

/** "UI 入口" 单选值 → 注册位置 */
function positionFor(uiEntry: string): { kind: "topbar"; position: "right" | "left" } | { kind: "status"; position: "right" | "left" } | { kind: "dock"; barSel: string } | null {
    switch (uiEntry) {
        case "顶栏右": return { kind: "topbar", position: "right" };
        case "顶栏左": return { kind: "topbar", position: "left" };
        case "底栏右": return { kind: "status", position: "right" };
        case "底栏左": return { kind: "status", position: "left" };
        case "侧栏左": return { kind: "dock", barSel: "#dockLeft .dock__items" };
        case "侧栏右": return { kind: "dock", barSel: "#dockRight .dock__items" };
        default: return null;
    }
}

/** 在停靠栏注入命令按钮（侧栏左/右） */
function createDockItem(barSel: string, tb: TopBarCommand): HTMLElement | null {
    const bar = document.querySelector(barSel) as HTMLElement | null;
    if (!bar) return null;
    const btn = document.createElement("div");
    btn.className = "dock__item";
    btn.title = tb.label;
    btn.innerHTML = `<svg style="width:14px;height:14px"><use xlink:href="#iconPlay"></use></svg>`;
    btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:22px;height:22px;margin:2px auto;cursor:pointer;color:var(--b3-theme-on-background);opacity:.85;";
    btn.addEventListener("click", () => {
        console.log(`[TopBar] 侧栏命令: ${tb.label}`, tb.commandId);
        const mockContext = { blockEl: document.body, protyleEl: null };
        dispatchCommand(tb.commandId, tb.commandParam, mockContext as any);
    });
    bar.appendChild(btn);
    return btn;
}

/**
 * Scan the Command-DB (Layer 2) and read which commands should be placed on the Top Bar 
 */
export async function refreshTopBarCommands() {
    if (!plugin) return;

    try {
        const { db } = await getSqliteEngine();
        if (db) {
            const { isInitialized } = await getTargetTablesInfo();
            if (isInitialized) {
                const success = await refreshTopBarFromSqlite();
                if (success) return;
            } else {
                refreshTopBarFromSeed();
                return;
            }
        }
    } catch (e) {
        console.warn("[TopBar] SQLite not ready, falling back to API refresh", e);
    }
    await refreshTopBarFromApi();
}

/**
 * 未实例化路径：从种子常量构建顶栏 / 行内按钮 / 快捷命令列表。
 */
function refreshTopBarFromSeed() {
    const newTopBars: TopBarCommand[] = [];
    const newStatusBars: TopBarCommand[] = [];
    const newDocks: TopBarCommand[] = [];
    const newInlineBtns: InlineButtonCmd[] = [];
    const newPaletteCmds: PaletteCommand[] = [];

    for (const row of getSeedCommandRows()) {
        if (!row.commandID || !row.label) continue;
        const cmdDef = commandRegistry.getCommand(row.commandID);
        const requiresParams = (cmdDef && cmdDef.params && cmdDef.params.length > 0) ? "true" : "false";
        const pos = positionFor(row.uiEntry);
        const hasEntry = (type: string) => row.uiEntries.includes(type);

        if (pos?.kind === "topbar") {
            newTopBars.push({ id: row.rowID, label: row.label, commandId: row.commandID, commandParam: row.paramMapping, requiresParams, position: pos.position });
        }
        if (pos?.kind === "status") {
            newStatusBars.push({ id: row.rowID, label: row.label, commandId: row.commandID, commandParam: row.paramMapping, requiresParams, position: pos.position });
        }
        if (pos?.kind === "dock") {
            newDocks.push({ id: row.rowID, label: row.label, commandId: row.commandID, commandParam: row.paramMapping, requiresParams, barSel: pos.barSel });
        }
        if (hasEntry("行内按钮")) {
            newInlineBtns.push({ id: row.rowID, label: row.label, commandId: row.commandID, commandParam: row.paramMapping, requiresParams });
        }
        if (hasEntry("快捷命令")) {
            newPaletteCmds.push({ id: row.rowID, label: row.label, commandId: row.commandID, commandParam: row.paramMapping, requiresParams });
        }
    }

    applyTopBarUpdates(newTopBars, newStatusBars, newDocks, newInlineBtns, newPaletteCmds);
    console.log(`[TopBar] Loaded ${newTopBars.length} topbars, ${newStatusBars.length} status bars, ${newDocks.length} docks, ${newInlineBtns.length} inline buttons, ${newPaletteCmds.length} palette commands from seed data.`);
}

/**
 * Newer SQLite Source of Truth approach
 */
async function refreshTopBarFromSqlite(): Promise<boolean> {
    try {
        await getSqliteEngine();
        // 先强制同步 AV 镜像，保证用户刚改的单元格值能读到
        const cmdAvId = getCommandAvId();
        if (cmdAvId) {
            await instantiateAV(cmdAvId, true);
        }
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
        const newStatusBars: TopBarCommand[] = [];
        const newDocks: TopBarCommand[] = [];
        const newInlineBtns: InlineButtonCmd[] = [];
        const newPaletteCmds: PaletteCommand[] = [];

        const colIdx = (...names: string[]) => {
            for (const name of names) {
                const cleanTarget = name.toLowerCase().replace(/[\s\-_]/g, "");
                const idx = cmdRes.columns.findIndex(c => c.toLowerCase().replace(/[\s\-_]/g, "") === cleanTarget);
                if (idx !== -1) return idx;
            }
            return -1;
        };

        const idIdx = colIdx("rowID", "id");
        const labelIdx = colIdx(commandLabelCol, "主键", "label");
        const cmdIdIdx = colIdx("Command_ID", "Command ID", "command_id");
        const paramIdx = colIdx("Param_Mapping", "Param Mapping", "param_mapping");
        const uiEntryIdx = colIdx("UI 入口", "UI_入口", "ui_entry");
        const uiEntriesIdx = colIdx("按钮 & 命令面板", "按钮___命令面板", "按钮_命令面板", "ui_entries");

        for (const row of cmdRes.values) {
            const id = String(row[idIdx]);
            const label = String(row[labelIdx] || "");
            const commandId = String(row[cmdIdIdx] || "");
            const commandParam = String(row[paramIdx] || "");
            
            const cmdDef = commandRegistry.getCommand(commandId);
            const requiresParams = (cmdDef && cmdDef.params && cmdDef.params.length > 0) ? "true" : "false";
            
            const uiEntryRaw = uiEntryIdx > -1 ? String(row[uiEntryIdx] || "") : "";
            const uiEntry = selectContent(uiEntryRaw);
            const uiEntries = uiEntriesIdx > -1 ? String(row[uiEntriesIdx] || "") : "";
            const pos = positionFor(uiEntry);
            const hasEntry = (type: string) => uiEntries.includes(type);

            if (commandId && label) {
                if (pos?.kind === "topbar") {
                    newTopBars.push({ id, label, commandId, commandParam, requiresParams, position: pos.position });
                    console.log(`[TopBar] 顶栏注册 ${label} -> ${pos.position}（原始值: ${uiEntryRaw}）`);
                }
                if (pos?.kind === "status") {
                    newStatusBars.push({ id, label, commandId, commandParam, requiresParams, position: pos.position });
                    console.log(`[TopBar] 底栏注册 ${label} -> ${pos.position}（原始值: ${uiEntryRaw}）`);
                }
                if (pos?.kind === "dock") {
                    newDocks.push({ id, label, commandId, commandParam, requiresParams, barSel: pos.barSel });
                    console.log(`[TopBar] 侧栏注册 ${label} -> ${pos.barSel}（原始值: ${uiEntryRaw}）`);
                }
                if (uiEntryRaw && !pos) {
                    console.log(`[TopBar] UI 入口值未匹配: 行=${label} 原始=${uiEntryRaw} 解析=${uiEntry}`);
                }
                if (hasEntry("行内按钮")) {
                    newInlineBtns.push({ id, label, commandId, commandParam, requiresParams });
                }
                if (hasEntry("快捷命令")) {
                    newPaletteCmds.push({ id, label, commandId, commandParam, requiresParams });
                }
            }
        }

        console.log(`[TopBar] SQLite 刷新：顶栏 ${newTopBars.length}，底栏 ${newStatusBars.length}，侧栏 ${newDocks.length}，行内 ${newInlineBtns.length}，面板 ${newPaletteCmds.length}`);
        applyTopBarUpdates(newTopBars, newStatusBars, newDocks, newInlineBtns, newPaletteCmds);
        return true;
    } catch (e) {
        return false;
    }
}

function applyTopBarUpdates(
    newTopBars: TopBarCommand[],
    newStatusBars: TopBarCommand[],
    newDocks: TopBarCommand[],
    newInlineBtns: InlineButtonCmd[],
    newPaletteCmds: PaletteCommand[]
) {
    if (!plugin) return;

    // 1. Remove commands that are no longer ticked
    const toRemove = registeredTopBars.filter(r => !newTopBars.find(n => n.id === r.id));
    for (const rem of toRemove) {
        if (rem.element) rem.element.remove();
    }
    registeredTopBars = registeredTopBars.filter(r => newTopBars.find(n => n.id === r.id));
    const toRemoveStatus = registeredStatusBars.filter(r => !newStatusBars.find(n => n.id === r.id));
    for (const rem of toRemoveStatus) {
        if (rem.element) rem.element.remove();
    }
    registeredStatusBars = registeredStatusBars.filter(r => newStatusBars.find(n => n.id === r.id));
    const toRemoveDocks = registeredDocks.filter(r => !newDocks.find(n => n.id === r.id));
    for (const rem of toRemoveDocks) {
        if (rem.element) rem.element.remove();
    }
    registeredDocks = registeredDocks.filter(r => newDocks.find(n => n.id === r.id));

    // 2. Add new topbar commands
    for (const tb of newTopBars) {
        if (!registeredTopBars.find(r => r.id === tb.id)) {
            const el = plugin.addTopBar({
                icon: "iconPlay",
                title: tb.label,
                position: tb.position === "left" ? "left" : "right",
                callback: () => {
                    console.log(`[TopBar] Executing: ${tb.label}`, tb.commandId);
                    const mockContext = { blockEl: document.body, protyleEl: null };
                    dispatchCommand(tb.commandId, tb.commandParam, mockContext as any);
                }
            });
            registeredTopBars.push({ id: tb.id, element: el });
        }
    }

    // 3. Add new status bar commands（底栏）
    for (const tb of newStatusBars) {
        if (!registeredStatusBars.find(r => r.id === tb.id)) {
            const btn = document.createElement("button");
            btn.className = "indexos-status-btn";
            btn.innerHTML = `<svg style="width:13px;height:13px;fill:currentColor;flex-shrink:0"><use xlink:href="#iconPlay"></use></svg><span style="font-size:11px;margin-left:3px;">${tb.label}</span>`;
            btn.style.cssText = "display:inline-flex;align-items:center;gap:3px;padding:0 6px;background:none;border:none;color:var(--b3-theme-on-surface);cursor:pointer;opacity:.8;";
            btn.title = tb.label;
            btn.addEventListener("click", () => {
                console.log(`[TopBar] Executing status bar command: ${tb.label}`, tb.commandId);
                const mockContext = { blockEl: document.body, protyleEl: null };
                dispatchCommand(tb.commandId, tb.commandParam, mockContext as any);
            });
            plugin.addStatusBar({
                element: btn,
                position: tb.position === "left" ? "left" : "right"
            });
            registeredStatusBars.push({ id: tb.id, element: btn });
        }
    }

    // 4. Add new dock commands（侧栏）
    for (const tb of newDocks) {
        if (!registeredDocks.find(r => r.id === tb.id)) {
            const el = createDockItem(tb.barSel || "#dockLeft .dock__items", tb);
            if (el) {
                registeredDocks.push({ id: tb.id, element: el, barSel: tb.barSel || "#dockLeft .dock__items" });
                console.log(`[TopBar] 侧栏注册 ${tb.label} -> ${tb.barSel}`);
            }
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
    for (const rem of registeredStatusBars) {
        if (rem.element) rem.element.remove();
    }
    registeredStatusBars = [];
    for (const rem of registeredDocks) {
        if (rem.element) rem.element.remove();
    }
    registeredDocks = [];
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
        const newStatusBars: TopBarCommand[] = [];
        const newDocks: TopBarCommand[] = [];
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
            
            const uiEntry = selectContent(getCellText("UI 入口") || getCellText("UI Entries") || getCellText("注册位置") || "");
            const uiEntries = getCellText("按钮 & 命令面板") || "";
            const pos = positionFor(uiEntry);
            const hasEntry = (type: string) => uiEntries.includes(type);

            if (commandId) {
                if (pos?.kind === "topbar" && label) newTopBars.push({ id: row.id, label, commandId, commandParam, requiresParams, position: pos.position });
                if (pos?.kind === "status" && label) newStatusBars.push({ id: row.id, label, commandId, commandParam, requiresParams, position: pos.position });
                if (pos?.kind === "dock" && label) newDocks.push({ id: row.id, label, commandId, commandParam, requiresParams, barSel: pos.barSel });
                if (hasEntry("行内按钮") && label) newInlineBtns.push({ id: row.id, label, commandId, commandParam, requiresParams });
                if (hasEntry("快捷命令") && label) newPaletteCmds.push({ id: row.id, label, commandId, commandParam, requiresParams });
            }
        }

        applyTopBarUpdates(newTopBars, newStatusBars, newDocks, newInlineBtns, newPaletteCmds);
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
