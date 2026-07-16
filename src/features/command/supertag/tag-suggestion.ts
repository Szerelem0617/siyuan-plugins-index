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

// The trigger character for inline blocks is "#". Siyuan handles this natively.
// We attach our Supertags panel to the right side of Siyuan's native hint popover.
const SUPERTAG_TRIGGER = "#";

let blockSupertagsPanel: HTMLDivElement | null = null;

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

async function handleBlockSupertagClick(tag: string, protyle: any) {
    // 1. Hide Siyuan's hint popup and our panel
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.classList.add("fn__none");
    }
    hideBlockSupertagsPanel();

    // 2. Find the actual editing block element from cursor
    const selection = window.getSelection();
    const range = protyle.toolbar?.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (!range) return;

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
        console.error("[Supertag] Block element not found from cursor");
        return;
    }
    const blockId = blockEl.getAttribute("data-node-id")!;

    // 3. Delete the "#query" prefix from editor DOM
    const text = range.startContainer.textContent || "";
    const offset = range.startOffset;
    const beforeCursor = text.substring(0, offset);
    const lastHash = beforeCursor.lastIndexOf("#");
    if (lastHash > -1) {
        try {
            range.setStart(range.startContainer, lastHash);
            range.deleteContents();
        } catch (e) {
            console.error("[Supertag] Failed to delete block prefix:", e);
        }
    }

    // 4. Save custom-supertags attribute
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

    blockEl.setAttribute("custom-supertags", updatedCustomJSON);

    try {
        await post("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs: {
                "custom-supertags": updatedCustomJSON
            }
        });
    } catch (e) {
        console.error("[Supertag] setBlockAttrs failed:", e);
    }

    // 5. Persist content change via updateBlock
    const newHTML = blockEl.outerHTML;
    try {
        await post("/api/block/updateBlock", {
            dataType: "dom",
            data: newHTML,
            id: blockId
        });
    } catch (e) {
        console.error("[Supertag] updateBlock failed:", e);
    }

    // 6. Trigger commands and render pill
    await supertagMonitor.processNewTag(blockId, tag);
    SupertagRenderer.render(protyle);
}

function getQueryText(protyle: any): string {
    const selection = window.getSelection();
    const range = protyle.toolbar?.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (!range) return "";
    
    const textNode = range.startContainer;
    if (textNode.nodeType === 3) {
        const text = textNode.textContent || "";
        const offset = range.startOffset;
        const beforeCursor = text.substring(0, offset);
        const lastHash = beforeCursor.lastIndexOf("#");
        if (lastHash > -1) {
            return beforeCursor.substring(lastHash + 1).trim();
        }
    }
    return "";
}

function renderSupertagsInBlockPanel(panel: HTMLElement, query: string, protyle: any) {
    panel.innerHTML = "";

    const dbConfigs = supertagMonitor.getDataRegistry() || [];
    const logicConfigs = SUPERTAG_REGISTRY || [];

    const dataNames = new Set(dbConfigs.map(c => c.typeName.trim().toLowerCase()));
    const logicNames = new Set(logicConfigs.map(l => l.typeTag.trim().toLowerCase()));

    const allSupertags = Array.from(new Set([...dataNames, ...logicNames]));
    const matched = allSupertags.filter(t => t.includes(query));

    const classes: string[] = [];
    const dataComps: string[] = [];
    const toolComps: string[] = [];

    matched.forEach(tag => {
        const isData = dataNames.has(tag);
        const isLogic = logicNames.has(tag);
        if (isData && isLogic) {
            classes.push(tag);
        } else if (isData) {
            dataComps.push(tag);
        } else {
            toolComps.push(tag);
        }
    });

    const createSection = (title: string, tags: string[], color: string) => {
        // If there are no items in this category, don't render it at all
        if (tags.length === 0) return null;

        const section = document.createElement("div");
        section.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;";

        const header = document.createElement("div");
        header.style.cssText = `font-size: 11px; font-weight: bold; color: ${color}; border-bottom: 1px solid var(--b3-border-color); padding-bottom: 2px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;`;
        header.innerHTML = `<span>${title}</span><span style="opacity: 0.6; font-size: 9px; background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 4px;">${tags.length}</span>`;
        section.appendChild(header);

        const list = document.createElement("div");
        list.style.cssText = "display: flex; flex-direction: column; gap: 2px;";
        tags.forEach(tag => {
            const item = document.createElement("div");
            item.className = "b3-list-item b3-list-item--narrow";
            item.style.cssText = "display: flex; align-items: center; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;";
            item.innerHTML = `<svg class="b3-list-item__graphic" style="width: 12px; height: 12px; color: ${color}; margin-right: 8px;"><use xlink:href="#iconTags"></use></svg><span class="b3-list-item__text" style="font-weight: 500; color: var(--b3-theme-on-background);">${tag}</span>`;
            
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                handleBlockSupertagClick(tag, protyle);
            });
            
            list.appendChild(item);
        });
        section.appendChild(list);

        return section;
    };

    const classSec = createSection("类 (Class)", classes.sort(), "var(--b3-theme-primary)");
    const dataSec = createSection("数据组件", dataComps.sort(), "#4caf50");
    const toolSec = createSection("工具组件", toolComps.sort(), "#ff9800");

    if (classSec) panel.appendChild(classSec);
    if (dataSec) panel.appendChild(dataSec);
    if (toolSec) panel.appendChild(toolSec);

    // If no supertags match at all, show empty indicator
    if (!classSec && !dataSec && !toolSec) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size: 11px; opacity: 0.5; text-align: center; padding: 20px 0; font-style: italic; color: var(--b3-theme-on-surface-light);";
        empty.innerText = "无匹配的超级标签";
        panel.appendChild(empty);
    }
}

function showBlockSupertagsPanel(protyle: any, query: string) {
    if (!tagSuggestionState.enabled) return;

    const hintEl = protyle.hint?.element as HTMLElement;
    if (!hintEl) return;

    // Force Siyuan's native tag suggestion popover to show in a single column
    // to prevent it from displaying tags in multiple wrap rows/columns.
    hintEl.style.setProperty("display", "flex", "important");
    hintEl.style.setProperty("flex-direction", "column", "important");
    hintEl.style.setProperty("flex-wrap", "nowrap", "important");
    hintEl.style.setProperty("min-width", "220px", "important");
    hintEl.style.setProperty("width", "260px", "important");

    if (!blockSupertagsPanel) {
        blockSupertagsPanel = document.createElement("div");
        blockSupertagsPanel.className = "indexos-block-supertags-panel b3-list b3-list--background";
        blockSupertagsPanel.style.cssText = "position: absolute; width: 240px; max-height: 360px; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; background: var(--b3-theme-background); border: 1px solid var(--b3-border-color); border-radius: 6px; box-shadow: var(--b3-dialog-shadow); z-index: 9999; box-sizing: border-box;";
        document.body.appendChild(blockSupertagsPanel);
    }

    // Refresh registry to keep it fresh
    supertagMonitor.refreshRegistry().catch(() => {});

    // Position panel to the right of Siyuan's native hint popover
    const rect = hintEl.getBoundingClientRect();
    blockSupertagsPanel.style.left = `${rect.right + 6}px`;
    blockSupertagsPanel.style.top = `${rect.top}px`;
    blockSupertagsPanel.style.height = `${rect.height}px`;
    blockSupertagsPanel.style.display = "flex";

    renderSupertagsInBlockPanel(blockSupertagsPanel, query, protyle);
}

function hideBlockSupertagsPanel() {
    if (blockSupertagsPanel) {
        blockSupertagsPanel.style.display = "none";
    }
}

export function bindProtyleHintExtend(protyle: any) {
    if (!protyle || !protyle.options) return;

    // Set up MutationObserver to sync our panel visibility with Siyuan's native hint popover
    if (protyle.hint && protyle.hint.element && !protyle.hint.isObserverAttached) {
        protyle.hint.isObserverAttached = true;
        const observer = new MutationObserver(() => {
            const isHidden = protyle.hint.element.classList.contains("fn__none");
            if (isHidden) {
                hideBlockSupertagsPanel();
            } else {
                // Wait briefly for editor layout selection stability
                setTimeout(() => {
                    const query = getQueryText(protyle);
                    showBlockSupertagsPanel(protyle, query);
                }, 30);
            }
        });
        observer.observe(protyle.hint.element, { attributes: true, attributeFilter: ["class"] });
    }

    // Capture editor input changes to update search filtering in real time
    if (protyle.wysiwyg && protyle.wysiwyg.element && !protyle.wysiwyg.isInputAttached) {
        protyle.wysiwyg.isInputAttached = true;
        protyle.wysiwyg.element.addEventListener("input", () => {
            if (protyle.hint && !protyle.hint.element.classList.contains("fn__none")) {
                const query = getQueryText(protyle);
                if (blockSupertagsPanel && blockSupertagsPanel.style.display !== "none") {
                    renderSupertagsInBlockPanel(blockSupertagsPanel, query, protyle);
                }
            }
        });
    }

    protyle.options.hint = protyle.options.hint || {};
    protyle.options.hint.extend = protyle.options.hint.extend || [];

    // Avoid duplicate registration (using "#" as extend key)
    const hasRegistered = protyle.options.hint.extend.some((ext: any) => ext.isIndexOS && ext.key === SUPERTAG_TRIGGER);
    if (hasRegistered) return;

    protyle.options.hint.extend.push({
        key: SUPERTAG_TRIGGER,
        isIndexOS: true,
        hint(value: string, protyleInstance: any, source: string) {
            refreshNativeTagsCache().catch(() => {});
            
            // Return only Siyuan's native tags inside Siyuan's native list,
            // keeping our supertags fully separated in our own right-hand panel.
            const query = value.trim().toLowerCase();
            const matchedNative = cachedNativeTags.filter(t => t.toLowerCase().includes(query));

            return matchedNative.map(tag => {
                return {
                    html: `<div class="b3-list-item__first"><span class="b3-list-item__text">#${tag}</span></div>`,
                    value: `#${tag}#`,
                    filter: [tag, `#${tag}`, `#${tag}#`]
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
