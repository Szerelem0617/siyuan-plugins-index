import { post } from "../../../shared/api-client/request";
import { supertagMonitor } from "../core/supertag-listener";
import { SUPERTAG_REGISTRY, globalSupertagsCache } from "../../command/registration";
import { SupertagRenderer } from "./SupertagRenderer";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";
import { getGlobalTypeConfigs } from "../../av/av-setting/db-config";

async function addDocumentSupertag(docId: string, tag: string, protyle: any) {
    // 1. Close Siyuan's menu popover
    (window.siyuan.menus.menu as any)?.remove?.();

    // 2. Fetch current page attributes
    const attrsRes = await post("/api/attr/getBlockAttrs", { id: docId });
    const attrs = attrsRes?.data || attrsRes || {};
    const rawTags = attrs["custom-supertags"];
    
    const currentCustom = parseSupertags(rawTags);
    const updatedCustom = Array.from(new Set([...currentCustom, tag]));
    const updatedCustomJSON = serializeSupertags(updatedCustom);

    // 3. Save attributes
    await post("/api/attr/setBlockAttrs", {
        id: docId,
        attrs: {
            "custom-supertags": updatedCustomJSON
        }
    });
    globalSupertagsCache.set(docId, updatedCustom);

    // 4. Process trigger rules and render pills
    await supertagMonitor.processNewTag(docId, tag);
    SupertagRenderer.render(protyle);
}

import { getUnifiedSupertagList, type UnifiedSupertagDefinition } from "../core/supertag-entity";

async function renderSupertagsInPanel(panel: HTMLElement, query: string) {
    panel.innerHTML = "";

    const allSupertags = await getUnifiedSupertagList();
    const queryLower = query.toLowerCase().trim();

    const matched = allSupertags.filter(t => {
        if (!t.enabled) return false;
        if (!queryLower) return true;
        return t.typeName.includes(queryLower);
    });

    if (matched.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size: 11px; opacity: 0.5; text-align: center; padding: 20px 0; font-style: italic; color: var(--b3-theme-on-surface-light);";
        empty.innerText = "无匹配的超级标签";
        panel.appendChild(empty);
        return;
    }

    const header = document.createElement("div");
    header.style.cssText = "font-size: 11px; font-weight: bold; color: var(--indexos-accent-primary); border-bottom: 1px solid var(--b3-border-color); padding-bottom: 2px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;";
    header.innerHTML = `<span>超级标签</span><span style="opacity: 0.6; font-size: 9px; background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 4px;">${matched.length}</span>`;
    panel.appendChild(header);

    const list = document.createElement("div");
    list.style.cssText = "display: flex; flex-direction: column; gap: 2px;";

    matched.forEach(item => {
        const tagItem = document.createElement("div");
        tagItem.className = "b3-list-item b3-list-item--narrow";
        tagItem.style.cssText = "display: flex; align-items: center; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.15s ease-in-out;";
        
        let labelHtml = `<svg class="b3-list-item__graphic" style="width: 12px; height: 12px; color: var(--indexos-accent-primary); margin-right: 6px;"><use xlink:href="#iconTags"></use></svg><span class="b3-list-item__text" style="font-weight: 500; color: var(--b3-theme-on-background);">#${item.typeName}</span>`;
        if (item.hasDataSchema) {
            labelHtml += `<span style="font-size: 9px; opacity: 0.7; margin-left: 4px;">📊</span>`;
        }
        if (item.hasBehavior) {
            labelHtml += `<span style="font-size: 9px; opacity: 0.7; margin-left: 2px;">⚡</span>`;
        }
        tagItem.innerHTML = labelHtml;
        
        tagItem.addEventListener("click", async (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            const protyle = (window as any).activeProtyleInstance;
            if (protyle) {
                const docId = protyle.block?.id || protyle.blockId;
                if (docId) {
                    await addDocumentSupertag(docId, item.typeName, protyle);
                }
            }
        });
        
        list.appendChild(tagItem);
    });

    panel.appendChild(list);
}

function transformTagMenu(menuFilter: HTMLElement, inputEl: HTMLInputElement) {
    if (menuFilter.classList.contains("indexos-transformed")) return;
    menuFilter.classList.add("indexos-transformed");

    const menuEl = menuFilter.closest(".b3-menu") as HTMLElement;
    if (menuEl) {
        menuEl.style.width = "540px";
        menuEl.style.maxWidth = "95vw";
    }

    const nativeList = menuFilter.querySelector(".b3-list--background") as HTMLElement;
    if (!nativeList) return;

    const rowContainer = document.createElement("div");
    rowContainer.style.cssText = "display: flex; flex-direction: row; height: 320px; overflow: hidden; border-top: 1px solid var(--b3-border-color);";

    nativeList.style.cssText = "flex: 1.1; overflow: auto; height: 100%; margin: 0; padding: 4px; box-sizing: border-box;";
    
    nativeList.parentNode?.insertBefore(rowContainer, nativeList);

    const supertagPanel = document.createElement("div");
    supertagPanel.className = "indexos-supertags-panel";
    supertagPanel.style.cssText = "flex: 0.9; overflow-y: auto; height: 100%; padding: 8px; display: flex; flex-direction: column; background: var(--b3-theme-background); border-right: 1px solid var(--b3-border-color); box-sizing: border-box;";
    
    rowContainer.appendChild(supertagPanel);
    rowContainer.appendChild(nativeList);

    void renderSupertagsInPanel(supertagPanel, "");

    inputEl.addEventListener("input", () => {
        const query = inputEl.value.trim().toLowerCase();
        void renderSupertagsInPanel(supertagPanel, query);
    });
}

export function initTagMenuInterceptor() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    const el = node as HTMLElement;
                    const menuFilter = el.querySelector(".b3-menu__filter") || (el.classList.contains("b3-menu__filter") ? el : null);
                    if (menuFilter) {
                        const input = menuFilter.querySelector("input");
                        if (input && input.placeholder === window.siyuan.languages.tag) {
                            transformTagMenu(menuFilter as HTMLElement, input);
                        }
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}
