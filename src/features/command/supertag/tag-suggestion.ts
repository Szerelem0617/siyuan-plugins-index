import { Plugin } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { supertagMonitor } from "./supertag";
import { SUPERTAG_REGISTRY } from "../registration";
import { SupertagRenderer } from "./SupertagRenderer";

export const tagSuggestionState = {
    enabled: false,
    plugin: null as Plugin | null
};

let cachedNativeTags: string[] = [];
let lastNativeFetch = 0;

// Single "@" trigger — safe because "@" has zero special meaning in Siyuan's
// Lute markdown engine, input.ts, or keydown.ts. We just need to manually
// set protyle.hint.enableExtend = true when "@" is typed, since Siyuan only
// auto-enables it for "#", "/", "(", etc (hardcoded list in wysiwyg/index.ts:2765).
const SUPERTAG_TRIGGER = "@";

export async function refreshNativeTagsCache() {
    if (Date.now() - lastNativeFetch < 2000) return;
    lastNativeFetch = Date.now();

    try {
        const tagsRes = await post("/api/tag/getTag", {});
        const rawTags = tagsRes?.data || tagsRes;
        let tagsList: any[] = [];
        if (Array.isArray(rawTags)) {
            tagsList = rawTags;
        } else if (rawTags && Array.isArray(rawTags.tags)) {
            tagsList = rawTags.tags;
        }
        
        cachedNativeTags = tagsList.map(t => {
            if (typeof t === "string") return t;
            return t?.tag || t?.name || "";
        }).filter(Boolean);
    } catch (e) {
        console.error("[TagSuggestion] Failed to refresh native tags cache:", e);
    }
}

export async function initTagSuggestion(plugin: Plugin) {
    tagSuggestionState.plugin = plugin;
    try {
        const config = await plugin.loadData("tag-suggestion-config.json");
        if (config && typeof config.enabled === "boolean") {
            tagSuggestionState.enabled = config.enabled;
        }
    } catch (e) {
        console.error("[TagSuggestion] Failed to load config:", e);
    }

    refreshNativeTagsCache().catch(() => {});
}

async function handleSupertagSelection(tag: string, protyle: any) {
    // Get the ACTUAL editing block from cursor position, NOT protyle.block.id (which is the document root)
    const selection = window.getSelection();
    const range = protyle.toolbar?.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (!range) {
        console.error("[Supertag] No range found");
        return;
    }

    // Walk up from cursor to find the closest block element with data-node-id
    let blockEl: HTMLElement | null = null;
    let node: Node | null = range.startContainer;
    while (node && node !== protyle.wysiwyg?.element) {
        if (node.nodeType === 1) {
            const el = node as HTMLElement;
            if (el.getAttribute("data-node-id") && el.getAttribute("data-type")) {
                blockEl = el;
                break;
            }
        }
        node = node.parentNode;
    }

    if (!blockEl) {
        console.error("[Supertag] Could not find block element from cursor position");
        return;
    }

    const blockId = blockEl.getAttribute("data-node-id")!;
    console.log("[Supertag] Selection intercepted — tag:", tag, "block:", blockId);

    // 1. Hide the hint popover immediately
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.classList.add("fn__none");
    }

    // 2. Capture old HTML BEFORE any DOM changes
    const oldHTML = blockEl.outerHTML;

    // 3. Remove the typed trigger prefix (e.g. "@per") from editor DOM
    if (protyle.hint && protyle.hint.lastIndex > -1 && range) {
        try {
            range.setStart(range.startContainer, protyle.hint.lastIndex);
            range.deleteContents();
        } catch (e) {
            console.error("[Supertag] Failed to delete trigger prefix:", e);
        }
    }

    // 4. Prepare the new supertags array
    let currentCustom: string[] = [];
    const raw = blockEl.getAttribute("custom-supertags");
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) currentCustom = parsed;
        } catch (_) {}
    }
    const updatedCustom = Array.from(new Set([...currentCustom, tag]));
    const updatedCustomJSON = JSON.stringify(updatedCustom);

    // 5. Set the attribute on the live DOM element FIRST
    blockEl.setAttribute("custom-supertags", updatedCustomJSON);

    // 6. Persist the attribute via setBlockAttrs API (most reliable method)
    try {
        await post("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs: {
                "custom-supertags": updatedCustomJSON
            }
        });
        console.log("[Supertag] setBlockAttrs succeeded for block:", blockId);
    } catch (e) {
        console.error("[Supertag] setBlockAttrs API failed:", e);
    }

    // 7. Persist the content change (trigger prefix removal) via updateBlock API
    const newHTML = blockEl.outerHTML;
    if (newHTML !== oldHTML) {
        try {
            await post("/api/block/updateBlock", {
                dataType: "dom",
                data: newHTML,
                id: blockId
            });
        } catch (e) {
            console.error("[Supertag] updateBlock API failed:", e);
        }
    }

    // 8. Trigger supertag commands and render capsule pill
    await supertagMonitor.processNewTag(blockId, tag);
    SupertagRenderer.render(protyle);
}

export function bindProtyleHintExtend(protyle: any) {
    if (!protyle || !protyle.options) return;

    protyle.options.hint = protyle.options.hint || {};
    protyle.options.hint.extend = protyle.options.hint.extend || [];

    // Avoid duplicate registration
    const hasRegistered = protyle.options.hint.extend.some((ext: any) => ext.isIndexOS && ext.key === SUPERTAG_TRIGGER);
    if (hasRegistered) return;

    // --- Critical fix: enable hint extend system when "@" is typed ---
    // Siyuan only sets enableExtend=true for a hardcoded list of chars:
    //   [":", "(", "【", "（", "[", "{", "「", "『", "#", "/", "、"]
    // (see wysiwyg/index.ts:2765)
    // Without enableExtend=true, the hint system bails out at hint/index.ts:137
    // and never calls getKey() or our hint() callback.
    if (protyle.wysiwyg && protyle.wysiwyg.element) {
        protyle.wysiwyg.element.addEventListener("input", (event: InputEvent) => {
            if (event.data === SUPERTAG_TRIGGER && protyle.hint) {
                protyle.hint.enableExtend = true;
            }
        }, true);
    }

    // Intercept mouse clicks on hint menu items (capturing phase)
    // This fires BEFORE Siyuan's bubble-phase handler at hint/index.ts:67,
    // preventing Siyuan's fill() from running for our supertag items.
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.addEventListener("click", async (event: MouseEvent) => {
            const btn = (event.target as HTMLElement).closest(".b3-list-item");
            if (btn) {
                const val = decodeURIComponent(btn.getAttribute("data-value") || "");
                if (val.startsWith("indexos-supertag:")) {
                    event.stopPropagation();
                    event.preventDefault();
                    const tag = val.substring("indexos-supertag:".length);
                    await handleSupertagSelection(tag, protyle);
                }
            }
        }, true);
    }

    // Intercept Enter keypress (capturing phase)
    if (protyle.wysiwyg && protyle.wysiwyg.element) {
        protyle.wysiwyg.element.addEventListener("keydown", async (event: KeyboardEvent) => {
            if (event.key === "Enter" && protyle.hint && protyle.hint.element && !protyle.hint.element.classList.contains("fn__none")) {
                const focusEl = protyle.hint.element.querySelector(".b3-list-item--focus");
                if (focusEl) {
                    const val = decodeURIComponent(focusEl.getAttribute("data-value") || "");
                    if (val.startsWith("indexos-supertag:")) {
                        event.stopPropagation();
                        event.preventDefault();
                        const tag = val.substring("indexos-supertag:".length);
                        await handleSupertagSelection(tag, protyle);
                    }
                }
            }
        }, true);
    }

    // Register the "@" extend trigger
    protyle.options.hint.extend.push({
        key: SUPERTAG_TRIGGER,
        isIndexOS: true,
        hint(value: string, protyleInstance: any, source: string) {
            refreshNativeTagsCache().catch(() => {});
            // Also trigger background registry refresh so list stays strictly in sync with supertag manager
            supertagMonitor.refreshRegistry().catch(() => {});

            const query = value.trim().toLowerCase();

            if (!tagSuggestionState.enabled) {
                return [];
            }

            const dbConfigs = supertagMonitor.getDataRegistry() || [];
            const logicConfigs = SUPERTAG_REGISTRY || [];

            const dataNames = new Set(dbConfigs.map(c => c.typeName.trim().toLowerCase()));
            const logicNames = new Set(logicConfigs.map(l => l.typeTag.trim().toLowerCase()));

            const allSupertags = Array.from(new Set([...dataNames, ...logicNames]));
            const matchedSuper = allSupertags.filter(t => t.includes(query));

            const classItems: any[] = [];
            const dataItems: any[] = [];
            const toolItems: any[] = [];

            matchedSuper.forEach(tag => {
                const isData = dataNames.has(tag);
                const isLogic = logicNames.has(tag);
                
                let badge = "";
                let color = "var(--b3-theme-primary)";
                let itemGroup: any[] = [];

                if (isData && isLogic) {
                    badge = "🐬 类";
                    color = "var(--b3-theme-primary)";
                    itemGroup = classItems;
                } else if (isData) {
                    badge = "🐬 数据组件";
                    color = "#4caf50";
                    itemGroup = dataItems;
                } else {
                    badge = "🐬 工具组件";
                    color = "#ff9800";
                    itemGroup = toolItems;
                }

                itemGroup.push({
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">@${tag}</span><span class="b3-list-item__meta" style="color: ${color}; font-weight: bold; margin-left: auto; font-size: 10px;">${badge}</span></div>`,
                    value: `indexos-supertag:${tag}`,
                    filter: [tag, `@${tag}`]
                });
            });
            return [...classItems, ...dataItems, ...toolItems];
        }
    });
}

export async function setTagSuggestionEnabled(enabled: boolean) {
    tagSuggestionState.enabled = enabled;
    if (tagSuggestionState.plugin) {
        await tagSuggestionState.plugin.saveData("tag-suggestion-config.json", {
            enabled: enabled
        });
    }
}
