import { Plugin } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { supertagMonitor } from "../core/supertag-listener";
import { getSupertagRegistry, SUPERTAG_REGISTRY, globalSupertagsCache } from "../../command/registration";
import { SupertagRenderer } from "../renderer/SupertagRenderer";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";
import { findActiveBlock } from "../../command/utils/context-extractor";
import { commandRegistry } from "../../command/registry/command-registry";
import { getBlockType } from "../../command/command-dispatcher";
import { getGlobalTypeConfigs } from "../../av/av-setting/db-config";
import { supertagBinder } from "../core/supertag-binder";
import { settings } from "../../../core/settings";

let paletteEl: HTMLElement | null = null;
let isOpen = false;
let inputListenerAttached = false;
let keyListenerAttached = false;

let selectedIndex = 0;
let currentTagList: string[] = [];
let activeProtyle: any = null;
let renderSeq = 0;

let isComposing = false;
let lastCompositionEndTime = 0;

const TRIGGER_ASCII = "@";
const TRIGGER_FULL = "＠";

export function initSupertagPalette(_plugin: Plugin) {
    ensurePaletteEl();
    if (!inputListenerAttached) {
        document.addEventListener("compositionstart", onCompositionStart, true);
        document.addEventListener("compositionupdate", onCompositionUpdate, true);
        document.addEventListener("compositionend", onCompositionEnd, true);
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
    document.removeEventListener("compositionstart", onCompositionStart, true);
    document.removeEventListener("compositionupdate", onCompositionUpdate, true);
    document.removeEventListener("compositionend", onCompositionEnd, true);
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
    isComposing = false;
    console.log("[SupertagPalette] Destroyed.");
}

function onCompositionStart() {
    isComposing = true;
}

function onCompositionUpdate() {
    isComposing = true;
}

function onCompositionEnd(e: CompositionEvent) {
    isComposing = false;
    lastCompositionEndTime = Date.now();
    // 输入法选词定稿后，立即触发一次编辑器输入解析，更新面板搜索结果
    onEditorInput(e);
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

function getEditorTextBeforeCursor(range: Range): string {
    const startNode = range.startContainer;
    const startOffset = range.startOffset;

    // 1. 如果光标所在直接就是文本节点
    if (startNode.nodeType === Node.TEXT_NODE) {
        let text = (startNode.textContent || "").substring(0, startOffset);
        // 如果当前文本节点里已经能找到 @ 或 ＠，直接返回
        if (text.includes(TRIGGER_ASCII) || text.includes(TRIGGER_FULL)) {
            return text;
        }
        // 如果当前文本节点没有 @，可能是被思源拆分到了前一个兄弟节点中，向左回溯兄弟节点
        let prev = startNode.previousSibling;
        while (prev) {
            const prevText = prev.textContent || "";
            text = prevText + text;
            if (prevText.includes(TRIGGER_ASCII) || prevText.includes(TRIGGER_FULL)) {
                break;
            }
            prev = prev.previousSibling;
        }
        return text;
    }

    // 2. 如果光标所在是 Element 容器节点 (例如 span 或 div)
    const elem = startNode as HTMLElement;
    let text = "";
    for (let i = 0; i < startOffset; i++) {
        text += elem.childNodes[i]?.textContent || "";
    }
    // 如果当前容器内未找到 @，向左回溯容器的前一个兄弟
    if (!text.includes(TRIGGER_ASCII) && !text.includes(TRIGGER_FULL)) {
        let prev = elem.previousSibling;
        while (prev) {
            const prevText = prev.textContent || "";
            text = prevText + text;
            if (prevText.includes(TRIGGER_ASCII) || prevText.includes(TRIGGER_FULL)) {
                break;
            }
            prev = prev.previousSibling;
        }
    }
    return text;
}

async function onEditorInput(e: Event) {
    if (!settings.get("devMode")) {
        if (isOpen) closePalette();
        return;
    }

    // 🌟 中文输入法合成期保护：输入拼音过程中不触发标签解析（避免拼音空格导致误关）
    if (isComposing || (e as any).isComposing) {
        return;
    }

    const target = e.target as HTMLElement;
    if (!target.closest || !target.closest(".protyle-wysiwyg")) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    const textBefore = getEditorTextBeforeCursor(range);

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
            // 遵循思源官方规则：非输入法状态下，一旦在 @ 后紧接着输入换行或以空格开头，退出选择
            if (queryText.includes("\n") || queryText.startsWith(" ") || queryText.startsWith("　")) {
                closePalette();
                return;
            }
            await renderList(queryText);
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
    await openPalette(queryText, range);
}

function onEditorKeydown(e: KeyboardEvent) {
    if (!isOpen || !paletteEl) return;

    // 🌟 核心输入法保护：
    // 1. 正在 IME 合成中，放行所有按键（供输入法选字）
    if (isComposing || e.isComposing || e.keyCode === 229 || e.key === "Process") {
        return;
    }

    // 2. 刚刚完成 IME 选词上屏（120ms 内）的 Enter / Space 是输入法自身按键，严禁拦截并误触发面板回车确认！
    if (Date.now() - lastCompositionEndTime < 120) {
        return;
    }

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
    const target = e.target as HTMLElement;
    if (target?.closest && target.closest(".protyle-wysiwyg")) {
        // 点击编辑器内部由 onEditorInput 处理光标偏移，不直接粗暴销毁
        return;
    }
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

import { getUnifiedSupertagList, type UnifiedSupertagDefinition } from "../core/supertag-entity";

async function renderList(query: string) {
    if (!paletteEl) return;
    const currentSeq = ++renderSeq;

    const allSupertags = await getUnifiedSupertagList();
    if (currentSeq !== renderSeq || !isOpen || !paletteEl) return;

    paletteEl.innerHTML = "";
    currentTagList = [];

    const queryClean = query.trim().replace(/^[@＠#]+/, "");
    const queryLower = queryClean.toLowerCase();

    const seen = new Set<string>();
    const matched = allSupertags.filter(t => {
        if (!t.enabled) return false;
        if (seen.has(t.typeName)) return false;
        seen.add(t.typeName);
        if (!queryLower) return true;
        return t.typeName.toLowerCase().includes(queryLower) || t.displayName.toLowerCase().includes(queryLower);
    });

    let activeBlock = activeProtyle ? findActiveBlock(activeProtyle) : null;
    if (activeBlock) {
        const parentLi = activeBlock.closest('[data-type="NodeListItem"]') as HTMLElement | null;
        if (parentLi && parentLi !== activeBlock) {
            activeBlock = parentLi;
        }
    }
    const currentBlockType = activeBlock ? getBlockType(activeBlock) : null;

    const incompatibleTags = new Set<string>();
    if (currentBlockType) {
        for (const item of matched) {
            for (const bound of item.logicConfigs) {
                const cmdDef = commandRegistry.getCommand(bound.commandRef);
                if (cmdDef?.meta?.appliesTo && cmdDef.meta.appliesTo.length > 0 && !cmdDef.meta.appliesTo.includes("any")) {
                    if (!cmdDef.meta.appliesTo.includes(currentBlockType as any)) {
                        incompatibleTags.add(item.typeName);
                        break;
                    }
                }
            }
        }
    }

    currentTagList = matched.map(m => m.typeName);

    if (currentTagList.length === 0) {
        paletteEl.innerHTML = `<div style="font-size: 11px; text-align: center; padding: 16px 0; color: var(--indexos-text-muted); font-family: ui-monospace, monospace;">无匹配的超级标签 (@)</div>`;
        return;
    }

    if (selectedIndex >= currentTagList.length) {
        selectedIndex = 0;
    }

    const container = document.createElement("div");
    container.style.cssText = "display: flex; flex-direction: column; gap: 3px;";

    matched.forEach((item, index) => {
        const isIncompat = incompatibleTags.has(item.typeName);
        const isReady = item.isReady;
        const el = document.createElement("div");
        el.className = `b3-list-item b3-list-item--narrow ${index === selectedIndex ? "b3-list-item--focus" : ""}`;
        el.setAttribute("data-tag-name", item.typeName);
        el.setAttribute("data-index", String(index));

        const opacityStyle = isIncompat ? "opacity: 0.35;" : (isReady ? "" : "opacity: 0.62;");
        el.style.cssText = `display: flex; align-items: center; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; transition: all 0.15s ease; ${opacityStyle}`;

        const iconColor = isIncompat ? "var(--indexos-text-muted)" : (isReady ? "var(--indexos-accent-primary)" : "var(--indexos-text-muted)");
        let html = `<svg class="b3-list-item__graphic" style="width: 13px; height: 13px; color: ${iconColor}; margin-right: 8px; flex-shrink: 0;"><use xlink:href="#iconTags"></use></svg>`;
        html += `<span class="b3-list-item__text" style="color: var(--indexos-text-main); font-weight: 600;">@${item.typeName}</span>`;

        if (item.isBuiltin) {
            html += `<span class="indexos-tag-badge indexos-tag-badge--builtin" style="margin-left: 6px; font-size: 9px; padding: 1px 4px;">内置</span>`;
        }

        if (item.hasDataSchema) {
            html += `<span style="font-size: 10px; opacity: 0.75; margin-left: 6px; font-weight: normal; color: var(--indexos-text-muted);">📊 属性</span>`;
        }

        if (item.hasBehavior) {
            html += `<span style="font-size: 10px; opacity: 0.75; margin-left: 4px; font-weight: normal; color: var(--indexos-text-muted);">⚡ 动作</span>`;
        }

        if (!item.hasDataSchema && !item.hasBehavior) {
            html += `<span style="font-size: 9px; opacity: 0.75; margin-left: auto; font-weight: normal; color: var(--indexos-text-muted); font-family: ui-monospace, monospace;">未建库 · 打标自建</span>`;
        } else if (isIncompat) {
            html += `<span style="margin-left: auto; font-size: 9px; color: var(--indexos-text-muted); opacity: 0.8; font-family: ui-monospace, monospace;">不推荐</span>`;
        }

        el.innerHTML = html;
        container.appendChild(el);
    });

    paletteEl.appendChild(container);
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

function removeTriggerAndQuery(range: Range) {
    const sel = window.getSelection();
    if (!sel || !range) return;

    const startNode = range.startContainer;
    const offset = range.startOffset;

    if (startNode.nodeType === Node.TEXT_NODE) {
        const text = startNode.textContent || "";
        const textBefore = text.substring(0, offset);
        const textAfter = text.substring(offset);

        const lastAscii = textBefore.lastIndexOf(TRIGGER_ASCII);
        const lastFull = textBefore.lastIndexOf(TRIGGER_FULL);
        const lastPos = Math.max(lastAscii, lastFull);

        if (lastPos !== -1) {
            startNode.textContent = textBefore.substring(0, lastPos) + textAfter;
            const newRange = document.createRange();
            newRange.setStart(startNode, Math.min(lastPos, startNode.textContent.length));
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
            return;
        }

        // 如果当前节点没有 @，说明 @ 在前面的兄弟节点中 (IME 合成节点分拆)
        startNode.textContent = textAfter;
        let prev = startNode.previousSibling;
        while (prev) {
            const pText = prev.textContent || "";
            const pAscii = pText.lastIndexOf(TRIGGER_ASCII);
            const pFull = pText.lastIndexOf(TRIGGER_FULL);
            const pPos = Math.max(pAscii, pFull);
            if (pPos !== -1) {
                prev.textContent = pText.substring(0, pPos);
                const newRange = document.createRange();
                if (prev.nodeType === Node.TEXT_NODE) {
                    newRange.setStart(prev, pPos);
                } else {
                    newRange.setStartAfter(prev);
                }
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
                break;
            } else {
                const toRemove = prev;
                prev = prev.previousSibling;
                toRemove.parentNode?.removeChild(toRemove);
            }
        }
    }
}

async function applySupertag(tag: string) {
    const protyle = activeProtyle || (window as any).activeProtyleInstance;
    let blockEl = protyle ? findActiveBlock(protyle) : null;

    let oldHTML = "";
    if (blockEl) {
        // 🌟 列表项层级提权：如果当前所在块是 NodeListItem 内部的段落，自动提权将 Supertag 绑定给宿主 NodeListItem
        const parentLi = blockEl.closest('[data-type="NodeListItem"]') as HTMLElement | null;
        if (parentLi && parentLi !== blockEl) {
            blockEl = parentLi;
        }
        oldHTML = blockEl.outerHTML;
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        removeTriggerAndQuery(sel.getRangeAt(0));
    }

    closePalette();

    if (!blockEl) return;

    const blockId = blockEl.getAttribute("data-node-id")!;
    const raw = blockEl.getAttribute("custom-supertags");
    const currentCustom = parseSupertags(raw);
    const updatedCustom = Array.from(new Set([...currentCustom, tag]));
    const updatedCustomJSON = serializeSupertags(updatedCustom);

    blockEl.setAttribute("custom-supertags", updatedCustomJSON);
    globalSupertagsCache.set(blockId, updatedCustom);

    // 触发局部 input 事件通知 Protyle 文本已修改，不触发整块重建
    const editEl = blockEl.querySelector('[contenteditable="true"]') || blockEl;
    editEl.dispatchEvent(new Event("input", { bubbles: true }));

    try {
        await post("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs: {
                "custom-supertags": updatedCustomJSON
            }
        });
    } catch (e) {
        console.error("[SupertagPalette] setBlockAttrs failed:", e);
    }

    await supertagMonitor.processNewTag(blockId, tag);
    if (protyle) {
        SupertagRenderer.render(protyle);
    }
}
