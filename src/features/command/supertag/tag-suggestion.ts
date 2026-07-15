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

    console.log("[Supertag-Selection-Debug] Intercepted supertag selection! Tag:", tag, "BlockId:", blockId);

    // 1. Hide the hint popover immediately
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.classList.add("fn__none");
    }

    // 2. Remove the typed search prefix (e.g. "@@per", ",,per", ";;per") from editor DOM
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

    // 4. Update Siyuan's editor model and attributes simultaneously in ONE atomic transaction
    const oldHTML = blockEl.outerHTML;
    
    const temp = document.createElement("div");
    temp.innerHTML = blockEl.outerHTML;
    const inner = temp.firstElementChild as HTMLElement;
    if (inner) {
        inner.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
    }
    const cleanHTML = temp.innerHTML.trim();

    try {
        protyle.transaction([
            {
                action: "update",
                id: blockId,
                data: cleanHTML
            },
            {
                action: "setAttrs",
                id: blockId,
                data: JSON.stringify({ "custom-supertags": JSON.stringify(updatedCustom) })
            }
        ]);
        
        // Also update HTML attribute in live DOM instantly so visual render matches
        blockEl.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
    } catch (e) {
        console.error("[Supertag] Atomic transaction failed during selection:", e);
    }

    // 5. Trigger commands and render capsule pill
    await supertagMonitor.processNewTag(blockId, tag);
    SupertagRenderer.render(protyle);
}

export function bindProtyleHintExtend(protyle: any) {
    if (!protyle || !protyle.options) return;

    protyle.options.hint = protyle.options.hint || {};
    protyle.options.hint.extend = protyle.options.hint.extend || [];

    // Avoid duplicate registration on the same instance (using "@@" as representative marker)
    const hasRegistered = protyle.options.hint.extend.some((ext: any) => ext.isIndexOS && ext.key === "@@");
    if (hasRegistered) return;

    // Override Siyuan's getKey to support "@@", ",,", and ";;" trigger parsing
    if (protyle.hint && !protyle.hint.isGetKeyOverridden) {
        protyle.hint.isGetKeyOverridden = true;
        const originalGetKey = protyle.hint.getKey;
        protyle.hint.getKey = function (currentLineValue: string, extend: any[]) {
            for (const trigger of ["@@", ",,", ";;"]) {
                const idx = currentLineValue.lastIndexOf(trigger);
                if (idx > -1) {
                    const lineArray = currentLineValue.split(trigger);
                    const lastItem = lineArray[lineArray.length - 1];
                    if (lineArray.length > 1 && lastItem.trimStart() === lastItem && lastItem.length < 32) {
                        this.splitChar = trigger;
                        this.lastIndex = idx;
                        return lastItem;
                    }
                }
            }
            return originalGetKey.call(this, currentLineValue, extend);
        };
    }

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

    // Register extends for all three custom triggers
    for (const key of ["@@", ",,", ";;"]) {
        protyle.options.hint.extend.push({
            key,
            isIndexOS: true, // Marker to avoid duplicates
            hint(value: string, protyleInstance: any, source: string) {
                refreshNativeTagsCache().catch(() => {});

                const query = value.trim().toLowerCase();
                const matchedNative = cachedNativeTags.filter(t => t.toLowerCase().includes(query));

                if (!tagSuggestionState.enabled) {
                    return matchedNative.map(tag => {
                        return {
                            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span></div>`,
                            value: `#${tag}#`,
                            filter: [tag, `#${tag}`, `#${tag}#`]
                        };
                    });
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
                        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span><span class="b3-list-item__meta" style="color: var(--b3-theme-primary); font-weight: bold; margin-left: auto; font-size: 10px;">${badge}</span></div>`,
                        value: `indexos-supertag:${tag}`,
                        filter: [tag, `#${tag}`, `#${tag}#`]
                    };
                });

                const nativeItems = matchedNative
                    .filter(tag => !supertags.has(tag.toLowerCase()))
                    .map(tag => {
                        return {
                            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span></div>`,
                            value: `#${tag}#`,
                            filter: [tag, `#${tag}`, `#${tag}#`]
                        };
                    });

                return [...superItems, ...nativeItems];
            }
        });
    }
}

export async function setTagSuggestionEnabled(enabled: boolean) {
    tagSuggestionState.enabled = enabled;
    if (tagSuggestionState.plugin) {
        await tagSuggestionState.plugin.saveData("tag-suggestion-config.json", {
            enabled: enabled
        });
    }
}
