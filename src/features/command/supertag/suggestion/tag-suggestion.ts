import { Plugin } from "siyuan";
import { post } from "../../../../shared/api-client/request";
import { supertagMonitor } from "../core/supertag-listener";
import { SUPERTAG_REGISTRY, globalSupertagsCache } from "../../registration";
import { SupertagRenderer } from "../renderer/SupertagRenderer";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";
import { findActiveBlock } from "../../utils/supertag-helper";
import { commandRegistry } from "../../registry/command-registry";
import { getBlockType } from "../../command-dispatcher";

export const tagSuggestionState = {
    enabled: true,
    plugin: null as Plugin | null
};

let cachedNativeTags: string[] = [];
let lastNativeFetch = 0;

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
    tagSuggestionState.enabled = true;
    refreshNativeTagsCache().catch(() => {});
}

async function handleBlockSupertagClick(tag: string, protyle: any) {
    if (protyle.hint && protyle.hint.element) {
        protyle.hint.element.classList.add("fn__none");
    }
    hideBlockSupertagsPanel();

    const blockEl = findActiveBlock(protyle);
    if (!blockEl) {
        console.error("[Supertag] Block element not found from cursor");
        return;
    }
    const blockId = blockEl.getAttribute("data-node-id")!;

    const selection = window.getSelection();
    const range = protyle.toolbar?.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (range) {
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
    }

    const raw = blockEl.getAttribute("custom-supertags");
    const currentCustom = parseSupertags(raw);
    const updatedCustom = Array.from(new Set([...currentCustom, tag]));
    const updatedCustomJSON = serializeSupertags(updatedCustom);

    blockEl.setAttribute("custom-supertags", updatedCustomJSON);
    globalSupertagsCache.set(blockId, updatedCustom);

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

    await supertagMonitor.processNewTag(blockId, tag);
    SupertagRenderer.render(protyle);
}

function getQueryText(protyle: any): string | null {
    const selection = window.getSelection();
    const range = protyle.toolbar?.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (!range) return null;
    
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
    return null;
}

function renderSupertagsInBlockPanel(panel: HTMLElement, query: string, protyle: any) {
    panel.innerHTML = "";

    const dbConfigs: any[] = [];
    const logicConfigs = SUPERTAG_REGISTRY || [];

    const dataNames = new Set(dbConfigs.map((c: any) => c.typeName.trim().toLowerCase()));
    const logicNames = new Set(logicConfigs.map(l => l.typeTag.trim().toLowerCase()));

    const allSupertags = Array.from(new Set([...dataNames, ...logicNames]));
    const matched = allSupertags.filter(t => t.includes(query));

    const activeBlock = findActiveBlock(protyle);
    const currentBlockType = activeBlock ? getBlockType(activeBlock) : null;

    const incompatibleTags = new Set<string>();
    if (currentBlockType) {
        for (const tag of matched) {
            const tagLower = tag.toLowerCase();
            const boundCmds = logicConfigs.filter(l => l.typeTag.trim().toLowerCase() === tagLower);
            for (const bound of boundCmds) {
                const cmdDef = commandRegistry.getCommand(bound.commandRef);
                if (cmdDef?.meta?.appliesTo && cmdDef.meta.appliesTo.length > 0 && !cmdDef.meta.appliesTo.includes("any")) {
                    if (!cmdDef.meta.appliesTo.includes(currentBlockType as any)) {
                        incompatibleTags.add(tag);
                        break;
                    }
                }
            }
        }
    }

    const cmdComps: string[] = [];
    const dataComps: string[] = [];

    matched.forEach(tag => {
        const isData = dataNames.has(tag);
        const isLogic = logicNames.has(tag);
        if (isLogic) {
            cmdComps.push(tag);
        } else if (isData) {
            dataComps.push(tag);
        }
    });

    const createSection = (title: string, tags: string[], color: string) => {
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
            const isIncompat = incompatibleTags.has(tag);
            const item = document.createElement("div");
            item.className = "b3-list-item b3-list-item--narrow";
            item.style.cssText = `display: flex; align-items: center; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;${isIncompat ? " opacity: 0.4;" : ""}`;

            const iconColor = isIncompat ? "var(--b3-theme-on-surface-light)" : color;
            let labelHtml = `<svg class="b3-list-item__graphic" style="width: 12px; height: 12px; color: ${iconColor}; margin-right: 8px;"><use xlink:href="#iconTags"></use></svg><span class="b3-list-item__text" style="font-weight: 500; color: var(--b3-theme-on-background);">${tag}</span>`;
            if (isIncompat) {
                labelHtml += `<span style="margin-left: auto; font-size: 9px; color: var(--b3-theme-on-surface-light); opacity: 0.8;">不推荐</span>`;
            }
            item.innerHTML = labelHtml;
            
            if (isIncompat) {
                item.title = "此标签绑定的命令不适用于当前块类型";
            }

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

    const cmdSec = createSection("命令tag", cmdComps.sort(), "var(--b3-theme-primary)");
    const dataSec = createSection("数据tag", dataComps.sort(), "#4caf50");

    if (cmdSec) panel.appendChild(cmdSec);
    if (dataSec) panel.appendChild(dataSec);

    if (!cmdSec && !dataSec) {
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

    if (!blockSupertagsPanel) {
        blockSupertagsPanel = document.createElement("div");
        blockSupertagsPanel.className = "indexos-block-supertags-panel b3-list b3-list--background";
        blockSupertagsPanel.style.cssText = "position: absolute; width: 240px; max-height: 420px; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; background: var(--b3-theme-background); border: 1px solid var(--b3-border-color); border-radius: 6px; box-shadow: var(--b3-dialog-shadow); z-index: 9999; box-sizing: border-box;";
        document.body.appendChild(blockSupertagsPanel);
    }

    const rect = hintEl.getBoundingClientRect();
    const panelWidth = 240;
    let left = rect.left - panelWidth - 6;
    if (left < 0) {
        left = rect.right + 6;
    }
    blockSupertagsPanel.style.left = `${left}px`;
    blockSupertagsPanel.style.top = `${rect.top}px`;
    blockSupertagsPanel.style.height = "auto";
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

    if (protyle.hint && protyle.hint.element && !protyle.hint.isObserverAttached) {
        protyle.hint.isObserverAttached = true;
        const observer = new MutationObserver(() => {
            const isHidden = protyle.hint.element.classList.contains("fn__none");
            if (isHidden) {
                hideBlockSupertagsPanel();
            } else {
                setTimeout(() => {
                    const query = getQueryText(protyle);
                    // 仅当文本中确实以 # 触发（query 不为 null）时才显示超级标签侧边面板
                    if (query !== null) {
                        showBlockSupertagsPanel(protyle, query);
                    } else {
                        hideBlockSupertagsPanel();
                    }
                }, 30);
            }
        });
        observer.observe(protyle.hint.element, { attributes: true, attributeFilter: ["class"] });
    }

    if (protyle.wysiwyg && protyle.wysiwyg.element && !protyle.wysiwyg.isInputAttached) {
        protyle.wysiwyg.isInputAttached = true;
        protyle.wysiwyg.element.addEventListener("input", () => {
            if (protyle.hint && !protyle.hint.element.classList.contains("fn__none")) {
                const query = getQueryText(protyle);
                if (query !== null && blockSupertagsPanel && blockSupertagsPanel.style.display !== "none") {
                    renderSupertagsInBlockPanel(blockSupertagsPanel, query, protyle);
                } else if (query === null) {
                    hideBlockSupertagsPanel();
                }
            }
        });
    }

    protyle.options.hint = protyle.options.hint || {};
    protyle.options.hint.extend = protyle.options.hint.extend || [];

    const hasRegistered = protyle.options.hint.extend.some((ext: any) => ext.isIndexOS && ext.key === SUPERTAG_TRIGGER);
    if (hasRegistered) return;

    protyle.options.hint.extend.push({
        key: SUPERTAG_TRIGGER,
        isIndexOS: true,
        hint(value: string, protyleInstance: any, source: string) {
            refreshNativeTagsCache().catch(() => {});
            
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
