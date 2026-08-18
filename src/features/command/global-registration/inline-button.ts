import { dispatchCommand } from "../command-dispatcher";
import { commandRegistry } from "../registry/command-registry";
import { showMessage, Dialog } from "siyuan";
import { isDevInitSysEnabled, SUPERTAG_REGISTRY, COMMAND_BINDINGS } from "../registration";
import { refreshSupertagRegistry } from "../utils/sync-service";
import { openIndexDropdown } from "../../../ui/components/index-dropdown";

// ─────────────────────────────────────────────────────────────────────────────
// Protocol helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 思源 3.7.3 官方标准 Plugin Protocol 格式：
 *   siyuan://plugins/siyuan-plugins-index/exec/{commandIdOrName}?p={encodedParam}
 */
const PROTOCOL = "siyuan://plugins/siyuan-plugins-index/";

export interface BtnPayload {
    /** 命令 ID 或中文名 */
    command: string;
    /** 附加参数（可选） */
    param?: string;
    /** 按钮显示文本（写链接时原样存，读链接时只取 command） */
    label?: string;
}

/** 将 payload 序列化为思源 3.7.3 规范的 siyuan://plugins/siyuan-plugins-index/ URL */
export function encodeBtnHref(payload: BtnPayload): string {
    const cmdPart = encodeURIComponent(payload.command);
    const params = new URLSearchParams();
    if (payload.param) params.set("p", payload.param);
    const query = params.toString();
    return `${PROTOCOL}exec/${cmdPart}${query ? "?" + query : ""}`;
}

/** 从 siyuan:// URL 解析 payload */
export function decodeBtnHref(href: string): BtnPayload | null {
    if (!href) return null;
    // 严格精准判断：必须以前缀协议开头，防止普通的 GitHub 地址/文件路径误触
    if (!href.startsWith(PROTOCOL) && !href.startsWith("siyuan://plugins/siyuan-plugins-index/") && !href.startsWith("siyuan-btn://")) {
        return null;
    }
    let rest = href;
    if (href.startsWith(PROTOCOL)) rest = href.slice(PROTOCOL.length);
    else if (href.startsWith("siyuan://plugins/siyuan-plugins-index/")) rest = href.slice("siyuan://plugins/siyuan-plugins-index/".length);
    else if (href.startsWith("siyuan-btn://")) rest = href.slice("siyuan-btn://".length);

    if (rest.startsWith("exec/")) {
        try {
            const withoutExec = rest.slice("exec/".length);
            const [cmdEncoded, queryStr] = withoutExec.split("?");
            const command = decodeURIComponent(cmdEncoded);
            const params = new URLSearchParams(queryStr || "");
            return { command, param: params.get("p") || undefined };
        } catch {
            return null;
        }
    }

    try {
        const json = JSON.parse(decodeURIComponent(atob(rest)));
        return { command: json.commandId || "", param: json.param || undefined };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS & DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

function injectButtonCSS() {
    if (document.getElementById("siyuan-plugin-btn-css")) return;
    const style = document.createElement("style");
    style.id = "siyuan-plugin-btn-css";
    style.innerHTML = `
        /* 核心 60fps GPU 绝对平滑扫光切线 keyframes */
        @keyframes indexos-laser-sweep {
            0% {
                transform: translateX(-150%) skewX(-20deg);
            }
            60%, 100% {
                transform: translateX(250%) skewX(-20deg);
            }
        }

        @keyframes indexos-hover-sweep {
            0% {
                transform: translateX(-150%) skewX(-20deg);
            }
            100% {
                transform: translateX(250%) skewX(-20deg);
            }
        }

        /* ─── 0. 通用单色号变量基准 (茵蒂克丝蓝 Token 驱动) ─── */
        span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"],
        span[data-type~="a"][data-href^="siyuan-btn://"],
        .indexos-btn-inline,
        .indexos-virtual-button {
            --btn-color: var(--indexos-index-blue, #A1C4E6);
        }

        /* ─── 1. ☀️ 浅色模式：水润冰蓝 (标准 Token 驱动极光 Glassmorphism) ─── */
        span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"],
        span[data-type~="a"][data-href^="siyuan-btn://"],
        .indexos-btn-inline,
        .indexos-virtual-button {
            position: relative !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 3px 10px !important;
            margin: 0 4px !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            line-height: 1.3 !important;
            border-radius: 3px !important;
            border: 1px solid var(--indexos-index-blue, #A1C4E6) !important;
            background: linear-gradient(
                125deg,
                color-mix(in srgb, var(--indexos-ice-base, #DCEEFA) 80%, #FFFFFF 20%) 0%,
                color-mix(in srgb, var(--btn-color) 70%, #FFFFFF 30%) 50%,
                color-mix(in srgb, var(--btn-color) 85%, var(--indexos-accent-primary, #007ACC) 15%) 100%
            ) !important;
            backdrop-filter: blur(8px) saturate(140%) !important;
            -webkit-backdrop-filter: blur(8px) saturate(140%) !important;
            color: var(--indexos-text-main, #0F243B) !important;
            box-shadow:
                inset 0 1px 1px rgba(255, 255, 255, 0.9),
                inset 0 -1px 2px color-mix(in srgb, var(--btn-color) 60%, var(--indexos-accent-primary, #007ACC) 40%),
                0 2px 6px rgba(0, 122, 204, 0.15) !important;
            cursor: pointer !important;
            overflow: hidden !important;
            vertical-align: middle !important;
            user-select: none !important;
            text-decoration: none !important;
            isolation: isolate !important;
            z-index: 1 !important;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }

        /* 45度斜角纯净晶透扫光切线 (::before) */
        span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"]::before,
        span[data-type~="a"][data-href^="siyuan-btn://"]::before,
        .indexos-btn-inline::before,
        .indexos-virtual-button::before {
            content: "" !important;
            position: absolute !important;
            top: -50% !important;
            left: -100% !important;
            width: 100% !important;
            height: 200% !important;
            background: linear-gradient(
                45deg,
                transparent 0%,
                rgba(255, 255, 255, 0) 30%,
                rgba(255, 255, 255, 0.45) 45%,
                rgba(255, 255, 255, 0.95) 50%,
                rgba(255, 255, 255, 0.45) 55%,
                rgba(255, 255, 255, 0) 70%,
                transparent 100%
            ) !important;
            animation: indexos-laser-sweep 3.2s ease-in-out infinite !important;
            pointer-events: none !important;
            z-index: -1 !important;
            will-change: transform !important;
        }

        /* 悬停 (Hover) 触发单次快速划过 + 全息发光 */
        span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"]:hover,
        span[data-type~="a"][data-href^="siyuan-btn://"]:hover,
        .indexos-btn-inline:hover,
        .indexos-virtual-button:hover {
            border-color: color-mix(in srgb, var(--btn-color) 80%, #0284C7 20%) !important;
            color: color-mix(in srgb, var(--btn-color) 30%, #0284C7 70%) !important;
            background: var(--btn-color) !important;
            box-shadow:
                inset 0 1px 2px rgba(255, 255, 255, 1),
                0 0 16px color-mix(in srgb, var(--btn-color) 50%, transparent 50%) !important;
            transform: translateY(-1px) !important;
        }

        span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"]:hover::before,
        span[data-type~="a"][data-href^="siyuan-btn://"]:hover::before,
        .indexos-btn-inline:hover::before,
        .indexos-virtual-button:hover::before {
            animation: indexos-hover-sweep 0.75s ease-out 1 !important;
        }

        /* ─── 2. 🌙 深色模式：单色号混黑压暗 (color-mix 32% Base + 68% Black/Dark) ─── */
        html[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"],
        html[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"],
        html[data-theme-mode="dark"] .indexos-btn-inline,
        html[data-theme-mode="dark"] .indexos-virtual-button,
        body[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"],
        body[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"],
        body[data-theme-mode="dark"] .indexos-btn-inline,
        body[data-theme-mode="dark"] .indexos-virtual-button,
        .theme-dark span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"],
        .theme-dark span[data-type~="a"][data-href^="siyuan-btn://"],
        .theme-dark .indexos-btn-inline,
        .theme-dark .indexos-virtual-button {
            background: color-mix(in srgb, var(--btn-color) 32%, #0F172A 68%) !important;
            border-color: color-mix(in srgb, var(--btn-color) 45%, #0F172A 55%) !important;
            color: color-mix(in srgb, var(--btn-color) 85%, #FFFFFF 15%) !important;
            border-radius: 3px !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
        }

        html[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"]:hover,
        html[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"]:hover,
        html[data-theme-mode="dark"] .indexos-btn-inline:hover,
        html[data-theme-mode="dark"] .indexos-virtual-button:hover,
        body[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"]:hover,
        body[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"]:hover,
        body[data-theme-mode="dark"] .indexos-btn-inline:hover,
        body[data-theme-mode="dark"] .indexos-virtual-button:hover,
        .theme-dark span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"]:hover,
        .theme-dark span[data-type~="a"][data-href^="siyuan-btn://"]:hover,
        .theme-dark .indexos-btn-inline:hover,
        .theme-dark .indexos-virtual-button:hover {
            background: color-mix(in srgb, var(--btn-color) 45%, #0F172A 55%) !important;
            color: #FFFFFF !important;
            border-color: color-mix(in srgb, var(--btn-color) 70%, #FFFFFF 30%) !important;
            box-shadow: 0 0 14px color-mix(in srgb, var(--btn-color) 40%, transparent 60%) !important;
        }

        /* 👑 Detached commands styling (茵蒂克丝刺绣金 Index Gold - 包含独立参数 ?p=) */
        span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"][data-href*="?p="],
        span[data-type~="a"][data-href^="siyuan-btn://"][data-href*="?p="] {
            --btn-color: var(--indexos-detached-gold, #D9A74A) !important;
            background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.09)) !important;
            border-color: var(--indexos-detached-gold-border, rgba(217, 167, 74, 0.60)) !important;
            color: var(--indexos-detached-gold, #D9A74A) !important;
            font-weight: 600 !important;
        }

        span[data-type~="a"][data-href^="siyuan://plugins/siyuan-plugins-index/"][data-href*="?p="]:hover,
        span[data-type~="a"][data-href^="siyuan-btn://"][data-href*="?p="]:hover {
            background: rgba(217, 167, 74, 0.18) !important;
            border-color: var(--indexos-detached-gold, #D9A74A) !important;
            box-shadow: 0 0 12px var(--indexos-detached-gold-glow, rgba(217, 167, 74, 0.35)) !important;
        }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// Available inline commands registry (fed by entry-registration.ts scan)
// ─────────────────────────────────────────────────────────────────────────────

export interface InlineButtonCmd {
    id: string;
    label: string;
    commandId: string;
    commandParam: string;
    requiresParams: string;
}

let availableInlineCommands: InlineButtonCmd[] = [];

export function updateInlineButtonList(buttonCmds: InlineButtonCmd[]) {
    availableInlineCommands = buttonCmds;
}

export function getInlineButtonCommands(): InlineButtonCmd[] {
    return availableInlineCommands;
}

// ─────────────────────────────────────────────────────────────────────────────

export function getInlineButtonSlashCommand() {
    if (!isDevInitSysEnabled()) return null;

    return {
        filter: ["btn", "button", "按钮"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">插入命令按钮</span><span class="b3-list-item__meta">插件</span></div>`,
        id: "insertSmartButton",
        callback: (protyle: any) => {
            if (typeof protyle.insert === "function") protyle.insert("");

            const href = encodeBtnHref({ command: "sys.configure" });
            const inlineDOM = `<span data-type="a" data-href="${href}">⚙️ 配置命令按钮</span>&#8203;`;

            const selection = window.getSelection();
            let savedRange: Range | null = null;
            if (selection && selection.rangeCount > 0) {
                savedRange = selection.getRangeAt(0).cloneRange();
            }

            setTimeout(() => {
                try {
                    if (savedRange && selection) {
                        selection.removeAllRanges();
                        selection.addRange(savedRange);
                        if (!selection.isCollapsed) document.execCommand("delete");
                    }
                    if (typeof protyle.insert === "function") protyle.insert(inlineDOM, false);
                    else document.execCommand("insertHTML", false, inlineDOM);
                } catch (e) {
                    console.error("[InlineButton] Insert failed:", e);
                }
            }, 50);
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Click handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleInlineButtonClick(event: MouseEvent) {
    const path = event.composedPath();
    const linkEl = path.find((el: any) =>
        el instanceof HTMLElement &&
        el.tagName === "SPAN" &&
        el.getAttribute("data-type")?.includes("a") &&
        el.getAttribute("data-href")?.startsWith(PROTOCOL)
    ) as HTMLElement | undefined;

    if (!linkEl) return;

    event.stopPropagation();
    event.preventDefault();

    const href = linkEl.getAttribute("data-href")!;
    const payload = decodeBtnHref(href);

    if (!payload) {
        showMessage("无法解析按钮链接", -1, "error");
        return;
    }

    // Alt+Click intercepting to open detached parameters dialog
    if (event.altKey && payload.command !== "sys.configure") {
        const { configureDetachedCommand } = await import("./detached-config");
        configureDetachedCommand(linkEl);
        return;
    }

    // ── 配置模式 ──────────────────────────────────────────────────────────
    if (payload.command === "sys.configure") {
        const range = document.createRange();
        range.selectNode(linkEl);
        const selection = window.getSelection();
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        openButtonConfigurationDialog(range);
        return;
    }

    // ── 执行模式：ID 优先，名称备选 ────────────────────────────────────────
    const def = commandRegistry.findByNameOrId(payload.command);
    if (!def) {
        showMessage(`找不到命令「${payload.command}」，请检查按钮链接`, -1, "error");
        return;
    }

    // 1. Force refresh registry to get latest database mapping details
    try {
        await refreshSupertagRegistry();
    } catch (e) {
        console.warn("[InlineButton] Failed to refresh registry:", e);
    }

    // Resolve Param Mapping dynamically with priority
    let paramMapping: any = null;
    const parentBlock = linkEl.closest("[data-node-id]") as HTMLElement | null;

    // 👑 Detached Command Highest Priority: 优先尊重脱钩按钮独立烘焙的硬参数
    if (payload.param !== undefined && payload.param !== null && payload.param !== "") {
        try {
            paramMapping = JSON.parse(payload.param);
        } catch (_) {
            paramMapping = payload.param;
        }
    } else {
        if (parentBlock) {
            // Priority 1: Check if the parent block has any supertags
            const ialString = parentBlock.getAttribute("custom-index-tags") || parentBlock.getAttribute("tag") || parentBlock.getAttribute("tags") || "";
            const blockTags = ialString.split(/[,\s]+/).map((t: string) => t.trim().replace(/#/g, "")).filter(Boolean);
            
            for (const tag of blockTags) {
                const match = SUPERTAG_REGISTRY.find(item =>
                    item.commandRef === def.id && item.typeTag === tag
                );
                if (match) {
                    paramMapping = match.inputMapping ? JSON.stringify(match.inputMapping) : "";
                    break;
                }
            }
        }

        // Priority 2: Use mapping defined for the command globally in Command-DB
        if (paramMapping === null) {
            const cmdConfig = Object.values(COMMAND_BINDINGS).find(c => c.commandRef === payload.command || c.commandRef === def.id);
            if (cmdConfig) {
                paramMapping = cmdConfig.inputMapping;
            }
        }
    }

    const mockContext = {
        blockEl: parentBlock || document.body,
        protyleEl: null,
        triggerEl: linkEl
    };
    dispatchCommand(payload.command, paramMapping, mockContext as any);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paste hook：把 siyuan-btn:// 文本粘贴转换为思源行内链接
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 注册到 SiYuan 的 paste 事件。
 * 当用户粘贴纯文本是 siyuan-btn:// 链接时，自动转为带友好名称的行内按钮。
 */
export function handleBtnPaste(event: CustomEvent) {
    const { textPlain, resolve } = event.detail;

    if (!textPlain?.startsWith(PROTOCOL)) {
        // 与本功能无关，不调用 resolve，让思源循原生流程继续
        return;
    }

    event.preventDefault();
    const payload = decodeBtnHref(textPlain.trim());

    if (!payload) {
        console.warn("[BtnPaste] decode failed, fallback");
        resolve(undefined);
        return;
    }

    // 查找命令，决定显示名称（优先从 Command-DB / COMMAND_BINDINGS 匹配精准别名）
    let displayName = payload.command;
    if (payload.command !== "sys.configure") {
        const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === payload.command);
        if (binding?.methodName) {
            displayName = binding.methodName;
        } else {
            const def = commandRegistry.findByNameOrId(payload.command);
            if (def) displayName = def.name;
        }
    }

    console.log("[BtnPaste] final displayName=", displayName);
    const href = encodeBtnHref({ command: payload.command, param: payload.param });
    const siyuanHTML = `<span data-type="a" data-href="${href}">${displayName}</span>`;
    console.log("[BtnPaste] resolving with siyuanHTML=", siyuanHTML);
    resolve({ siyuanHTML });
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration dialog
// ─────────────────────────────────────────────────────────────────────────────

async function openButtonConfigurationDialog(targetRange: Range) {
    const dialog = new Dialog({
        title: "配置命令按钮",
        content: `<div id="inline-btn-config-container" style="height: 100%;"></div>`,
        width: "740px",
        height: "640px"
    });
    dialog.element.classList.add("indexos-dialog");

    const InlineButtonConfigDialog = (await import("./InlineButtonConfigDialog.svelte")).default;
    new InlineButtonConfigDialog({
        target: dialog.element.querySelector("#inline-btn-config-container")!,
        props: {
            dialog,
            targetRange
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover tooltip：悬浮时显示命令名
// ─────────────────────────────────────────────────────────────────────────────

function handleInlineButtonHover(event: MouseEvent) {
    const path = event.composedPath();
    const linkEl = path.find((el: any) =>
        el instanceof HTMLElement &&
        el.tagName === "SPAN" &&
        el.getAttribute("data-type")?.includes("a") &&
        el.getAttribute("data-href")?.startsWith(PROTOCOL)
    ) as HTMLElement | undefined;

    if (!linkEl) return;

    // 已计算过则跳过（缓存在属性上）
    if (linkEl.hasAttribute("data-btn-label")) return;

    const href = linkEl.getAttribute("data-href")!;
    const payload = decodeBtnHref(href);
    if (!payload) return;

    let label = payload.command; // 兜底显示 command 字段
    if (payload.command === "sys.configure") {
        label = "配置命令按钮";
    } else {
        const def = commandRegistry.findByNameOrId(payload.command);
        if (def) label = def.name;
    }

    // data-btn-label → CSS ::before tooltip
    linkEl.setAttribute("data-btn-label", label);
    // aria-label → 覆盖思源原生 popover.ts 的 href tooltip（它优先读 aria-label）
    linkEl.setAttribute("aria-label", label);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

let listenerAttached = false;

export function initInlineButtonListener() {
    injectButtonCSS();
    if (!listenerAttached) {
        window.addEventListener("click", handleInlineButtonClick, true);
        window.addEventListener("mouseover", handleInlineButtonHover, true);
        listenerAttached = true;
    }
}

export function destroyInlineButtonListener() {
    if (listenerAttached) {
        window.removeEventListener("click", handleInlineButtonClick, true);
        window.removeEventListener("mouseover", handleInlineButtonHover, true);
        listenerAttached = false;
    }
}
