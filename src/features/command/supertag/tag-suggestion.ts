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
    const blockId = protyle.block?.id || protyle.blockId;
    if (!blockId) {
        console.error("[Supertag] No blockId found");
        return;
    }

    // Find block element — search all protyle editors on the page
    let blockEl = protyle.wysiwyg?.element?.querySelector(`[data-node-id="${blockId}"]`);
    if (!blockEl) {
        blockEl = document.querySelector(`[data-node-id="${blockId}"]`);
    }
    if (!blockEl) {
        console.error("[Supertag] Block element not found for id:", blockId);
        return;
    }

    console.log("[Supertag] Selection intercepted — tag:", tag, "block:", blockId);

    // 1. Hide the hint popover immediately
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.classList.add("fn__none");
    }

    // 2. Capture old HTML BEFORE any DOM changes
    const oldHTML = blockEl.outerHTML;

    // 3. Remove the typed trigger prefix (e.g. "@per") from editor DOM
    const selection = window.getSelection();
    const range = protyle.toolbar?.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
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
    //    This is critical — if Siyuan's native input handler fires next,
    //    it will serialize this element's outerHTML (which now includes the attr).
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

    // 7. Also persist the content change (trigger prefix removal) via transactions API
    //    Note: updateTransaction and transaction are standalone functions in Siyuan,
    //    NOT methods on the protyle object. We must call the API directly.
    const newHTML = blockEl.outerHTML;
    if (newHTML !== oldHTML) {
        try {
            await post("/api/transactions", {
                session: window.siyuan?.ws?.app?.appId || "",
                app: window.siyuan?.ws?.app?.appId || "",
                transactions: [{
                    doOperations: [{
                        action: "update",
                        id: blockId,
                        data: newHTML
                    }],
                    undoOperations: [{
                        action: "update",
                        id: blockId,
                        data: oldHTML
                    }]
                }]
            });
        } catch (e) {
            console.error("[Supertag] transactions API failed:", e);
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

            const query = value.trim().toLowerCase();

            if (!tagSuggestionState.enabled) {
                return [];
            }

            const supertags = new Set<string>();

            const dbConfigs = supertagMonitor.getDataRegistry();
            if (dbConfigs) {
                dbConfigs.forEach(c => {
                    if (c.typeName) {
                        supertags.add(c.typeName.trim().toLowerCase());
                    }
                });
            }

            if (SUPERTAG_REGISTRY) {
                SUPERTAG_REGISTRY.forEach(l => {
                    if (l.typeTag) {
                        supertags.add(l.typeTag.trim().toLowerCase());
                    }
                });
            }

            const matchedSuper = Array.from(supertags).filter(t => t.includes(query));

            const isZh = window.siyuan?.config?.lang === "zh_CN";
            const badge = isZh ? "🐬 超级标签" : "🐬 Supertag";

            const superItems = matchedSuper.map(tag => {
                return {
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">@${tag}</span><span class="b3-list-item__meta" style="color: var(--b3-theme-primary); font-weight: bold; margin-left: auto; font-size: 10px;">${badge}</span></div>`,
                    value: `indexos-supertag:${tag}`,
                    filter: [tag, `@${tag}`]
                };
            });

            // Also show native tags as potential supertag candidates
            const matchedNative = cachedNativeTags
                .filter(t => t.toLowerCase().includes(query) && !supertags.has(t.toLowerCase()));

            const nativeAsSuper = matchedNative.map(tag => {
                return {
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">@${tag}</span></div>`,
                    value: `indexos-supertag:${tag}`,
                    filter: [tag, `@${tag}`]
                };
            });

            return [...superItems, ...nativeAsSuper];
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
