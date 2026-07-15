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

// The trigger character for supertags. We use "@" (double "@@") because:
// 1. "#" is impossible — Siyuan's Lute engine runs SpinBlockDOM on every input
//    event, which strips "##" as an empty/invalid tag. No plugin-level fix exists.
// 2. "@" has zero special handling in Siyuan's Lute, input.ts, or keydown.ts.
// 3. We must manually set protyle.hint.enableExtend = true on "@" input,
//    since Siyuan only auto-enables it for "#", "/", "(", etc.
const SUPERTAG_TRIGGER = "@@";
const TRIGGER_CHAR = "@";

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

    console.log("[Supertag] Selection intercepted — tag:", tag, "block:", blockId);

    // 1. Hide the hint popover immediately
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.classList.add("fn__none");
    }

    // 2. Remove the typed trigger prefix (e.g. "@@per") from editor DOM
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

    // 4. Update block via setBlockAttrs API (most reliable, bypasses DOM race conditions)
    try {
        await post("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs: {
                "custom-supertags": JSON.stringify(updatedCustom)
            }
        });
    } catch (e) {
        console.error("[Supertag] setBlockAttrs API failed:", e);
    }

    // 5. Update editor DOM via updateTransaction to persist content changes
    const oldHTML = blockEl.outerHTML;
    const temp = document.createElement("div");
    temp.innerHTML = blockEl.outerHTML;
    const inner = temp.firstElementChild as HTMLElement;
    if (inner) {
        inner.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
    }
    const cleanHTML = temp.innerHTML.trim();

    try {
        if (typeof protyle.updateTransaction === "function") {
            protyle.updateTransaction(blockId, cleanHTML, oldHTML);
        }
    } catch (e) {
        console.error("[Supertag] updateTransaction failed:", e);
    }

    // Also update live DOM so visual render matches immediately
    blockEl.setAttribute("custom-supertags", JSON.stringify(updatedCustom));

    // 6. Trigger commands and render capsule pill
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

    // --- Critical: enable hint.enableExtend when "@" is typed ---
    // Siyuan only sets enableExtend=true for a hardcoded list of chars ("#", "/", "(", etc).
    // "@" is not in that list, so the hint system silently ignores our extend.
    // We fix this by listening for "@" input and flipping the flag ourselves.
    if (protyle.wysiwyg && protyle.wysiwyg.element) {
        protyle.wysiwyg.element.addEventListener("input", (event: InputEvent) => {
            if (event.data === TRIGGER_CHAR && protyle.hint) {
                protyle.hint.enableExtend = true;
            }
        }, true);
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

    // Register the "@@" extend trigger
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

            const matchedSuper = Array.from(supertags).filter(t => t.includes(query));

            const isZh = window.siyuan?.config?.lang === "zh_CN";
            const badge = isZh ? "🐬 超级标签" : "🐬 Supertag";

            const superItems = matchedSuper.map(tag => {
                return {
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">@@${tag}</span><span class="b3-list-item__meta" style="color: var(--b3-theme-primary); font-weight: bold; margin-left: auto; font-size: 10px;">${badge}</span></div>`,
                    value: `indexos-supertag:${tag}`,
                    filter: [tag, `@${tag}`, `@@${tag}`]
                };
            });

            // Also show matching native tags so users can apply them as supertags
            const matchedNative = cachedNativeTags
                .filter(t => t.toLowerCase().includes(query) && !supertags.has(t.toLowerCase()));

            const nativeAsSuper = matchedNative.map(tag => {
                return {
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">@@${tag}</span></div>`,
                    value: `indexos-supertag:${tag}`,
                    filter: [tag, `@${tag}`, `@@${tag}`]
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
