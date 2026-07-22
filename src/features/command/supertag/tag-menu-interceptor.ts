import { post } from "../../../shared/api-client/request";
import { supertagMonitor } from "./supertag";
import { SUPERTAG_REGISTRY, globalSupertagsCache } from "../registration";
import { SupertagRenderer } from "./SupertagRenderer";
import { parseSupertags, serializeSupertags } from "../utils/supertag-helper";

// Visual indicator/badge texts to identify supertags in the list
const BADGE_MARKER = "🐬";

async function addDocumentSupertag(docId: string, tag: string, protyle: any) {
    // 1. Close Siyuan's menu popover
    window.siyuan.menus.menu?.remove();

    // 2. Fetch current page attributes
    const attrsRes = await post("/api/attr/getBlockAttrs", { id: docId });
    const attrs = attrsRes || {};
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

function renderSupertagsInPanel(panel: HTMLElement, query: string) {
    panel.innerHTML = "";

    const dbConfigs = supertagMonitor.getDataRegistry() || [];
    const logicConfigs = SUPERTAG_REGISTRY || [];

    const dataNames = new Set(dbConfigs.map(c => c.typeName.trim().toLowerCase()));
    const logicNames = new Set(logicConfigs.map(l => l.typeTag.trim().toLowerCase()));

    const allSupertags = Array.from(new Set([...dataNames, ...logicNames]));
    const matched = allSupertags.filter(t => t.includes(query));

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
            item.style.cssText = "display: flex; align-items: center; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.15s ease-in-out;";
            item.innerHTML = `<svg class="b3-list-item__graphic" style="width: 12px; height: 12px; color: ${color}; margin-right: 8px;"><use xlink:href="#iconTags"></use></svg><span class="b3-list-item__text" style="font-weight: 500; color: var(--b3-theme-on-background);">${tag}</span>`;
            
            item.addEventListener("click", async (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                const protyle = (window as any).activeProtyleInstance;
                if (protyle) {
                    const docId = protyle.block?.id || protyle.blockId;
                    if (docId) {
                        await addDocumentSupertag(docId, tag, protyle);
                    }
                }
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

    // If no supertags match at all, show empty indicator
    if (!cmdSec && !dataSec) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size: 11px; opacity: 0.5; text-align: center; padding: 20px 0; font-style: italic; color: var(--b3-theme-on-surface-light);";
        empty.innerText = "无匹配的超级标签";
        panel.appendChild(empty);
    }
}

function transformTagMenu(menuFilter: HTMLElement, inputEl: HTMLInputElement) {
    // Avoid double transformation
    if (menuFilter.classList.contains("indexos-transformed")) return;
    menuFilter.classList.add("indexos-transformed");

    // 1. Expand Siyuan's menu width to fit two columns
    const menuEl = menuFilter.closest(".b3-menu") as HTMLElement;
    if (menuEl) {
        menuEl.style.width = "540px";
        menuEl.style.maxWidth = "95vw";
    }

    // 2. Locate native tag list container
    const nativeList = menuFilter.querySelector(".b3-list--background") as HTMLElement;
    if (!nativeList) return;

    // 3. Create a flex row wrapper container
    const rowContainer = document.createElement("div");
    rowContainer.style.cssText = "display: flex; flex-direction: row; height: 320px; overflow: hidden; border-top: 1px solid var(--b3-border-color);";

    // Re-style native tag list to occupy the right column (let it retain its native scroll and columns styling)
    nativeList.style.cssText = "flex: 1.1; overflow: auto; height: 100%; margin: 0; padding: 4px; box-sizing: border-box;";
    
    // Insert rowContainer before nativeList
    nativeList.parentNode?.insertBefore(rowContainer, nativeList);

    // 4. Create the Left Column: Supertags panel
    const supertagPanel = document.createElement("div");
    supertagPanel.className = "indexos-supertags-panel";
    supertagPanel.style.cssText = "flex: 0.9; overflow-y: auto; height: 100%; padding: 8px; display: flex; flex-direction: column; background: var(--b3-theme-background); border-right: 1px solid var(--b3-border-color); box-sizing: border-box;";
    
    // Append Left Column first (Supertags), then Right Column (Native tag list)
    rowContainer.appendChild(supertagPanel);
    rowContainer.appendChild(nativeList);

    // 5. Initial render of supertags (no filter query)
    renderSupertagsInPanel(supertagPanel, "");

    // 6. Listen to search inputs to dynamically filter supertags
    inputEl.addEventListener("input", () => {
        const query = inputEl.value.trim().toLowerCase();
        renderSupertagsInPanel(supertagPanel, query);
    });
}

export function initTagMenuInterceptor() {
    // Observe DOM additions to catch when Siyuan's Tag dialog is opened
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
