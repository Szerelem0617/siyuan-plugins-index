import { type Protyle, type Menu } from "siyuan";
import { dispatchCommand, focusBlockForDispatch, cleanupAfterDispatch } from "./command-dispatcher";
import { addSupertagMenuOption } from "./utils/menu-helper";
import { refreshSupertagRegistry } from "./utils/sync-service";
import { 
    DEV_ENABLE_INIT_SYS, 
    SUPERTAG_REGISTRY, 
    globalSupertagsCache 
} from "./registration";

/**
 * 从缓存同步挂载方法 (同步执行，确保菜单显示)
 */
export function addCommandTestMenuItem({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;

    const blockElements = detail.blockElements;
    const menu = detail.menu;
    if (!blockElements || blockElements.length === 0 || !menu) return;

    const targetEl = blockElements[0] as HTMLElement;

    // 1. 提取当前块的所有标签
    const tagElements = targetEl.querySelectorAll('span[data-type="tag"]');
    const domTags = Array.from(tagElements).map(el => (el.textContent || "").replace(/#/g, "").trim().toLowerCase());
    const inlineTags = Array.from((targetEl.textContent || "").matchAll(/#([^\s#]+)/g)).map(m => m[1].toLowerCase());
    
    // Extract custom supertags from block attribute (or page DOM container if it's title block)
    let customTags: string[] = [];
    const isTitleBlock = targetEl.classList.contains("protyle-title") || targetEl.querySelector(".protyle-title");
    if (isTitleBlock) {
        const docPills = document.querySelectorAll(".index-doc-supertags .index-supertag-pill");
        customTags = Array.from(docPills).map(pill => {
            const text = pill.textContent || "";
            // The pill ends with 'x' to remove it, clean that up
            const cleanText = text.trim();
            if (cleanText.endsWith("x")) {
                return cleanText.substring(0, cleanText.length - 1).trim().toLowerCase();
            }
            return cleanText.toLowerCase();
        }).filter(Boolean);
    } else {
        const rawCustom = targetEl.getAttribute("custom-supertags");
        if (rawCustom) {
            try {
                const parsed = JSON.parse(rawCustom);
                if (Array.isArray(parsed)) {
                    customTags = parsed.map(t => String(t).trim().toLowerCase());
                }
            } catch (_) {}
        }
    }
    
    const currentBlockTags = Array.from(new Set([...domTags, ...inlineTags, ...customTags]));

    if (currentBlockTags.length === 0) return;

    // 2. 在缓存中同步查找匹配项
    let separatorAdded = false;

    for (const tag of currentBlockTags) {
        const matches = SUPERTAG_REGISTRY.filter(item =>
            (item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag))
            && (item.uiLocation === "IconMenu" || item.uiLocation === "BlockIconMenu" || item.uiLocation === "PageMenu")
        );

        if (matches.length > 0) {
            if (!separatorAdded) {
                menu.addSeparator();
                separatorAdded = true;
            }

            for (const match of matches) {
                addSupertagMenuOption(menu, {
                    icon: "iconPlay",
                    label: `⚡ (#${tag}) ${match.methodName}`,
                    click: async () => {
                        const protyleEl = targetEl.closest(".protyle-content") as HTMLElement | null;

                        // 关闭右键菜单
                        try { (window as any).siyuan?.menus?.menu?.remove(); }
                        catch (_) { document.querySelectorAll(".b3-menu").forEach((m: any) => m.remove()); }

                        setTimeout(async () => {
                            try {
                                focusBlockForDispatch(targetEl, protyleEl);
                                // Force reload registry from Siyuan/SQLite to get the latest parameter mappings
                                await refreshSupertagRegistry();
                                const freshMatch = SUPERTAG_REGISTRY.find(item =>
                                    item.commandRef === match.commandRef && item.typeTag === match.typeTag
                                ) || match;

                                await dispatchCommand(freshMatch.commandRef, freshMatch.paramMapping, { blockEl: targetEl, protyleEl, supertag: tag });
                            } catch (err) {
                                console.error("[IndexOS] Command Execution Failed:", err);
                            } finally {
                                setTimeout(() => cleanupAfterDispatch(), 100);
                            }
                        }, 150);
                    }
                });
            }
        }
    }
}

/**
 * Handle document sidebar tree item right click menu
 */
export function addDoctreeMenuItems({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;
    const menu = detail.menu;
    if (!menu || !detail.elements || detail.elements.length === 0) {
        return;
    }

    const el = detail.elements[0];
    const docId = el.getAttribute("data-node-id");
    if (!docId) return;

    try {
        const tags = globalSupertagsCache.get(docId) || [];
        if (tags.length === 0) return;

        for (const tag of tags) {
            const matches = SUPERTAG_REGISTRY.filter(item =>
                (item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag))
                && (item.uiLocation === "IconMenu" || item.uiLocation === "BlockIconMenu" || item.uiLocation === "PageMenu")
            );

            if (matches.length > 0) {
                for (const match of matches) {
                    addSupertagMenuOption(menu, {
                        icon: "iconPlay",
                        label: `⚡ (#${tag}) ${match.methodName}`,
                        click: async () => {
                            await refreshSupertagRegistry();
                            const freshMatch = SUPERTAG_REGISTRY.find(item =>
                                item.commandRef === match.commandRef && item.typeTag === match.typeTag
                            ) || match;
                            
                            const activeProtyle = (window as any).activeProtyleInstance;
                            const protyleEl = activeProtyle?.element || null;
                            const blockEl = protyleEl?.querySelector(`[data-node-id="${docId}"]`) || null;

                            await dispatchCommand(freshMatch.commandRef, freshMatch.paramMapping, { 
                                blockEl: blockEl || document.createElement("div"), 
                                protyleEl, 
                                supertag: tag 
                            });
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error("[IndexOS] Doctree Menu Add Failed:", e);
    }
}

/**
 * Handle editor page title icon click menu
 */
export function addEditorTitleIconMenuItems({ detail }: any) {
    if (!DEV_ENABLE_INIT_SYS) return;
    const menu = detail.menu;
    const protyle = detail.protyle;
    if (!menu || !protyle) {
        return;
    }

    const docId = protyle.block?.rootID || protyle.blockId;
    if (!docId) return;

    try {
        const tags = globalSupertagsCache.get(docId) || [];
        if (tags.length === 0) return;

        for (const tag of tags) {
            const matches = SUPERTAG_REGISTRY.filter(item =>
                (item.typeTag === tag || tag.includes(item.typeTag) || item.typeTag.includes(tag))
                && (item.uiLocation === "IconMenu" || item.uiLocation === "BlockIconMenu" || item.uiLocation === "PageMenu")
            );

            if (matches.length > 0) {
                for (const match of matches) {
                    addSupertagMenuOption(menu, {
                        icon: "iconPlay",
                        label: `⚡ (#${tag}) ${match.methodName}`,
                        click: async () => {
                            await refreshSupertagRegistry();
                            const freshMatch = SUPERTAG_REGISTRY.find(item =>
                                item.commandRef === match.commandRef && item.typeTag === match.typeTag
                            ) || match;
                            
                            const protyleEl = protyle.element || null;
                            const blockEl = protyleEl?.querySelector(`[data-node-id="${docId}"]`) || null;

                            await dispatchCommand(freshMatch.commandRef, freshMatch.paramMapping, { 
                                blockEl: blockEl || document.createElement("div"), 
                                protyleEl, 
                                supertag: tag 
                            });
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error("[IndexOS] Title Icon Menu Add Failed:", e);
    }
}
