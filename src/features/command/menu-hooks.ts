/**
 * menu-hooks.ts
 * 包含全流程 Debug 日志的菜单注入 Hook
 */

import { commandRegistry } from "./registry/command-registry";
import { dispatchCommand } from "./command-dispatcher";
import { COMMAND_BINDINGS } from "./registration";
import { getEntryConfigSync, positionCommands, blockMenuEntries, blockTypeOf, type BlockMenuEntry } from "./entry-config";

/** 统一使用思源官方标准 menu.addItem 注入菜单项 */
function addMenuEntry(
    menu: any,
    blockType: string | null,
    entry: BlockMenuEntry,
    blockEl: HTMLElement | null,
    protyleEl: HTMLElement | null
): boolean {
    if (blockType && entry.types && entry.types.length > 0 && !entry.types.includes(blockType)) {
        return false;
    }
    const def = commandRegistry.getCommand(entry.id);
    const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === entry.id);
    const paramMapping = binding?.inputMapping || "";
    const label = `⚡ ${def?.name || entry.id}`;

    const click = async () => {
        console.log(`🖱️ [MenuHooks Trace] 菜单项被点击触发命令: "${entry.id}" | label="${label}"`);
        try {
            const ctx = { blockEl: blockEl || document.body, protyleEl, supertag: "" };
            await dispatchCommand(entry.id, paramMapping, ctx as any);
        } catch (err) {
            console.error(`💥 [MenuHooks Trace] 菜单项点击抛出异常:`, err);
        }
    };

    if (menu && typeof menu.addItem === "function") {
        menu.addItem({
            icon: "iconPlay",
            label,
            click
        });
        return true;
    }
    return false;
}

function addEntryMenuSection(detail: any, position: "块菜单" | "页面菜单" | "编辑器菜单") {
    const cfg = getEntryConfigSync();

    const entries = position === "块菜单"
        ? blockMenuEntries(cfg)
        : positionCommands(cfg, position).map(id => ({ id }) as BlockMenuEntry);

    if (entries.length === 0) return;

    const menu = detail?.menu;
    if (!menu || typeof menu.addItem !== "function") return;

    const blockEl = (detail.blockElements?.[0] || detail.elements?.[0]) as HTMLElement | null;
    const blockType = blockEl ? blockTypeOf(blockEl.getAttribute("data-type") || "") : null;
    const protyleEl = detail.protyle?.element || detail.protyle || null;

    let added = 0;
    for (const e of entries) {
        if (addMenuEntry(menu, blockType, e, blockEl, protyleEl)) added++;
    }

    if (added > 0) {
        try {
            menu.addSeparator();
        } catch (_) {}
    }
}

export function addBlockEntryMenuItems({ detail }: any) {
    addEntryMenuSection(detail, "块菜单");
}

export function addPageEntryMenuItems({ detail }: any) {
    addEntryMenuSection(detail, "页面菜单");
}

export function addEditorEntryMenuItems({ detail }: any) {
    addEntryMenuSection(detail, "编辑器菜单");
}

export function addCommandTestMenuItem({ detail }: any) {}
export function addDoctreeMenuItems({ detail }: any) {}
export function addEditorTitleIconMenuItems({ detail }: any) {}

