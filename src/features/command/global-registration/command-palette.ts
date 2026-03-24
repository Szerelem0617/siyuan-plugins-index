/**
 * Command Palette — triggered by ";;" (or "；；")
 *
 * Architecture:
 *  - Listens to every "input" event on the wysiwyg editor via capture.
 *  - When ";;" (or fullwidth "；；") is detected at the end of the current
 *    text node, the palette element is shown near the cursor.
 *  - The user can type to filter, use ↑/↓ to navigate, Enter to execute,
 *    Escape to dismiss.
 *  - Selecting an item deletes the ";;" trigger text and calls the
 *    corresponding registered command via dispatchCommand.
 *  - The palette mirrors SiYuan's ".protyle-hint .b3-list" CSS classes so
 *    it automatically inherits the theme styling.
 */

import { dispatchCommand } from "../command-dispatcher";

export interface PaletteCommand {
    id: string;
    label: string;
    description?: string;
    commandId: string;
    commandParam: string;
    commandType: string;
}

// ─── State ────────────────────────────────────────────────────────────────────
let paletteEl: HTMLElement | null = null;
let registeredCommands: PaletteCommand[] = [];
let filteredCommands: PaletteCommand[] = [];
let triggerTextNode: Text | null = null; // The text node that contains ";;"
let isOpen = false;
let inputListenerAttached = false;
let keyListenerAttached = false;

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
        // Reuse SiYuan's native hint classes for automatic theme-matching
        paletteEl.className = "protyle-hint b3-list b3-list--background fn__none";
        paletteEl.id = "siyuan-plugin-cmd-palette";
        paletteEl.setAttribute("data-close", "false");
        paletteEl.style.cssText = "position:fixed;z-index:9999;min-width:320px;max-width:560px;max-height:min(402px,40vh);overflow-y:auto;";
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

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        navigateItems(e.key === "ArrowDown" ? 1 : -1);
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
        paletteEl.innerHTML = `<div class="b3-list-item b3-list-item--two" style="padding: 8px 12px; color: var(--b3-theme-on-surface-light);">没有匹配的命令 (Command-DB 中勾选"启用"项)</div>`;
        paletteEl.classList.remove("fn__none");
        return;
    }

    const header = `<div style="padding: 4px 12px 4px; font-size:11px; color:var(--b3-theme-on-surface-light); border-bottom: 1px solid var(--b3-border-color);">
        <strong>插件命令</strong>  <span style="opacity:0.6">↑↓ 选择   Enter 执行   Esc 关闭</span>
    </div>`;

    const items = filteredCommands.map((cmd, idx) => `
        <button class="b3-list-item b3-list-item--two${idx === 0 ? " b3-list-item--focus" : ""}"
                data-cmd-id="${cmd.id}"
                style="width:100%;text-align:left;">
            <div class="b3-list-item__first">
                <svg class="b3-list-item__graphic"><use xlink:href="#iconPlay"></use></svg>
                <span class="b3-list-item__text">${escapeHtml(cmd.label)}</span>
                <span class="b3-list-item__meta">${escapeHtml(cmd.commandId)}</span>
            </div>
            ${cmd.description ? `<div class="b3-list-item__meta b3-list-item__showall">${escapeHtml(cmd.description)}</div>` : ""}
        </button>
    `).join("");

    paletteEl.innerHTML = header + items;
    paletteEl.classList.remove("fn__none");
}

function navigateItems(direction: 1 | -1) {
    if (!paletteEl) return;
    const items = Array.from(paletteEl.querySelectorAll("button[data-cmd-id]")) as HTMLElement[];
    if (items.length === 0) return;
    const currentIdx = items.findIndex(el => el.classList.contains("b3-list-item--focus"));
    items[currentIdx]?.classList.remove("b3-list-item--focus");
    const nextIdx = (currentIdx + direction + items.length) % items.length;
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

    // Delete the ";;" trigger text before executing
    deleteTrigger();

    const mockContext = { blockEl: document.body, protyleEl: null };
    dispatchCommand(cmd.commandId, cmd.commandParam, mockContext as any);
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
