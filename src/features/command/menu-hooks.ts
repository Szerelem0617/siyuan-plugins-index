/**
 * menu-hooks.ts
 * 包含全流程 Block Icon 菜单与 Supertag Icon Menu 命令动态注入
 */

import { commandRegistry } from "./registry/command-registry";
import { dispatchCommand } from "./command-dispatcher";
import { COMMAND_BINDINGS, SUPERTAG_REGISTRY } from "./registration";
import { getEntryConfigSync, positionCommands, blockMenuEntries, blockTypeOf, type BlockMenuEntry } from "./entry-config";
import { parseSupertags } from "./supertag/core/supertag-diff";

/** 提取当前块或页面中绑定的所有 Supertag 名称 */
function extractSupertagsFromBlock(blockEl: HTMLElement | null, protyleEl: HTMLElement | null): string[] {
    const tagsSet = new Set<string>();

    const checkElement = (el: HTMLElement) => {
        if (!el) return;
        // 1. 读取属性 custom-supertags (思源超级标签核心属性)
        const rawCustomSupertags = el.getAttribute("custom-supertags");
        if (rawCustomSupertags) {
            parseSupertags(rawCustomSupertags).forEach(t => tagsSet.add(t.toLowerCase()));
        }
        // 2. 兼容读取 custom-index-tags, tag, tags
        const altTags = el.getAttribute("custom-index-tags") || el.getAttribute("tag") || el.getAttribute("tags") || "";
        if (altTags) {
            altTags.split(/[,\s]+/).forEach(t => {
                const clean = t.trim().replace(/^#/, "").toLowerCase();
                if (clean) tagsSet.add(clean);
            });
        }
        // 3. 读取 DOM 内思源标签节点 span[data-type="tag"]
        const tagDoms = el.querySelectorAll('span[data-type="tag"]');
        tagDoms.forEach(tagDom => {
            const txt = (tagDom.textContent || "").trim().replace(/^#/, "").toLowerCase();
            if (txt) tagsSet.add(txt);
        });
    };

    if (blockEl) {
        checkElement(blockEl);
        const parentBlock = blockEl.parentElement?.closest("[data-node-id]") as HTMLElement;
        if (parentBlock) checkElement(parentBlock);
    }

    if (protyleEl) {
        const titleEl = protyleEl.querySelector(".protyle-title") as HTMLElement;
        if (titleEl) checkElement(titleEl);
    } else {
        const titleEl = document.querySelector(".protyle-title") as HTMLElement;
        if (titleEl) checkElement(titleEl);
    }

    return Array.from(tagsSet);
}

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
        try {
            const vars: Record<string, any> = {};
            if (blockEl && blockEl.attributes) {
                for (const attr of Array.from(blockEl.attributes)) {
                    if (attr.name.startsWith("custom-")) {
                        const rawClean = attr.name.replace(/^custom-/, "");
                        const baseKey = rawClean.replace(/^var-/, "");
                        vars[attr.name] = attr.value;
                        vars[rawClean] = attr.value;
                        vars[baseKey] = attr.value;
                        vars[`var.${baseKey}`] = attr.value;
                        vars[`{{var.${baseKey}}}`] = attr.value;
                    }
                }
            }
            const tags = extractSupertagsFromBlock(blockEl, protyleEl);
            const activeSupertag = tags.length > 0 ? tags[0] : "";
            const ctx = { blockEl: blockEl || document.body, protyleEl, supertag: activeSupertag, vars };
            await dispatchCommand(entry.id, paramMapping, ctx as any);
        } catch (err) {
            console.error(`[MenuHooks] 菜单项点击执行异常:`, err);
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

/** 动态检索并注入当前块/页面上 Supertag 绑定的 IconMenu 命令 */
function addSupertagIconMenuItems(menu: any, blockEl: HTMLElement | null, protyleEl: HTMLElement | null): number {
    const tags = extractSupertagsFromBlock(blockEl, protyleEl);
    if (tags.length === 0) return 0;

    let addedCount = 0;
    const addedCmdIds = new Set<string>();

    for (const tag of tags) {
        // 在 SUPERTAG_REGISTRY 中匹配该 Supertag 显式绑定到 Icon Menu 的命令
        const matchedEntries = SUPERTAG_REGISTRY.filter(item =>
            item.typeTag.toLowerCase() === tag &&
            item.uiLocation === "IconMenu" &&
            item.commandRef
        );

        for (const entry of matchedEntries) {
            if (addedCmdIds.has(entry.commandRef)) continue;
            addedCmdIds.add(entry.commandRef);

            const def = commandRegistry.getCommand(entry.commandRef) || commandRegistry.findByNameOrId(entry.commandRef);
            const label = `🏷️ #${tag} » ${def?.name || entry.commandRef}`;

            menu.addItem({
                icon: "iconTags",
                label,
                click: async () => {
                    const vars: Record<string, any> = {};
                    if (blockEl && blockEl.attributes) {
                        for (const attr of Array.from(blockEl.attributes)) {
                            if (attr.name.startsWith("custom-")) {
                                const rawClean = attr.name.replace(/^custom-/, "");
                                const baseKey = rawClean.replace(/^var-/, "");
                                vars[attr.name] = attr.value;
                                vars[rawClean] = attr.value;
                                vars[baseKey] = attr.value;
                                vars[`var.${baseKey}`] = attr.value;
                                vars[`{{var.${baseKey}}}`] = attr.value;
                            }
                        }
                    }
                    const ctx = { blockEl: blockEl || document.body, protyleEl, supertag: tag, vars };
                    await dispatchCommand(entry.commandRef, entry.inputMapping || "", ctx as any);
                }
            });
            addedCount++;
        }
    }
    return addedCount;
}

function addEntryMenuSection(detail: any, position: "块菜单" | "页面菜单" | "编辑器菜单") {
    const cfg = getEntryConfigSync();

    const entries = position === "块菜单"
        ? blockMenuEntries(cfg)
        : positionCommands(cfg, position).map(id => ({ id }) as BlockMenuEntry);

    const menu = detail?.menu;
    if (!menu || typeof menu.addItem !== "function") return;

    const blockEl = (detail.blockElements?.[0] || detail.elements?.[0]) as HTMLElement | null;
    const blockType = blockEl ? blockTypeOf(blockEl.getAttribute("data-type") || "") : null;
    const protyleEl = detail.protyle?.element || detail.protyle || null;

    let added = 0;
    for (const e of entries) {
        if (addMenuEntry(menu, blockType, e, blockEl, protyleEl)) added++;
    }

    // 动态注入 Supertag Icon Menu 命令
    const supertagMenuAdded = addSupertagIconMenuItems(menu, blockEl, protyleEl);
    added += supertagMenuAdded;

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
