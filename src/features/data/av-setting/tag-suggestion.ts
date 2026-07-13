import { Plugin } from "siyuan";
import { supertagMonitor } from "./supertag";
import { SUPERTAG_REGISTRY } from "../../command/registration";

export const tagSuggestionState = {
    enabled: false,
    plugin: null as Plugin | null
};

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
            if (!tagSuggestionState.enabled) return [];

            const query = value.trim().toLowerCase();
            const tags = new Set<string>();

            // 1. Get database supertags
            const dbConfigs = supertagMonitor.getDataRegistry();
            if (dbConfigs) {
                dbConfigs.forEach(c => {
                    if (c.typeName) {
                        tags.add(c.typeName.trim().toLowerCase());
                    }
                });
            }

            // 2. Get registered command supertags
            if (SUPERTAG_REGISTRY) {
                SUPERTAG_REGISTRY.forEach(l => {
                    if (l.typeTag) {
                        tags.add(l.typeTag.trim().toLowerCase());
                    }
                });
            }

            // Filter by search query
            const matches = Array.from(tags).filter(t => t.includes(query));

            const isZh = window.siyuan?.config?.lang === "zh_CN";
            const badge = isZh ? "🐬 超级标签" : "🐬 Supertag";

            return matches.map(tag => {
                return {
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span><span class="b3-list-item__meta" style="color: var(--b3-theme-primary); font-weight: bold; margin-left: auto; font-size: 10px;">${badge}</span></div>`,
                    value: `#${tag}#` // Insert with trailing # to close it in Siyuan tag format
                };
            });
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
