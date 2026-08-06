/**
 * top-bar.ts
 * 全局入口注册：从 entry-config（位置 → 命令）读取，注册到顶栏/底栏/侧栏/行内按钮/命令面板。
 */

import { commandRegistry } from "../registry/command-registry";
import { plugin } from "../../../shared/utils";
import { dispatchCommand } from "../command-dispatcher";
import { COMMAND_BINDINGS } from "../registration";
import { updateInlineButtonList, InlineButtonCmd } from "./inline-button";
import { updateCommandPaletteList, PaletteCommand } from "./command-palette";
import { loadEntryConfig, positionCommands } from "../entry-config";

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
const registeredNativeCommands = new Set<string>();

function commandMeta(id: string): { label: string; commandParam: string; requiresParams: string } {
    const def = commandRegistry.getCommand(id);
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === id);
    return {
        label: def?.name || id,
        commandParam: binding?.paramMapping || "",
        requiresParams: def && def.params && def.params.length > 0 ? "true" : "false"
    };
}

function dispatchCommandById(id: string, param: string) {
    console.log(`[TopBar] 执行命令: ${id}`, param);
    const mockContext = { blockEl: document.body, protyleEl: null };
    dispatchCommand(id, param, mockContext as any);
}

/** 顶栏/底栏/侧栏 位置映射 */
function positionFor(position: string): { kind: "topbar"; position: "right" | "left" } | { kind: "status"; position: "right" | "left" } | { kind: "dock"; barSel: string } | null {
    switch (position) {
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
    btn.addEventListener("click", () => dispatchCommandById(tb.commandId, tb.commandParam));
    bar.appendChild(btn);
    return btn;
}

/** 注册原生命令面板命令（Ctrl+P + 可绑快捷键） */
function syncNativeCommands(ids: string[]) {
    for (const id of ids) {
        if (registeredNativeCommands.has(id)) continue;
        const meta = commandMeta(id);
        try {
            const callback = async () => {
                // 原生命令注册后无法在会话内注销（思源插件 API 无 removeCommand），
                // 执行前检查是否仍在配置中，避免执行已移除的过期命令
                const current = positionCommands(await loadEntryConfig(), "命令面板");
                if (!current.includes(id)) {
                    console.log(`[TopBar] 命令 ${id} 已从『命令面板』移除，忽略执行`);
                    return;
                }
                dispatchCommandById(id, meta.commandParam);
            };
            plugin.addCommand({
                langKey: `indexos_${id.replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
                hotkey: "",
                callback
            });
            registeredNativeCommands.add(id);
            console.log(`[TopBar] 原生命令面板注册 ${id}`);
        } catch (e) {
            console.error(`[TopBar] 原生命令面板注册失败 ${id}:`, e);
        }
    }
}

/** 从全局入口配置刷新所有注册面 */
export async function refreshTopBarCommands() {
    if (!plugin) return;
    const cfg = await loadEntryConfig();

    const newTopBars: TopBarCommand[] = [];
    const newStatusBars: TopBarCommand[] = [];
    const newDocks: TopBarCommand[] = [];
    const newInlineBtns: InlineButtonCmd[] = [];
    const newPaletteCmds: PaletteCommand[] = [];

    syncNativeCommands(positionCommands(cfg, "命令面板"));

    for (const [posName, cmdIds] of Object.entries(cfg.positions)) {
        const pos = positionFor(posName);
        for (const id of cmdIds.map(e => typeof e === "string" ? e : e.id).filter(Boolean)) {
            const meta = commandMeta(id);
            if (pos?.kind === "topbar") {
                newTopBars.push({ id, label: meta.label, commandId: id, commandParam: meta.commandParam, requiresParams: meta.requiresParams, position: pos.position });
            } else if (pos?.kind === "status") {
                newStatusBars.push({ id, label: meta.label, commandId: id, commandParam: meta.commandParam, requiresParams: meta.requiresParams, position: pos.position });
            } else if (pos?.kind === "dock") {
                newDocks.push({ id, label: meta.label, commandId: id, commandParam: meta.commandParam, requiresParams: meta.requiresParams, barSel: pos.barSel });
            }
        }
    }

    for (const id of positionCommands(cfg, "行内按钮")) {
        const meta = commandMeta(id);
        newInlineBtns.push({ id, label: meta.label, commandId: id, commandParam: meta.commandParam, requiresParams: meta.requiresParams });
    }
    for (const id of positionCommands(cfg, "快捷命令")) {
        const meta = commandMeta(id);
        newPaletteCmds.push({ id, label: meta.label, commandId: id, commandParam: meta.commandParam, requiresParams: meta.requiresParams });
    }

    applyTopBarUpdates(newTopBars, newStatusBars, newDocks, newInlineBtns, newPaletteCmds);
    console.log(`[TopBar] 入口刷新：顶栏 ${newTopBars.length}，底栏 ${newStatusBars.length}，侧栏 ${newDocks.length}，行内 ${newInlineBtns.length}，面板 ${newPaletteCmds.length}`);
}

function applyTopBarUpdates(
    newTopBars: TopBarCommand[],
    newStatusBars: TopBarCommand[],
    newDocks: TopBarCommand[],
    newInlineBtns: InlineButtonCmd[],
    newPaletteCmds: PaletteCommand[]
) {
    if (!plugin) return;

    const toRemove = registeredTopBars.filter(r => !newTopBars.find(n => n.id === r.id));
    for (const rem of toRemove) if (rem.element) rem.element.remove();
    registeredTopBars = registeredTopBars.filter(r => newTopBars.find(n => n.id === r.id));

    const toRemoveStatus = registeredStatusBars.filter(r => !newStatusBars.find(n => n.id === r.id));
    for (const rem of toRemoveStatus) if (rem.element) rem.element.remove();
    registeredStatusBars = registeredStatusBars.filter(r => newStatusBars.find(n => n.id === r.id));

    const toRemoveDocks = registeredDocks.filter(r => !newDocks.find(n => n.id === r.id));
    for (const rem of toRemoveDocks) if (rem.element) rem.element.remove();
    registeredDocks = registeredDocks.filter(r => newDocks.find(n => n.id === r.id));

    for (const tb of newTopBars) {
        if (!registeredTopBars.find(r => r.id === tb.id)) {
            const el = plugin.addTopBar({
                icon: "iconPlay",
                title: tb.label,
                position: tb.position === "left" ? "left" : "right",
                callback: () => dispatchCommandById(tb.commandId, tb.commandParam)
            });
            registeredTopBars.push({ id: tb.id, element: el });
        }
    }

    for (const tb of newStatusBars) {
        if (!registeredStatusBars.find(r => r.id === tb.id)) {
            const btn = document.createElement("button");
            btn.innerHTML = `<svg style="width:13px;height:13px;fill:currentColor;flex-shrink:0"><use xlink:href="#iconPlay"></use></svg><span style="font-size:11px;margin-left:3px;">${tb.label}</span>`;
            btn.style.cssText = "display:inline-flex;align-items:center;gap:3px;padding:0 6px;background:none;border:none;color:var(--b3-theme-on-surface);cursor:pointer;opacity:.8;";
            btn.title = tb.label;
            btn.addEventListener("click", () => dispatchCommandById(tb.commandId, tb.commandParam));
            plugin.addStatusBar({ element: btn, position: tb.position === "left" ? "left" : "right" });
            registeredStatusBars.push({ id: tb.id, element: btn });
        }
    }

    for (const tb of newDocks) {
        if (!registeredDocks.find(r => r.id === tb.id)) {
            const el = createDockItem(tb.barSel || "#dockLeft .dock__items", tb);
            if (el) registeredDocks.push({ id: tb.id, element: el, barSel: tb.barSel || "#dockLeft .dock__items" });
        }
    }

    updateInlineButtonList(newInlineBtns);
    updateCommandPaletteList(newPaletteCmds);
}

export function destroyTopBarCommands() {
    for (const rem of registeredTopBars) if (rem.element) rem.element.remove();
    registeredTopBars = [];
    for (const rem of registeredStatusBars) if (rem.element) rem.element.remove();
    registeredStatusBars = [];
    for (const rem of registeredDocks) if (rem.element) rem.element.remove();
    registeredDocks = [];
}
