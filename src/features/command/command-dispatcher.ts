import { globalCommand } from "siyuan";
import { plugin } from "../../shared/utils";
import { post } from "../../shared/api-client/request";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DOM context for the block that triggered the command.
 * Both fields are optional — dispatcher degrades gracefully when unavailable.
 */
export interface CommandContext {
    /** The data-node-id block element being acted upon */
    blockEl: HTMLElement;
    /** The .protyle-content ancestor container */
    protyleEl: HTMLElement | null;
}

/** Parsed representation of the "Command Param" AV field (JSON string). */
export type CommandParams = Record<string, unknown>;

export interface DispatchResult {
    success: boolean;
    /** Which dispatch path was taken */
    method: "keyboard" | "global" | "api" | "unknown";
    detail: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Universal command dispatcher.
 *
 * Routing logic (determined by the commandId prefix):
 *
 *   editor.*   →  Keyboard event on .protyle-wysiwyg
 *                 Hotkey is looked up from window.siyuan.config.keymap.
 *
 *   general.*  →  globalCommand() via the SiYuan SDK.
 *                 The bare name after the last "." is passed to globalCommand.
 *
 *   api.*      →  REST API call. The path after "api." maps to the endpoint,
 *                 e.g. "api.block.insertBlock" → POST /api/block/insertBlock.
 *                 The params object is sent as the request body,
 *                 with context block ID injected automatically where needed.
 *
 * @param commandId  Dotted command identifier stored in the AV "Command ID" field.
 * @param rawParam   Raw JSON string from the AV "Command Param" field (may be empty).
 * @param context    DOM context of the target block.
 */
export async function dispatchCommand(
    commandId: string,
    rawParam: string | null | undefined,
    context: CommandContext
): Promise<DispatchResult> {
    const params = parseParam(rawParam);
    const prefix = commandId.split(".")[0];

    try {
        switch (prefix) {
            case "editor":
                return dispatchKeyboard(commandId, context);

            case "general":
                return dispatchGlobal(commandId);

            case "api":
                return await dispatchApi(commandId, params, context);

            default:
                console.warn(`[Dispatcher] Unknown prefix for command: ${commandId}`);
                return { success: false, method: "unknown", detail: `Unknown prefix: ${prefix}` };
        }
    } catch (err) {
        console.error(`[Dispatcher] Error dispatching command [${commandId}]:`, err);
        return { success: false, method: "unknown", detail: String(err) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus helpers (called around keyboard dispatch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Focus the wysiwyg container and place the Selection cursor inside blockEl.
 * Must be called AFTER the context menu is already closed.
 */
export function focusBlockForDispatch(blockEl: HTMLElement, protyleEl: HTMLElement | null): void {
    // 1. Mark block as selected
    document.querySelectorAll(".protyle-wysiwyg--select")
        .forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    blockEl.classList.add("protyle-wysiwyg--select");

    // 2. Focus the wysiwyg container (not the contenteditable directly,
    //    so we don't corrupt the browser's isOnlyMeta detection)
    const wysiwygEl = (protyleEl?.querySelector(".protyle-wysiwyg")
        || blockEl.closest(".protyle-wysiwyg")) as HTMLElement | null;
    if (wysiwygEl) {
        wysiwygEl.focus({ preventScroll: true });
    }

    // 3. Collapse the Selection to the start of blockEl's content
    try {
        const contentEl = (
            blockEl.querySelector('[contenteditable="true"]')
            || wysiwygEl
            || blockEl
        ) as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(contentEl);
        range.collapse(true);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
    } catch (e) {
        console.warn("[Dispatcher] focusBlockForDispatch: failed to set range", e);
    }
}

/** Remove the --select class and clear the Selection after a command runs. */
export function cleanupAfterDispatch(): void {
    document.querySelectorAll(".protyle-wysiwyg--select")
        .forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    window.getSelection()?.removeAllRanges();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch paths
// ─────────────────────────────────────────────────────────────────────────────

function dispatchKeyboard(commandId: string, context: CommandContext): DispatchResult {
    const keymap = (window as any).siyuan?.config?.keymap;
    let hotkey: string | null = null;

    if (keymap) {
        const parts = commandId.split("."); // ["editor","general","insertAfter"]
        let node: any = keymap;
        for (const part of parts) {
            node = node?.[part];
            if (!node) break;
        }
        hotkey = node?.custom || node?.default || null;
    }

    if (!hotkey) {
        console.warn(`[Dispatcher] No hotkey found in keymap for: ${commandId}`);
        return { success: false, method: "keyboard", detail: `No hotkey for ${commandId}` };
    }

    const synthTarget = (
        context.protyleEl?.querySelector(".protyle-wysiwyg")
        || context.blockEl.closest(".protyle-wysiwyg")
    ) as HTMLElement | null;

    if (!synthTarget) {
        return { success: false, method: "keyboard", detail: "No .protyle-wysiwyg target found" };
    }

    const keyEvent = hotkeyToKeyboardEvent(hotkey);
    if (!keyEvent) {
        return { success: false, method: "keyboard", detail: `Failed to synthesize KeyboardEvent for ${hotkey}` };
    }

    console.log(`[Dispatcher] keyboard → [${commandId}] key="${keyEvent.key}" ctrl=${keyEvent.ctrlKey} meta=${keyEvent.metaKey}`);
    synthTarget.dispatchEvent(keyEvent);
    return { success: true, method: "keyboard", detail: hotkey };
}

function dispatchGlobal(commandId: string): DispatchResult {
    const bareCmd = commandId.split(".").pop()!;
    console.log(`[Dispatcher] global  → globalCommand(${bareCmd})`);
    globalCommand(bareCmd, plugin.app);
    return { success: true, method: "global", detail: bareCmd };
}

async function dispatchApi(
    commandId: string,
    params: CommandParams,
    context: CommandContext
): Promise<DispatchResult> {
    // "api.block.insertBlock" → "/api/block/insertBlock"
    const endpoint = "/" + commandId.replace(/\./g, "/");

    // Auto-inject context block ID under common field names if not already set
    const blockId = context.blockEl?.getAttribute("data-node-id") ?? "";
    const body: Record<string, unknown> = {
        id: blockId,
        ...params,
    };

    console.log(`[Dispatcher] api     → POST ${endpoint}`, body);
    const result = await post(endpoint, body);
    return { success: true, method: "api", detail: `${endpoint} → ${JSON.stringify(result).slice(0, 80)}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hotkey synthesis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a SiYuan hotkey string (Mac symbol format) to a KeyboardEvent.
 *
 * Platform rules (mirrors SiYuan's isOnlyMeta):
 *   Mac     → ⌘ = metaKey=true,  ctrlKey=false
 *   Windows → ⌘ = metaKey=false, ctrlKey=true
 */
function hotkeyToKeyboardEvent(hotkey: string): KeyboardEvent | null {
    try {
        const isMacPlatform = navigator.platform.toUpperCase().indexOf("MAC") > -1;
        let ctrlKey = false, shiftKey = false, altKey = false, metaKey = false;
        let keyStr = hotkey;

        if (keyStr.includes("⌃")) { ctrlKey = true; keyStr = keyStr.replace("⌃", ""); }
        if (keyStr.includes("⌘")) {
            if (isMacPlatform) { metaKey = true; } else { ctrlKey = true; }
            keyStr = keyStr.replace("⌘", "");
        }
        if (keyStr.includes("⇧")) { shiftKey = true; keyStr = keyStr.replace("⇧", ""); }
        if (keyStr.includes("⌥")) { altKey = true; keyStr = keyStr.replace("⌥", ""); }

        const keyMap: Record<string, string> = {
            "↩": "Enter", "⌫": "Backspace", "⌦": "Delete", "⇥": "Tab",
            "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight",
        };
        const key = keyMap[keyStr] || keyStr || "Unidentified";

        let keyCode = 0;
        if (key.length === 1) keyCode = key.toUpperCase().charCodeAt(0);
        else if (key === "Enter") keyCode = 13;
        else if (key === "Backspace") keyCode = 8;
        else if (key === "Delete") keyCode = 46;
        else if (key === "Tab") keyCode = 9;

        return new KeyboardEvent("keydown", {
            key, ctrlKey, shiftKey, altKey, metaKey,
            bubbles: true, cancelable: true, composed: true,
            keyCode,
        });
    } catch (e) {
        console.warn(`[Dispatcher] hotkeyToKeyboardEvent failed for "${hotkey}":`, e);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Param parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the raw JSON string from the AV "Command Param" field.
 * Returns an empty object on failure or when the input is empty.
 */
export function parseParam(raw: string | null | undefined): CommandParams {
    if (!raw || raw.trim() === "") return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as CommandParams;
        }
        console.warn("[Dispatcher] Command Param is not a plain object:", raw);
        return {};
    } catch (e) {
        console.warn("[Dispatcher] Failed to parse Command Param JSON:", raw, e);
        return {};
    }
}
