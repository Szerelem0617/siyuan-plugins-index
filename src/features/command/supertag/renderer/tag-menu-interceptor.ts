import { post } from "../../../../shared/api-client/request";
import { supertagMonitor } from "../core/supertag-listener";
import { SUPERTAG_REGISTRY, globalSupertagsCache } from "../../registration";
import { SupertagRenderer } from "./SupertagRenderer";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";

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

function renderSupertagsInPanel(panel: HTMLElement, query: string) {
    panel.innerHTML = "";

    const dbConfigs: any[] = [];
    const logicConfigs = SUPERTAG_REGISTRY || [];

    const dataNames = new Set(dbConfigs.map((c: any) => c.typeName.trim().toLowerCase()));
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

    if (!cmdSec && !dataSec) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size: 11px; opacity: 0.5; text-align: center; padding: 20px 0; font-style: italic; color: var(--b3-theme-on-surface-light);";
        empty.innerText = "无匹配的超级标签";
        panel.appendChild(empty);
    }
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

    renderSupertagsInPanel(supertagPanel, "");

    inputEl.addEventListener("input", () => {
        const query = inputEl.value.trim().toLowerCase();
        renderSupertagsInPanel(supertagPanel, query);
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
