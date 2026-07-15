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
        
        console.log("[TagSuggestion-Debug] Refreshed native tags cache:", cachedNativeTags);
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
    if (!blockId) return;

    const blockEl = protyle.element.querySelector(`[data-node-id="${blockId}"]`);
    if (!blockEl) return;

    // 1. Hide the hint popover immediately
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.classList.add("fn__none");
    }

    // 2. Remove the typed search prefix (e.g. "#per") from editor DOM
    const selection = window.getSelection();
    const range = protyle.toolbar.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (protyle.hint && protyle.hint.lastIndex > -1 && range) {
        try {
            range.setStart(range.startContainer, protyle.hint.lastIndex);
            range.deleteContents();
        } catch (e) {
            console.error("[Supertag] Failed to delete prefix range text:", e);
        }
    }

    // 3. Prepare the new supertags array
    let currentCustom: string[] = [];
    const raw = blockEl.getAttribute("custom-supertags");
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) currentCustom = parsed;
        } catch (_) {}
    }
    const updatedCustom = Array.from(new Set([...currentCustom, tag]));

    // 4. Update the block attributes via API
    await post("/api/attr/setBlockAttrs", {
        id: blockId,
        attrs: {
            "custom-supertags": JSON.stringify(updatedCustom)
        }
    });

    // 5. Update Siyuan's editor model via transaction
    const oldHTML = blockEl.outerHTML;
    
    // We clone the current state of blockEl (since we already deleted the range text from it)
    const temp = document.createElement("div");
    temp.innerHTML = blockEl.outerHTML;
    const inner = temp.firstElementChild as HTMLElement;
    if (inner) {
        inner.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
    }
    const cleanHTML = temp.innerHTML.trim();

    try {
        protyle.updateTransaction(blockId, cleanHTML, oldHTML);
    } catch (e) {
        console.error("[Supertag] updateTransaction failed during selection:", e);
    }

    // 6. Trigger commands and render capsule pill
    await supertagMonitor.processNewTag(blockId, tag);
    SupertagRenderer.render(protyle);
}

export function bindProtyleHintExtend(protyle: any) {
    if (!protyle || !protyle.options) return;

    protyle.options.hint = protyle.options.hint || {};
    protyle.options.hint.extend = protyle.options.hint.extend || [];

    // Avoid duplicate registration on the same instance
    const hasRegistered = protyle.options.hint.extend.some((ext: any) => ext.isIndexOS && ext.key === "#");
    if (hasRegistered) return;

    // Intercept mouse clicks on hint menu items (capturing phase)
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

    // Intercept Enter keypress on WYSIWYG editor (capturing phase)
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

    protyle.options.hint.extend.push({
        key: "#",
        isIndexOS: true, // Marker to avoid duplicates
        hint(value: string, protyleInstance: any, source: string) {
            // Trigger asynchronous background refresh for future keystrokes
            refreshNativeTagsCache().catch(() => {});

            const query = value.trim().toLowerCase();
            const matchedNative = cachedNativeTags.filter(t => t.toLowerCase().includes(query));

            if (!tagSuggestionState.enabled) {
                // If disabled, only return native tags formatted as standard Siyuan tag items
                return matchedNative.map(tag => {
                    return {
                        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span></div>`,
                        value: `#${tag}#`,
                        filter: [tag, `#${tag}`, `#${tag}#`]
                    };
                });
            }

            // If enabled, also add supertags
            const supertags = new Set<string>();

            // 1. Get database supertags
            const dbConfigs = supertagMonitor.getDataRegistry();
            if (dbConfigs) {
                dbConfigs.forEach(c => {
                    if (c.typeName) {
                        supertags.add(c.typeName.trim().toLowerCase());
                    }
                });
            }

            // 2. Get registered command supertags
            if (SUPERTAG_REGISTRY) {
                SUPERTAG_REGISTRY.forEach(l => {
                    if (l.typeTag) {
                        supertags.add(l.typeTag.trim().toLowerCase());
                    }
                });
            }

            // Filter supertags
            const matchedSuper = Array.from(supertags).filter(t => t.includes(query));

            // Map supertags to HintData (distinguished with badge)
            const isZh = window.siyuan?.config?.lang === "zh_CN";
            const badge = isZh ? "🐬 超级标签" : "🐬 Supertag";

            const superItems = matchedSuper.map(tag => {
                return {
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span><span class="b3-list-item__meta" style="color: var(--b3-theme-primary); font-weight: bold; margin-left: auto; font-size: 10px;">${badge}</span></div>`,
                    value: `indexos-supertag:${tag}`,
                    filter: [tag, `#${tag}`, `#${tag}#`]
                };
            });

            // Map native tags to HintData, excluding tags that are already covered by supertags to avoid duplicates
            const nativeItems = matchedNative
                .filter(tag => !supertags.has(tag.toLowerCase()))
                .map(tag => {
                    return {
                        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span></div>`,
                        value: `#${tag}#`,
                        filter: [tag, `#${tag}`, `#${tag}#`]
                    };
                });

            // Combine both: Supertags first, then native tags
            return [...superItems, ...nativeItems];
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
