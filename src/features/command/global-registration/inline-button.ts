import { dispatchCommand } from "../command-dispatcher";
import { commandRegistry } from "../registry/command-registry";
import { showMessage, Dialog } from "siyuan";
import { isDevInitSysEnabled, DEV_ENABLE_INIT_SYS, SUPERTAG_REGISTRY, COMMAND_REGISTRY } from "../registration";
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
    if (!href.includes("siyuan-plugins-index") && !href.startsWith(PROTOCOL) && !href.startsWith("siyuan-btn://")) return null;
    let rest = href;
    if (href.startsWith(PROTOCOL)) rest = href.slice(PROTOCOL.length);
    else if (href.includes("siyuan-plugins-index/")) rest = href.slice(href.indexOf("siyuan-plugins-index/") + "siyuan-plugins-index/".length);
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

        /* ─── 1. ☀️ 浅色模式：经典晶透冰蓝反光 (背景加深，高对比醒目) ─── */
        span[data-type~="a"][data-href*="siyuan-plugins-index"],
        span[data-type~="a"][data-href^="siyuan-btn://"] {
            position: relative !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 3px 10px !important;
            margin: 0 4px !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            line-height: 1.3 !important;
            border-radius: 6px !important;
            border: 1px solid var(--indexos-ice-shadow, #8BBBE5) !important;
            background: linear-gradient(135deg, #D5E8F8 0%, #B8DCF5 60%, #CCE5F8 100%) !important;
            color: var(--indexos-text-main, #0B192C) !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.9) !important;
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
        span[data-type~="a"][data-href*="siyuan-plugins-index"]::before,
        span[data-type~="a"][data-href^="siyuan-btn://"]::before {
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
                rgba(255, 255, 255, 0.5) 45%,
                rgba(255, 255, 255, 0.98) 50%,
                rgba(255, 255, 255, 0.5) 55%,
                rgba(255, 255, 255, 0) 70%,
                transparent 100%
            ) !important;
            animation: indexos-laser-sweep 3.2s ease-in-out infinite !important;
            pointer-events: none !important;
            z-index: -1 !important;
            will-change: transform !important;
        }

        /* 悬停 (Hover) 参考特效 4：触发单次快速划过 + 背景深化 + 全息阴影 */
        span[data-type~="a"][data-href*="siyuan-plugins-index"]:hover,
        span[data-type~="a"][data-href^="siyuan-btn://"]:hover {
            border-color: #0284C7 !important;
            color: #0284C7 !important;
            background: linear-gradient(135deg, #C5E2F6 0%, #A6D4F3 60%, #BDE0F7 100%) !important;
            box-shadow: 0 0 16px rgba(56, 189, 248, 0.45), inset 0 1px 2px rgba(255, 255, 255, 1) !important;
            transform: translateY(-1px) !important;
        }

        span[data-type~="a"][data-href*="siyuan-plugins-index"]:hover::before,
        span[data-type~="a"][data-href^="siyuan-btn://"]:hover::before {
            animation: indexos-hover-sweep 0.75s ease-out 1 !important;
        }

        /* ─── 2. 🌙 深色模式：柔和不刺眼的全息暗晶流光 ─── */
        html[data-theme-mode="dark"] span[data-type~="a"][data-href*="siyuan-plugins-index"],
        html[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"],
        body[data-theme-mode="dark"] span[data-type~="a"][data-href*="siyuan-plugins-index"],
        body[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"],
        .theme-dark span[data-type~="a"][data-href*="siyuan-plugins-index"],
        .theme-dark span[data-type~="a"][data-href^="siyuan-btn://"] {
            background: #091224 !important;
            border-color: rgba(56, 189, 248, 0.4) !important;
            color: #38BDF8 !important;
            box-shadow: 0 0 10px rgba(56, 189, 248, 0.18), inset 0 1px 1px rgba(255, 255, 255, 0.12) !important;
        }

        /* 深色模式扫光：降低亮度，半透明柔和电光蓝/浅冰蓝，绝不刺眼 */
        html[data-theme-mode="dark"] span[data-type~="a"][data-href*="siyuan-plugins-index"]::before,
        html[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"]::before,
        body[data-theme-mode="dark"] span[data-type~="a"][data-href*="siyuan-plugins-index"]::before,
        body[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"]::before,
        .theme-dark span[data-type~="a"][data-href*="siyuan-plugins-index"]::before,
        .theme-dark span[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"]::before {
            background: linear-gradient(
                45deg,
                transparent 0%,
                rgba(56, 189, 248, 0) 30%,
                rgba(56, 189, 248, 0.25) 45%,
                rgba(186, 230, 253, 0.5) 50%,
                rgba(56, 189, 248, 0.25) 55%,
                rgba(56, 189, 248, 0) 70%,
                transparent 100%
            ) !important;
        }

        html[data-theme-mode="dark"] span[data-type~="a"][data-href*="siyuan-plugins-index"]:hover,
        html[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"]:hover,
        body[data-theme-mode="dark"] span[data-type~="a"][data-href*="siyuan-plugins-index"]:hover,
        body[data-theme-mode="dark"] span[data-type~="a"][data-href^="siyuan-btn://"]:hover,
        .theme-dark span[data-type~="a"][data-href*="siyuan-plugins-index"]:hover,
        .theme-dark span[data-type~="a"][data-href^="siyuan-btn://"]:hover {
            background: #0f1f3d !important;
            color: #F0F9FF !important;
            border-color: #BAE6FD !important;
            box-shadow: 0 0 20px rgba(56, 189, 248, 0.45) !important;
        }

        /* Detached commands styling (contains parameters) */
        span[data-type~="a"][data-href*="siyuan-plugins-index"][data-href*="?p="],
        span[data-type~="a"][data-href^="siyuan-btn://"][data-href*="?p="] {
            border-color: var(--indexos-ice-shadow, #A1C4E6) !important;
            color: var(--indexos-text-main, #374151) !important;
        }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// Available inline commands registry (fed by top-bar.ts scan)
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

// ─────────────────────────────────────────────────────────────────────────────
// Slash command entry （/btn）
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
            const inlineDOM = `<span data-type="a" data-href="${href}">⚙️ 配置智能按钮</span>&#8203;`;

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
    let paramMapping: string | null = null;
    const parentBlock = linkEl.closest("[data-node-id]") as HTMLElement | null;

    // Detached Command Priority: Respect baked parameter inside payload first
    if (payload.param !== undefined && payload.param !== null) {
        paramMapping = payload.param;
        console.log(`[InlineButton-Debug] Detached command - respecting baked link param:`, paramMapping);
    } else {
        if (parentBlock) {
            // Priority 1: Check if the parent block has any supertags, and use the parameter mapping of the matching supertag
            const ialString = parentBlock.getAttribute("custom-index-tags") || parentBlock.getAttribute("tag") || parentBlock.getAttribute("tags") || "";
            const blockTags = ialString.split(/[,\s]+/).map((t: string) => t.trim().replace(/#/g, "")).filter(Boolean);
            
            for (const tag of blockTags) {
                const match = SUPERTAG_REGISTRY.find(item =>
                    item.commandRef === def.id && item.typeTag === tag
                );
                if (match) {
                    paramMapping = match.paramMapping ? JSON.stringify(match.paramMapping) : "";
                    console.log(`[InlineButton-Debug] Found matching supertag mapping for tag "${tag}":`, paramMapping);
                    break;
                }
            }
        }

        // Priority 2: Use mapping defined for the command globally in Command-DB
        if (paramMapping === null) {
            // Look up by command ID in COMMAND_REGISTRY
            const cmdConfig = Object.values(COMMAND_REGISTRY).find(c => c.commandRef === def.id);
            if (cmdConfig) {
                paramMapping = cmdConfig.paramMapping;
                console.log(`[InlineButton-Debug] Found global command mapping:`, paramMapping);
            }
        }
    }

    const mockContext = {
        blockEl: parentBlock || document.body,
        protyleEl: null,
        triggerEl: linkEl
    };
    dispatchCommand(def.id, paramMapping, mockContext as any);
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

    // 查找命令，决定显示名称
    let displayName = payload.command;
    if (payload.command !== "sys.configure") {
        const def = commandRegistry.findByNameOrId(payload.command);
        if (def) displayName = def.name;
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

function openButtonConfigurationDialog(targetRange: Range) {
    const dropdownOptions = availableInlineCommands.map(cmd => ({
        value: cmd.id,
        label: `${cmd.label} (${cmd.commandId})`
    }));

    if (dropdownOptions.length === 0) {
        dropdownOptions.push({
            value: "",
            label: "没有关联行内按钮入口的命令，请在 Command-DB 的 'UI 入口' 列勾选"
        });
    }

    let selectedValue = dropdownOptions[0].value;

    const dialog = new Dialog({
        title: "配置智能按钮",
        content: `
            <div class="b3-dialog__content">
                <div class="fn__flex b3-label">
                    <div class="fn__flex-1">
                        选择要绑定的功能：
                        <div class="b3-label__text">列表来源于 Command-DB 勾选的 Inline Button</div>
                    </div>
                    <button class="b3-select fn__flex" id="btn-action-select" style="width: 200px; align-items: center; justify-content: space-between; height: 28px; padding: 4px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer; transition: all 0.15s ease;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${dropdownOptions[0].label}
                        </span>
                        <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.5; flex-shrink: 0; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
                    </button>
                </div>
                <div class="fn__flex b3-label">
                    <div class="fn__flex-1">定制按钮显示名称（选填）:</div>
                    <input class="b3-text-field" id="btn-custom-label" style="width: 200px;" placeholder="默认使用命令名">
                </div>
                <div class="fn__flex b3-label">
                    <div class="fn__flex-1">附加运行参数（选填）:</div>
                    <input class="b3-text-field" id="btn-custom-param" style="width: 200px;" placeholder="选填参数">
                </div>
            </div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel">取消</button>
                <button class="b3-button b3-button--text" id="btn-config-confirm">确认绑定</button>
            </div>
        `,
        width: "520px"
    });
    dialog.element.classList.add("indexos-dialog");

    const selectBtn = dialog.element.querySelector("#btn-action-select") as HTMLElement;
    if (selectBtn) {
        selectBtn.addEventListener("click", (e) => {
            openIndexDropdown({
                event: e,
                options: dropdownOptions,
                selectedValue: selectedValue,
                onSelect: (val) => {
                    selectedValue = val;
                    const textSpan = selectBtn.querySelector("span");
                    if (textSpan) {
                        const matched = dropdownOptions.find(o => o.value === val);
                        textSpan.textContent = matched ? matched.label : val;
                    }
                }
            });
        });
    }

    dialog.element.querySelector("#btn-config-confirm")?.addEventListener("click", () => {
        const customLabelEl = dialog.element.querySelector("#btn-custom-label") as HTMLInputElement;
        const customParamEl = dialog.element.querySelector("#btn-custom-param") as HTMLInputElement;

        const selectedId = selectedValue;
        const targetCmd = availableInlineCommands.find(c => c.id === selectedId);

        if (!targetCmd) {
            showMessage("请先选择一个功能关联", -1, "error");
            return;
        }

        const finalLabel = customLabelEl.value.trim() || targetCmd.label;
        const finalParam = customParamEl.value.trim() || targetCmd.commandParam || undefined;

        // 使用命令 name（中文名）作为 URL 中的标识符，同时 ID 也可以
        // 为了最大稳定性，这里存的是命令 ID（可读性由显示文本保证）
        const href = encodeBtnHref({ command: targetCmd.commandId, param: finalParam });
        const inlineDOM = `<span data-type="a" data-href="${href}">${finalLabel}</span>&#8203;`;

        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(targetRange);
            document.execCommand("insertHTML", false, inlineDOM);
        }

        dialog.destroy();
    });

    dialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => {
        dialog.destroy();
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
        label = "配置智能按钮";
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
