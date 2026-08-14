import { Plugin } from "siyuan";
import { post } from "../../../../shared/api-client/request";
import { supertagMonitor } from "../core/supertag-listener";
import { SUPERTAG_REGISTRY, globalSupertagsCache } from "../../registration";
import { SupertagRenderer } from "../renderer/SupertagRenderer";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";
import { findActiveBlock } from "../../utils/context-extractor";
import { commandRegistry } from "../../registry/command-registry";
import { getBlockType } from "../../command-dispatcher";
import { getGlobalTypeConfigs } from "../../../av/av-setting/db-config";
import { supertagBinder } from "../core/supertag-binder";
import { settings } from "../../../../core/settings";

let paletteEl: HTMLElement | null = null;
let isOpen = false;
let inputListenerAttached = false;
let keyListenerAttached = false;

let selectedIndex = 0;
let currentTagList: string[] = [];
let activeProtyle: any = null;

const TRIGGER_ASCII = "@";
const TRIGGER_FULL = "＠";

export function initSupertagPalette(_plugin: Plugin) {
    ensurePaletteEl();
    if (!inputListenerAttached) {
        document.addEventListener("input", onEditorInput, true);
        inputListenerAttached = true;
    }
    if (!keyListenerAttached) {
        document.addEventListener("keydown", onEditorKeydown, true);
        keyListenerAttached = true;
    }
    document.addEventListener("mousedown", onOutsideClick, true);
    console.log("[SupertagPalette] Initialized (@ trigger mode).");
}

export function destroySupertagPalette() {
    document.removeEventListener("input", onEditorInput, true);
    document.removeEventListener("keydown", onEditorKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick, true);
    closePalette();
    if (paletteEl) {
        paletteEl.remove();
        paletteEl = null;
    }
    inputListenerAttached = false;
    keyListenerAttached = false;
    console.log("[SupertagPalette] Destroyed.");
}

function ensurePaletteEl() {
    if (!paletteEl) {
        paletteEl = document.createElement("div");
        paletteEl.className = "protyle-hint indexos-weak-floating-panel fn__none";
        paletteEl.id = "siyuan-plugin-supertag-palette";
        paletteEl.setAttribute("data-close", "false");
        paletteEl.style.cssText = "position:fixed;z-index:9999;width:340px;max-width:90vw;max-height:360px;overflow-y:auto;background:var(--indexos-bg-base);border:1px solid var(--indexos-border-light);border-radius:6px;box-shadow:0 16px 48px rgba(0,0,0,0.18), 0 0 12px var(--indexos-accent-glow);padding:8px;box-sizing:border-box;";
        document.body.appendChild(paletteEl);

        paletteEl.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const item = (e.target as HTMLElement).closest("[data-tag-name]") as HTMLElement;
            if (item) {
                const tagName = item.getAttribute("data-tag-name");
                if (tagName) {
                    applySupertag(tagName);
                }
            }
        });
    }
    return paletteEl;
}

function onEditorInput(e: Event) {
    if (!settings.get("devMode")) {
        if (isOpen) closePalette();
        return;
    }

    const target = e.target as HTMLElement;
    if (!target.getAttribute || !target.getAttribute("contenteditable")) return;
    if (!target.closest(".protyle-wysiwyg")) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return;

    const textNode = range.startContainer as Text;
    const text = textNode.textContent || "";
    const offset = range.startOffset;
    const textBefore = text.substring(0, offset);

    let queryText = "";
    if (textBefore.endsWith(TRIGGER_ASCII) || textBefore.endsWith(TRIGGER_FULL)) {
        queryText = "";
    } else if (isOpen) {
        const triggerPos = Math.max(
            textBefore.lastIndexOf(TRIGGER_ASCII),
            textBefore.lastIndexOf(TRIGGER_FULL)
        );
        if (triggerPos !== -1) {
            queryText = textBefore.substring(triggerPos + 1);
            renderList(queryText);
            repositionPalette(range);
            return;
        } else {
            closePalette();
            return;
        }
    } else {
        return;
    }

    activeProtyle = (window as any).activeProtyleInstance;
    openPalette(queryText, range);
}

function onEditorKeydown(e: KeyboardEvent) {
    if (!isOpen || !paletteEl) return;

    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePalette();
        return;
    }

    if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (currentTagList.length > 0) {
            selectedIndex = (selectedIndex + 1) % currentTagList.length;
            updateSelectionHighlight();
        }
        return;
    }

    if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (currentTagList.length > 0) {
            selectedIndex = (selectedIndex - 1 + currentTagList.length) % currentTagList.length;
            updateSelectionHighlight();
        }
        return;
    }

    if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (currentTagList.length > 0 && selectedIndex >= 0 && selectedIndex < currentTagList.length) {
            applySupertag(currentTagList[selectedIndex]);
        } else {
            closePalette();
        }
        return;
    }
}

function onOutsideClick(e: MouseEvent) {
    if (!isOpen || !paletteEl) return;
    if (paletteEl.contains(e.target as Node)) return;
    closePalette();
}

async function openPalette(query: string, range: Range) {
    isOpen = true;
    selectedIndex = 0;
    ensurePaletteEl();
    await renderList(query);
    repositionPalette(range);
    paletteEl!.classList.remove("fn__none");
}

function closePalette() {
    isOpen = false;
    currentTagList = [];
    selectedIndex = 0;
    if (paletteEl) {
        paletteEl.classList.add("fn__none");
        paletteEl.innerHTML = "";
    }
}

async function renderList(query: string) {
    if (!paletteEl) return;
    paletteEl.innerHTML = "";
    currentTagList = [];

    const dbConfigs = await getGlobalTypeConfigs();
    const logicConfigs = SUPERTAG_REGISTRY || [];

    const dataNames = new Set(dbConfigs.map((c: any) => c.typeName.trim().toLowerCase()));
    const logicNames = new Set(logicConfigs.map(l => l.typeTag.trim().toLowerCase()));

    const queryLower = query.toLowerCase();
    const allSupertags = Array.from(new Set([...dataNames, ...logicNames]));
    const matched = allSupertags.filter(t => {
        if (!t.includes(queryLower)) return false;
        const pref = supertagBinder.getPref(t);
        return pref !== "disabled";
    });

    const activeBlock = activeProtyle ? findActiveBlock(activeProtyle) : null;
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

    const sortedCmds = cmdComps.sort();
    const sortedDatas = dataComps.sort();
    currentTagList = [...sortedCmds, ...sortedDatas];

    if (currentTagList.length === 0) {
        paletteEl.innerHTML = `<div style="font-size: 11px; text-align: center; padding: 16px 0; color: var(--indexos-text-muted); font-family: ui-monospace, monospace;">无匹配的超级标签 (@)</div>`;
        return;
    }

    let flatIndex = 0;
    const createSection = (title: string, tags: string[]) => {
        if (tags.length === 0) return null;

        const section = document.createElement("div");
        section.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;";

        const header = document.createElement("div");
        header.style.cssText = "font-family: ui-monospace, monospace; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--indexos-text-muted); border-bottom: 1px solid var(--indexos-border-light); padding-bottom: 4px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;";
        header.innerHTML = `<span>${title}</span><span style="background: var(--indexos-accent-badge-bg); color: var(--indexos-accent-badge-text); font-family: ui-monospace, monospace; border-radius: 2px; padding: 1px 5px; font-size: 9px; font-weight: 600; border: 1px solid var(--indexos-border-light);">${tags.length}</span>`;
        section.appendChild(header);

        const list = document.createElement("div");
        list.style.cssText = "display: flex; flex-direction: column; gap: 3px;";

        tags.forEach(tag => {
            const thisIdx = flatIndex++;
            const isIncompat = incompatibleTags.has(tag);
            const item = document.createElement("div");
            item.className = `b3-list-item b3-list-item--narrow ${thisIdx === selectedIndex ? "b3-list-item--focus" : ""}`;
            item.setAttribute("data-tag-name", tag);
            item.setAttribute("data-index", String(thisIdx));
            item.style.cssText = `display: flex; align-items: center; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; transition: all 0.15s ease; ${isIncompat ? "opacity: 0.4;" : ""}`;

            const iconColor = isIncompat ? "var(--indexos-text-muted)" : "var(--indexos-accent-primary)";
            let labelHtml = `<svg class="b3-list-item__graphic" style="width: 13px; height: 13px; color: ${iconColor}; margin-right: 8px; flex-shrink: 0;"><use xlink:href="#iconTags"></use></svg><span class="b3-list-item__text" style="color: var(--indexos-text-main); font-weight: 600;">@${tag}</span>`;
            if (isIncompat) {
                labelHtml += `<span style="margin-left: auto; font-size: 9px; color: var(--indexos-text-muted); opacity: 0.8; font-family: ui-monospace, monospace;">不推荐</span>`;
            }
            item.innerHTML = labelHtml;
            list.appendChild(item);
        });

        section.appendChild(list);
        return section;
    };

    const cmdSec = createSection("命令 TAG", sortedCmds);
    const dataSec = createSection("数据 TAG", sortedDatas);

    if (cmdSec) paletteEl.appendChild(cmdSec);
    if (dataSec) paletteEl.appendChild(dataSec);

    updateSelectionHighlight();
}

function updateSelectionHighlight() {
    if (!paletteEl) return;
    const items = paletteEl.querySelectorAll("[data-index]");
    items.forEach(el => {
        const idx = parseInt(el.getAttribute("data-index") || "-1");
        if (idx === selectedIndex) {
            el.classList.add("b3-list-item--focus");
            (el as HTMLElement).style.background = "var(--indexos-bg-card-hover, var(--indexos-ice-highlight))";
            (el as HTMLElement).scrollIntoView({ block: "nearest" });
        } else {
            el.classList.remove("b3-list-item--focus");
            (el as HTMLElement).style.background = "transparent";
        }
    });
}

function repositionPalette(range: Range) {
    if (!paletteEl) return;
    const rect = range.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const pWidth = paletteEl.offsetWidth || 340;
    const pHeight = paletteEl.offsetHeight || 280;

    if (left + pWidth > winW - 12) {
        left = Math.max(12, winW - pWidth - 12);
    }
    if (top + pHeight > winH - 12) {
        top = Math.max(12, rect.top - pHeight - 4);
    }

    paletteEl.style.left = `${left}px`;
    paletteEl.style.top = `${top}px`;
}

async function applySupertag(tag: string) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        closePalette();
        return;
    }
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer as Text;

    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.textContent || "";
        const offset = range.startOffset;
        const textBefore = text.substring(0, offset);
        const textAfter = text.substring(offset);

        const lastAscii = textBefore.lastIndexOf(TRIGGER_ASCII);
        const lastFull = textBefore.lastIndexOf(TRIGGER_FULL);
        const lastPos = Math.max(lastAscii, lastFull);

        if (lastPos !== -1) {
            textNode.textContent = textBefore.substring(0, lastPos) + textAfter;
            const newOffset = lastPos;
            const newRange = document.createRange();
            newRange.setStart(textNode, Math.min(newOffset, textNode.textContent.length));
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        }
    }

    closePalette();

    const protyle = activeProtyle || (window as any).activeProtyleInstance;
    const blockEl = protyle ? findActiveBlock(protyle) : null;
    if (!blockEl) return;

    const blockId = blockEl.getAttribute("data-node-id")!;
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
        const newHTML = blockEl.outerHTML;
        await post("/api/block/updateBlock", {
            dataType: "dom",
            data: newHTML,
            id: blockId
        });
    } catch (e) {
        console.error("[SupertagPalette] setBlockAttrs/updateBlock failed:", e);
    }

    await supertagMonitor.processNewTag(blockId, tag);
    if (protyle) {
        SupertagRenderer.render(protyle);
    }
}
