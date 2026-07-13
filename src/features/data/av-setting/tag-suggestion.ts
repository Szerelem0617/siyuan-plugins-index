import { Plugin } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { supertagMonitor } from "./supertag";
import { SUPERTAG_REGISTRY } from "../../command/registration";

export const tagSuggestionState = {
    enabled: false,
    plugin: null as Plugin | null
};

let cachedNativeTags: string[] = [];
let lastNativeFetch = 0;

export async function refreshNativeTagsCache() {
    // Rate limit to once every 2 seconds to avoid spamming the Go kernel
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

    // Trigger initial cache populate
    refreshNativeTagsCache().catch(() => {});

    // Register protyle hint extend for key "#"
    plugin.protyleOptions = plugin.protyleOptions || {};
    plugin.protyleOptions.hint = plugin.protyleOptions.hint || {};
    plugin.protyleOptions.hint.extend = plugin.protyleOptions.hint.extend || [];

    // Filter out any duplicate "#" trigger we might have registered
    plugin.protyleOptions.hint.extend = plugin.protyleOptions.hint.extend.filter(
        (ext: any) => !(ext.key === "#" && ext.isIndexOS)
    );

    plugin.protyleOptions.hint.extend.push({
        key: "#",
        isIndexOS: true, // Marker to avoid duplicates
        hint(value: string, protyle: any, source: string) {
            // Trigger asynchronous background refresh for future keystrokes
            refreshNativeTagsCache().catch(() => {});

            const query = value.trim().toLowerCase();
            const matchedNative = cachedNativeTags.filter(t => t.toLowerCase().includes(query));

            if (!tagSuggestionState.enabled) {
                // If disabled, only return native tags formatted as standard Siyuan tag items
                return matchedNative.map(tag => {
                    return {
                        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span></div>`,
                        value: `#${tag}#`
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
                    value: `#${tag}#`
                };
            });

            // Map native tags to HintData, excluding tags that are already covered by supertags to avoid duplicates
            const nativeItems = matchedNative
                .filter(tag => !supertags.has(tag.toLowerCase()))
                .map(tag => {
                    return {
                        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span></div>`,
                        value: `#${tag}#`
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
