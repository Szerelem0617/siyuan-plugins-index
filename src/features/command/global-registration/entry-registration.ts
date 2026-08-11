/**
 * entry-registration.ts
 * 全局入口注册：从 entry-config（位置 → 命令）读取，注册到顶栏/底栏/侧栏/命令按钮/;;菜单/快捷键//菜单。
 */

import { commandRegistry } from "../registry/command-registry";
import { plugin } from "../../../shared/utils";
import { dispatchCommand } from "../command-dispatcher";
import { COMMAND_BINDINGS } from "../registration";
import { updateInlineButtonList, InlineButtonCmd } from "./inline-button";
import { updateCommandPaletteList, PaletteCommand } from "./command-palette";
import { loadEntryConfig, positionCommands } from "../entry-config";
import { updateEntrySlashCommands } from "../../../core/slash";

export interface EntryCommand {
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
        commandParam: binding?.inputMapping || "",
        requiresParams: def && def.params && def.params.length > 0 ? "true" : "false"
    };
}

async function dispatchCommandById(id: string, param: string) {
    console.log(`[Entry Trace] 触发命令入口执行: ${id}`, param);
    try {
        const mockContext = { blockEl: document.body, protyleEl: null };
        await dispatchCommand(id, param, mockContext as any);
    } catch (err) {
        console.error(`💥 [Entry Trace] 入口执行捕获异常:`, err);
    }
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
function createDockItem(barSel: string, tb: EntryCommand): HTMLElement | null {
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
                const current = positionCommands(await loadEntryConfig(), "快捷键");
                if (!current.includes(id)) {
                    console.log(`[Entry] 命令 ${id} 已从『快捷键』位置移除，忽略执行`);
                    return;
                }
                dispatchCommandById(id, meta.commandParam);
            };
            plugin.addCommand({
                langKey: `indexos_${id.replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
                langText: meta.label,
                hotkey: "",
                callback
            });
            registeredNativeCommands.add(id);
            console.log(`[Entry] 原生命令面板注册 ${id}`);
        } catch (e) {
            console.error(`[Entry] 原生命令面板注册失败 ${id}:`, e);
        }
    }
}

/** "/菜单" 位置命令 → slash 菜单项 */
function buildEntrySlashCommands(ids: string[]): any[] {
    return ids.map((id) => {
        const meta = commandMeta(id);
        return {
            filter: [id, meta.label],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${meta.label}</span><span class="b3-list-item__meta">命令</span></div>`,
            id: `entry-${id}`,
            callback: async (protyle: any) => {
                // 捕获当前块上下文（slash 触发后光标位于当前块内）
                const selection = window.getSelection();
                let blockEl: HTMLElement | null = null;
                if (selection && selection.anchorNode) {
                    let node = selection.anchorNode;
                    if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
                    blockEl = (node as HTMLElement)?.closest("[data-node-id]") || null;
                }
                const protyleEl = protyle?.element || (window as any).activeProtyleInstance?.element || null;
                dispatchCommand(id, meta.commandParam, { blockEl: blockEl || document.body, protyleEl } as any);
            }
        };
    });
}

/** 从全局入口配置刷新所有注册面 */
export async function refreshEntryRegistrations() {
    if (!plugin) return;
    const cfg = await loadEntryConfig();

    const newTopBars: EntryCommand[] = [];
    const newStatusBars: EntryCommand[] = [];
    const newDocks: EntryCommand[] = [];
    const newInlineBtns: InlineButtonCmd[] = [];
    const newPaletteCmds: PaletteCommand[] = [];

    syncNativeCommands(positionCommands(cfg, "快捷键"));
    updateEntrySlashCommands(buildEntrySlashCommands(positionCommands(cfg, "/菜单")));

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

    for (const id of positionCommands(cfg, "命令按钮")) {
        const meta = commandMeta(id);
        newInlineBtns.push({ id, label: meta.label, commandId: id, commandParam: meta.commandParam, requiresParams: meta.requiresParams });
    }
    for (const id of positionCommands(cfg, ";;菜单")) {
        const meta = commandMeta(id);
        newPaletteCmds.push({ id, label: meta.label, commandId: id, commandParam: meta.commandParam, requiresParams: meta.requiresParams });
    }

    applyEntryUpdates(newTopBars, newStatusBars, newDocks, newInlineBtns, newPaletteCmds);
    console.log(`[Entry] 入口刷新：顶栏 ${newTopBars.length}，底栏 ${newStatusBars.length}，侧栏 ${newDocks.length}，按钮 ${newInlineBtns.length}，;;菜单 ${newPaletteCmds.length}`);
}

function applyEntryUpdates(
    newTopBars: EntryCommand[],
    newStatusBars: EntryCommand[],
    newDocks: EntryCommand[],
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

export function destroyEntryRegistrations() {
    for (const rem of registeredTopBars) if (rem.element) rem.element.remove();
    registeredTopBars = [];
    for (const rem of registeredStatusBars) if (rem.element) rem.element.remove();
    registeredStatusBars = [];
    for (const rem of registeredDocks) if (rem.element) rem.element.remove();
    registeredDocks = [];
}
