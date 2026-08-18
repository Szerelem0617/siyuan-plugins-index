/**
 * Command Palette — triggered by ";;" (or "；；")
 *
 * Architecture:
 *  - Listens to every "input" event on the wysiwyg editor via capture.
 *  - When ";;" (or fullwidth "；；") is detected at the end of the current
 *    text node, the palette element is shown near the cursor.
 *  - 2D Grid Matrix Layout (No command ID display).
 *  - 4-way direction keyboard navigation (↑↓←→), Enter to execute, Escape to dismiss.
 */

import { dispatchCommand } from "../command-dispatcher";

export interface PaletteCommand {
    id: string;
    label: string;
    description?: string;
    commandId: string;
    commandParam: string;
    requiresParams: string;
}

// ─── State ────────────────────────────────────────────────────────────────────
let paletteEl: HTMLElement | null = null;
let registeredCommands: PaletteCommand[] = [];
let filteredCommands: PaletteCommand[] = [];
let triggerTextNode: Text | null = null; // The text node that contains ";;"
let isOpen = false;
let inputListenerAttached = false;
let keyListenerAttached = false;

const GRID_COLS = 2; // 二维网格列数

// ─── Public API ───────────────────────────────────────────────────────────────

export function updateCommandPaletteList(cmds: PaletteCommand[]) {
    registeredCommands = cmds;
}

export function initCommandPalette() {
    ensurePaletteEl();
    if (!inputListenerAttached) {
        document.addEventListener("input", onEditorInput, true);
        inputListenerAttached = true;
    }
    if (!keyListenerAttached) {
        document.addEventListener("keydown", onEditorKeydown, true);
        keyListenerAttached = true;
    }
    // Clicking outside closes the palette
    document.addEventListener("mousedown", onOutsideClick, true);
    console.log("[CommandPalette] Initialized.");
}

export function destroyCommandPalette() {
    document.removeEventListener("input", onEditorInput, true);
    document.removeEventListener("keydown", onEditorKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick, true);
    if (paletteEl) {
        paletteEl.remove();
        paletteEl = null;
    }
    inputListenerAttached = false;
    keyListenerAttached = false;
    isOpen = false;
    console.log("[CommandPalette] Destroyed.");
}

// ─── Palette Element ──────────────────────────────────────────────────────────

function ensurePaletteEl() {
    if (!paletteEl) {
        paletteEl = document.createElement("div");
        paletteEl.className = "protyle-hint indexos-weak-floating-panel fn__none";
        paletteEl.id = "siyuan-plugin-cmd-palette";
        paletteEl.setAttribute("data-close", "false");
        paletteEl.style.cssText = "position:fixed;z-index:9999;width:480px;max-width:90vw;max-height:min(420px,50vh);overflow-y:auto;background:var(--indexos-bg-base);border:1px solid var(--indexos-border-light);border-radius:6px;box-shadow:0 16px 48px rgba(0,0,0,0.18), 0 0 12px var(--indexos-accent-glow);padding:0;";
        document.body.appendChild(paletteEl);

        // Click handler for list items
        paletteEl.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btn = (e.target as HTMLElement).closest("button[data-cmd-id]") as HTMLElement;
            if (btn) {
                const cmdId = btn.getAttribute("data-cmd-id");
                executeCommand(cmdId);
            }
        });
    }
    return paletteEl;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

function onEditorInput(e: Event) {
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

    // Detect trigger: ";;" or "；；" at end of typed text
    const TRIGGER_ASCII = ";;";
    const TRIGGER_FULL = "；；";
    let queryText = "";

    if (textBefore.endsWith(TRIGGER_ASCII) || textBefore.endsWith(TRIGGER_FULL)) {
        queryText = "";
    } else if (isOpen) {
        // Already open — extract search term after ";;"
        const triggerPos = Math.max(
            textBefore.lastIndexOf(TRIGGER_ASCII),
            textBefore.lastIndexOf(TRIGGER_FULL)
        );
        if (triggerPos !== -1) {
            queryText = textBefore.substring(triggerPos + 2);
            renderList(queryText);
            repositionPalette(range);
            return;
        } else {
            // Trigger removed by deletion — close
            closePalette();
            return;
        }
    } else {
        return; // Not triggered, not open
    }

    // Fresh trigger detected
    triggerTextNode = textNode;
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

    if (e.key === " " || e.key === "Spacebar" || e.code === "Space") {
        closePalette();
        return;
    }

    // 2D Matrix Grid Directional Navigation
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();

        let delta = 0;
        if (e.key === "ArrowDown") delta = GRID_COLS;
        else if (e.key === "ArrowUp") delta = -GRID_COLS;
        else if (e.key === "ArrowRight") delta = 1;
        else if (e.key === "ArrowLeft") delta = -1;

        navigateItems2D(delta);
        return;
    }

    if (e.key === "Enter") {
        const focused = paletteEl.querySelector(".b3-list-item--focus") as HTMLElement;
        if (focused) {
            e.preventDefault();
            e.stopPropagation();
            const cmdId = focused.getAttribute("data-cmd-id");
            executeCommand(cmdId);
        }
        return;
    }
}

function onOutsideClick(e: MouseEvent) {
    if (!isOpen || !paletteEl) return;
    if (!paletteEl.contains(e.target as Node)) {
        closePalette();
    }
}

// ─── Palette UI ───────────────────────────────────────────────────────────────

function openPalette(query: string, range: Range) {
    isOpen = true;
    renderList(query);
    repositionPalette(range);
}

function closePalette() {
    if (!paletteEl) return;
    paletteEl.classList.add("fn__none");
    paletteEl.innerHTML = "";
    isOpen = false;
    triggerTextNode = null;
}

function renderList(query: string) {
    if (!paletteEl) return;

    filteredCommands = query
        ? registeredCommands.filter(cmd =>
            cmd.label.toLowerCase().includes(query.toLowerCase()) ||
            cmd.commandId.toLowerCase().includes(query.toLowerCase()) ||
            (cmd.description || "").toLowerCase().includes(query.toLowerCase())
        )
        : registeredCommands;

    if (filteredCommands.length === 0) {
        paletteEl.innerHTML = `<div style="padding: 12px; font-family: ui-monospace, monospace; font-size: 12px; color: var(--indexos-text-muted); text-align: center;">没有匹配的快捷命令</div>`;
        paletteEl.classList.remove("fn__none");
        return;
    }

    const header = `<div style="padding: 8px 12px 6px; font-family: ui-monospace, monospace; font-size: 11px; font-weight: 600; color: var(--indexos-text-muted); border-bottom: 1px solid var(--indexos-border-light); display: flex; justify-content: space-between; align-items: center; text-transform: uppercase; letter-spacing: 0.08em; background: var(--indexos-bg-surface);">
        <span>COMMAND PALETTE</span>
        <span style="font-size: 10px; opacity: 0.7; font-weight: normal;">↑↓←→ 导航  Enter 执行  Esc 关闭</span>
    </div>`;

    const itemsHtml = filteredCommands.map((cmd, idx) => `
        <button class="indexos-palette-card${idx === 0 ? " b3-list-item--focus" : ""}"
                data-cmd-id="${cmd.id}"
                title="${escapeHtml(cmd.label)}">
            <svg class="card-icon"><use xlink:href="#iconPlay"></use></svg>
            <div class="card-body">
                <div class="card-title">${escapeHtml(cmd.label)}</div>
                ${cmd.description ? `<div class="card-desc">${escapeHtml(cmd.description)}</div>` : `<div class="card-desc" style="opacity:0.4;">;;菜单</div>`}
            </div>
        </button>
    `).join("");

    const gridWrapper = `<div class="indexos-palette-grid">${itemsHtml}</div>`;

    paletteEl.innerHTML = header + gridWrapper;
    paletteEl.classList.remove("fn__none");
}

function navigateItems2D(delta: number) {
    if (!paletteEl) return;
    const items = Array.from(paletteEl.querySelectorAll("button[data-cmd-id]")) as HTMLElement[];
    if (items.length === 0) return;
    const currentIdx = items.findIndex(el => el.classList.contains("b3-list-item--focus"));
    const startIdx = currentIdx >= 0 ? currentIdx : 0;
    
    items[startIdx]?.classList.remove("b3-list-item--focus");
    let nextIdx = startIdx + delta;
    if (nextIdx < 0) nextIdx = items.length - 1;
    if (nextIdx >= items.length) nextIdx = 0;

    items[nextIdx].classList.add("b3-list-item--focus");
    items[nextIdx].scrollIntoView({ block: "nearest" });
}

function repositionPalette(range: Range) {
    if (!paletteEl) return;
    const rect = range.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let top = rect.bottom + 4;
    let left = rect.left;

    // Ensure it doesn't go off screen
    paletteEl.style.visibility = "hidden";
    paletteEl.classList.remove("fn__none");
    const elH = paletteEl.offsetHeight;
    const elW = paletteEl.offsetWidth;
    paletteEl.style.visibility = "";

    if (top + elH > viewportH - 8) {
        top = rect.top - elH - 4;
    }
    if (left + elW > viewportW - 8) {
        left = viewportW - elW - 8;
    }

    paletteEl.style.top = `${Math.max(8, top)}px`;
    paletteEl.style.left = `${Math.max(8, left)}px`;
}

function executeCommand(cmdId: string | null) {
    if (!cmdId) return;
    const cmd = registeredCommands.find(c => c.id === cmdId);
    if (!cmd) return;

    // 先捕获真实块上下文（触发 ";;" 所在块的 data-node-id），再删除触发文本。
    // 不能继续用 document.body：会让 {{block_id}} 解析为空，插入类命令会因缺少目标触发思源整页重载。
    const blockEl = triggerTextNode
        ? (triggerTextNode.parentElement?.closest("[data-node-id]") as HTMLElement | null)
        : null;
    const protyleEl = (blockEl?.closest(".protyle-content") as HTMLElement | null)
        || (window as any).activeProtyleInstance?.element
        || null;
    const context = { blockEl: blockEl || document.body, protyleEl: protyleEl as HTMLElement | null };

    // Delete the ";;" trigger text before executing
    deleteTrigger();

    dispatchCommand(cmd.commandId, cmd.commandParam, context as any);
    closePalette();
}

function deleteTrigger() {
    if (!triggerTextNode) return;
    try {
        const text = triggerTextNode.textContent || "";
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const curOffset = range.startOffset;

        // Find end of ";;" (or "；；") in the text before cursor
        const textBefore = text.substring(0, curOffset);
        const triggerPos = Math.max(
            textBefore.lastIndexOf(";;"),
            textBefore.lastIndexOf("；；")
        );
        if (triggerPos === -1) return;

        // Delete from triggerPos to curOffset (inclusive of any typed search text)
        const delRange = document.createRange();
        delRange.setStart(triggerTextNode, triggerPos);
        delRange.setEnd(triggerTextNode, curOffset);
        delRange.deleteContents();

        // Reposition cursor
        const newRange = document.createRange();
        newRange.setStart(triggerTextNode, triggerPos);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
    } catch (e) {
        console.warn("[CommandPalette] deleteTrigger failed:", e);
    }
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
