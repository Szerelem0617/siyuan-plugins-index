/**
 * command-dispatcher.ts
 *
 * 命令调度器 —— 执行链路的核心。
 *
 * 职责：
 *   1. 从 commandRegistry 查询命令定义（不再靠前缀猜测）。
 *   2. 执行前做约束检查（requiresFocus / uiOnly）。
 *   3. 根据 dispatch.method 走对应的执行路径。
 *   4. 在执行前解析参数（注入参 / 模板参 / 静态参）。
 *
 * 不负责：读写 AV 数据库、DOM 事件监听、UI 渲染。
 */

import { globalCommand, showMessage } from "siyuan";
import { plugin } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { commandRegistry } from "./registry/command-registry";
import type { CommandDef, ParamSchema } from "./registry/command-registry";
import { getBlockId, getParentIdAndRootId, getBlockAttrs, resolveLayer4Params } from "./utils/context-extractor";
import { renderTemplate, formatDate, formatTime } from "./utils/template-engine";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface CommandContext {
    blockEl: HTMLElement;
    protyleEl: HTMLElement | null;
    supertag?: string;
    triggerEl?: HTMLElement;
    vars?: Record<string, any>;
}

export interface DispatchResult {
    success: boolean;
    method: "keyboard" | "global" | "api" | "custom" | "unknown";
    detail: string;
    value?: any;
    continue?: boolean;
    status?: "success" | "break" | "skip" | "retry" | "rollback" | "error";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 通用命令调度入口。
 *
 * @param commandId  注册表中的命令 ID，如 "editor.general.duplicate"
 * @param rawParam   AV "Command Param" 列中的原始 JSON 字符串（可为空）
 * @param context    触发命令时的 DOM 上下文
 */
export async function dispatchCommand(
    commandId: string,
    rawParam: string | Record<string, unknown> | null | undefined,
    context: CommandContext
): Promise<DispatchResult> {

    if (!context.vars) {
        context.vars = {};
    }

    // 1. 查询注册表
    const def = commandRegistry.getCommand(commandId);

    if (!def) {
        // 注册表里找不到：尝试按前缀降级（兼容未注册的命令）
        console.warn(`[Dispatcher] Command "${commandId}" not found in registry, falling back to prefix routing.`);
        return dispatchByPrefix(commandId, rawParam, context);
    }

    // 2. 约束检查
    if (def.constraints.environment === "ui") {
        // 前端 (ui) 专属命令必须在 UI 上下文（用户点击触发）中执行，
        // 定时任务等后台环境调用时给出警告。
        if (!context.blockEl) {
            console.warn(`[Dispatcher] Command "${commandId}" is ui-only (environment: ui) but no blockEl provided.`);
        }
    }

    // 2b. appliesTo 建议性检查（仅 warn，不阻断执行）
    const appliesTo = def.meta.appliesTo;
    if (appliesTo && appliesTo.length > 0 && !appliesTo.includes("any") && context.blockEl) {
        const blockType = getBlockType(context.blockEl);
        if (blockType && !appliesTo.includes(blockType as any)) {
            console.warn(`[Dispatcher] Command "${commandId}" declares appliesTo=${JSON.stringify(appliesTo)} but target block type is "${blockType}". Proceeding anyway (advisory only).`);
        }
    }

    // 3. 构建参数
    const resolvedParams = await buildParams(def, rawParam, context);

    console.log(`[Dispatcher] Executing command "${commandId}" via method "${def.dispatch.method}". Params:`, resolvedParams);

    // 4. 按 dispatch.method 执行
    try {
        let result: DispatchResult;
        switch (def.dispatch.method) {

            case "keyboard":
                result = dispatchKeyboard(def, context);
                break;

            case "global":
                result = dispatchGlobal(def);
                break;

            case "api":
                result = await dispatchApi(def, resolvedParams, context);
                break;

            case "custom":
                result = await dispatchCustom(def, resolvedParams, context);
                break;

            default:
                result = { success: false, method: "unknown", detail: `Unknown method: ${(def.dispatch as any).method}` };
        }

        if (!result.success) {
            console.error(`[Dispatcher] Command "${commandId}" execution failed:`, result.detail);
            showMessage(`❌ 命令执行失败: ${result.detail}`, 5000, "error");
        } else {
            console.log(`[Dispatcher] Command "${commandId}" executed successfully:`, result);
        }
        return result;
    } catch (err) {
        console.error(`[Dispatcher] Error executing "${commandId}":`, err);
        showMessage(`❌ 命令运行出错: ${err}`, 5000, "error");
        return { success: false, method: def.dispatch.method as any, detail: String(err) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus helpers（供 registration.ts 在 setTimeout 里调用）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 菜单关闭后，把焦点设置到目标块。
 * 必须在菜单完全关闭之后（setTimeout 回调内）才调用。
 */
export function focusBlockForDispatch(blockEl: HTMLElement, protyleEl: HTMLElement | null): void {
    document.querySelectorAll(".protyle-wysiwyg--select")
        .forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    blockEl.classList.add("protyle-wysiwyg--select");

    const wysiwygEl = (protyleEl?.querySelector(".protyle-wysiwyg")
        || blockEl.closest(".protyle-wysiwyg")) as HTMLElement | null;
    if (wysiwygEl) {
        wysiwygEl.focus({ preventScroll: true });
    }

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
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } catch (e) {
        console.warn("[Dispatcher] focusBlockForDispatch: failed to set range", e);
    }
}

/** 命令执行完毕后恢复干净状态 */
export function cleanupAfterDispatch(): void {
    document.querySelectorAll(".protyle-wysiwyg--select")
        .forEach(el => el.classList.remove("protyle-wysiwyg--select"));
    window.getSelection()?.removeAllRanges();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch paths
// ─────────────────────────────────────────────────────────────────────────────

function dispatchKeyboard(def: CommandDef, context: CommandContext): DispatchResult {
    const keymapPath = def.dispatch.keymapPath;
    if (!keymapPath || keymapPath.length === 0) {
        return { success: false, method: "keyboard", detail: "No keymapPath defined." };
    }

    // 按路径在 window.siyuan.config.keymap 里查快捷键
    let node: any = (window as any).siyuan?.config?.keymap;
    for (const part of keymapPath) {
        node = node?.[part];
        if (!node) break;
    }
    const hotkey: string | null = node?.custom || node?.default || null;

    if (!hotkey) {
        return {
            success: false, method: "keyboard",
            detail: `No hotkey found in keymap for path [${keymapPath.join(".")}]`
        };
    }

    const synthTarget = (
        context.protyleEl?.querySelector(".protyle-wysiwyg")
        || context.blockEl.closest(".protyle-wysiwyg")
    ) as HTMLElement | null;

    if (!synthTarget) {
        return { success: false, method: "keyboard", detail: "No .protyle-wysiwyg target found." };
    }

    const keyEvent = hotkeyToKeyboardEvent(hotkey);
    if (!keyEvent) {
        return { success: false, method: "keyboard", detail: `Failed to synthesize event for hotkey: ${hotkey}` };
    }

    synthTarget.dispatchEvent(keyEvent);
    return { success: true, method: "keyboard", detail: hotkey };
}

function dispatchGlobal(def: CommandDef): DispatchResult {
    const target = def.dispatch.target;
    if (!target) {
        return { success: false, method: "global", detail: "No target defined for global command." };
    }
    globalCommand(target, plugin.app);
    return { success: true, method: "global", detail: target };
}

async function dispatchApi(
    def: CommandDef,
    params: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    const endpoint = def.dispatch.endpoint;
    if (!endpoint) {
        return { success: false, method: "api", detail: "No endpoint defined for api command." };
    }

    // 自动注入 id（如果 params 里没有且有 context.blockEl）
    const body: Record<string, unknown> = { ...params };
    if (!body.id && context.blockEl) {
        body.id = context.blockEl.getAttribute("data-node-id") ?? undefined;
    }

    const apiRes = await post(endpoint, body);

    // 自动从思源 API 响应结果中提取生成/修改的 Block ID
    let extractedId: string | undefined = undefined;
    if (apiRes && Array.isArray(apiRes)) {
        extractedId = apiRes[0]?.doOperations?.[0]?.id;
    } else if (apiRes && typeof apiRes === "object") {
        extractedId = (apiRes as any).data?.[0]?.doOperations?.[0]?.id || (apiRes as any).id;
    }

    const resObj: DispatchResult = {
        success: true,
        method: "api",
        detail: `${endpoint} OK`,
        value: apiRes,
        data: apiRes,
        id: extractedId
    };

    if (extractedId) {
        if (!context.vars) context.vars = {};
        context.vars.id = extractedId;
        context.vars.last_id = extractedId;
        context.vars.createdblock = extractedId;
    }

    return resObj;
}
async function dispatchCustom(
    def: CommandDef,
    params: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    const executor = def.dispatch.executor;
    console.log(`[Dispatcher] dispatchCustom called for: ${def.id}. Executor is:`, typeof executor);
    if (typeof executor !== "function") {
        return { success: false, method: "custom", detail: `No executor registered for: ${def.id}` };
    }
    console.log(`[Dispatcher] Invoking executor for custom command: ${def.id}`);
    const result = await executor(params, context);
    console.log(`[Dispatcher] Custom command executor finished for: ${def.id}. Return value:`, result);
    
    if (result && typeof result === "object" && ("success" in result || "continue" in result || "status" in result)) {
        return {
            success: result.success !== false,
            method: "custom",
            detail: def.id,
            value: result.value,
            continue: result.continue,
            status: result.status,
        };
    }
    
    return {
        success: true,
        method: "custom",
        detail: def.id,
        value: result,
        continue: result !== false,
        status: result === false ? "break" : "success"
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Param resolution（静态参 / 注入参 / 模板参）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 按照命令 def 中的 params schema，依次处理每个参数：
 *   - injected → 从 context 中提取
 *   - template → 替换 {{占位符}}
 *   - static   → 从 rawParam JSON 中取值
 */
async function buildParams(
    def: CommandDef,
    rawParam: string | Record<string, unknown> | null | undefined,
    context: CommandContext
): Promise<Record<string, unknown>> {

    // 先解析用户在 AV 里填写的静态/模板参数
    const userParams = parseParam(rawParam);

    const result: Record<string, unknown> = {};

    for (const schema of def.params) {
        switch (schema.paramMode) {

            case "template": {
                const raw = String(userParams[schema.key] ?? schema.default ?? "");
                result[schema.key] = await resolveTemplate(raw, context);
                break;
            }

            case "static":
                result[schema.key] = userParams[schema.key] ?? schema.default;
                break;

            case "interactive":
                // 交互参在执行链里专门处理（Step 3+ 再实现），先跳过
                result[schema.key] = userParams[schema.key] ?? schema.default;
                break;
        }
    }

    // 把用户填写的但 schema 中没有定义的额外字段也合并进来（灵活扩展）
    for (const [k, v] of Object.entries(userParams)) {
        if (!(k in result)) result[k] = v;
    }

    // 剔除所有空字符串属性，防止传给思源 API 时因为空值字段校验失败
    for (const key of Object.keys(result)) {
        if (result[key] === "") {
            delete result[key];
        }
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template variable resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 替换字符串中的 {{占位符}}。
 *
 * 支持的变量：
 *   {{date}}         当前日期 YYYY-MM-DD
 *   {{time}}         当前时间 HH:mm:ss
 *   {{block_id}}     触发块的 ID
 *   {{parent_id}}    触发块的父块 ID（发起 API 查询）
 *   {{root_id}}      所在文档根块 ID
 *   {{attr:KEY}}     触发块的自定义属性值
 */
async function resolveTemplate(text: string, context: CommandContext): Promise<string> {
    console.log(`[Dispatcher-Debug] resolveTemplate input: "${text}"`);
    if (!text.includes("{{") && !text.includes("${")) return text;

    // 自动兼容并归一化 ${xxx} 占位符为标准 {{xxx}} 格式
    let normalizedText = text.replace(/\$\{([a-zA-Z0-9_.:-]+)\}/g, "{{$1}}");

    const blockId = getBlockId(context);
    let isClassMethodMode = false;
    const variables: Record<string, string> = {
        "date": formatDate(new Date()),
        "time": formatTime(new Date()),
        "block_id": blockId,
    };

    if (context.vars) {
        for (const [k, v] of Object.entries(context.vars)) {
            const strVal = v === undefined || v === null ? "" : String(v);
            variables[`vars.${k}`] = strVal;
            if (!(k in variables)) {
                variables[k] = strVal;
            }
        }
    }

    if (context.supertag && blockId) {
        console.log(`[Dispatcher-Debug] Resolving template with supertag: "${context.supertag}"`);
        const layer4Params = await resolveLayer4Params(blockId, context.supertag);
        if (Object.keys(layer4Params).length > 0) {
            isClassMethodMode = true;
            Object.assign(variables, layer4Params);
        }
    }

    if (isClassMethodMode) {
        console.log(`[Dispatcher] Executing in Class Method mode for supertag: ${context.supertag}`);
    } else {
        console.log(`[Dispatcher] Executing in Tool Component mode (no active Class/Database mapping). Database attributes mapping is disabled.`);
    }

    if (normalizedText.includes("{{root_id}}") || normalizedText.includes("{{parent_id}}")) {
        const { rootId, parentId } = await getParentIdAndRootId(blockId);
        variables["root_id"] = rootId;
        variables["parent_id"] = parentId;
    }

    if (normalizedText.includes("{{attr:") && blockId) {
        if (isClassMethodMode) {
            const attrs = await getBlockAttrs(blockId);
            for (const [k, v] of Object.entries(attrs)) {
                variables[`attr:${k}`] = v;
            }
        }
    }

    const result = renderTemplate(normalizedText, variables, isClassMethodMode);
    console.log(`[Dispatcher-Debug] resolveTemplate final output: "${result}"`);
    return result;
}




/** 解析 AV Command Param 列里的 JSON 字符串 */
export function parseParam(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed === "") return {};
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch (e) {
            console.warn("[Dispatcher] Failed to parse Command Param JSON:", raw, e);
        }
    }
    return {};
}

/**
 * 降级路由：当 commandId 不在注册表中时，按前缀猜测执行方式。
 * 保证向后兼容——即使没注册的指令也能智能路由。
 */
function dispatchByPrefix(
    commandId: string,
    rawParam: string | null | undefined,
    context: CommandContext
): DispatchResult {
    const prefix = commandId.split(".")[0];

    if (prefix === "editor") {
        // keyboard 路径：在 keymap 里按路径查找
        const parts = commandId.split(".");
        let node: any = (window as any).siyuan?.config?.keymap;
        for (const part of parts) {
            let pathPart = part;
            if (pathPart === "block" || pathPart === "text") {
                pathPart = "general"; // 映射我们的逻辑分类到思源底层的 general 类别中
            }
            node = node?.[pathPart];
            if (!node) break;
        }
        const hotkey: string | null = node?.custom || node?.default || null;

        if (hotkey) {
            const synthTarget = (
                context.protyleEl?.querySelector(".protyle-wysiwyg")
                || context.blockEl.closest(".protyle-wysiwyg")
            ) as HTMLElement | null;
            if (synthTarget) {
                const ev = hotkeyToKeyboardEvent(hotkey);
                if (ev) {
                    synthTarget.dispatchEvent(ev);
                    return { success: true, method: "keyboard", detail: `fallback:${hotkey}` };
                }
            }
        }
        return { success: false, method: "keyboard", detail: `No hotkey for ${commandId}` };
    }

    if (prefix === "general" || prefix === "siyuan") {
        const bareCmd = commandId.split(".").pop()!;
        let target = bareCmd;
        if (bareCmd === "graph") target = "graphView";
        if (bareCmd === "splitRight") target = "splitLR";
        globalCommand(target, plugin.app);
        return { success: true, method: "global", detail: `fallback:${target}` };
    }

    if (prefix === "api") {
        // 无法异步降级（该函数是同步的），只打警告
        console.warn(`[Dispatcher] api command "${commandId}" not in registry; skipped in fallback.`);
    }

    return { success: false, method: "unknown", detail: `Unrecognized command: ${commandId}` };
}

/**
 * SiYuan 快捷键字符串（Mac 符号格式）→ KeyboardEvent
 *
 * 平台规则（对应 SiYuan 源码 isOnlyMeta）：
 *   Mac     → ⌘ = metaKey=true,  ctrlKey=false
 *   Windows → ⌘ = metaKey=false, ctrlKey=true
 */
function hotkeyToKeyboardEvent(hotkey: string): KeyboardEvent | null {
    try {
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") > -1;
        let ctrl = false, shift = false, alt = false, meta = false;
        let k = hotkey;

        if (k.includes("⌃")) { ctrl = true; k = k.replace("⌃", ""); }
        if (k.includes("⌘")) { if (isMac) { meta = true; } else { ctrl = true; } k = k.replace("⌘", ""); }
        if (k.includes("⇧")) { shift = true; k = k.replace("⇧", ""); }
        if (k.includes("⌥")) { alt = true; k = k.replace("⌥", ""); }

        const map: Record<string, string> = {
            "↩": "Enter", "⌫": "Backspace", "⌦": "Delete", "⇥": "Tab",
            "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight",
        };
        const key = map[k] || k || "Unidentified";
        let keyCode = 0;
        if (key.length === 1) keyCode = key.toUpperCase().charCodeAt(0);
        else if (key === "Enter") keyCode = 13;
        else if (key === "Backspace") keyCode = 8;
        else if (key === "Delete") keyCode = 46;
        else if (key === "Tab") keyCode = 9;

        return new KeyboardEvent("keydown", {
            key, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta,
            bubbles: true, cancelable: true, composed: true, keyCode,
        });
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Block type resolver（从 DOM 推断思源块类型）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从块的 DOM 元素推断思源块类型，映射到 BlockTarget。
 * 读取 data-type 属性（如 "NodeParagraph"）并转换。
 */
function getBlockType(blockEl: HTMLElement): string | null {
    const dataType = blockEl.getAttribute("data-type");
    if (!dataType) return null;

    const map: Record<string, string> = {
        "NodeDocument": "document",
        "NodeParagraph": "paragraph",
        "NodeHeading": "heading",
        "NodeList": "list",
        "NodeListItem": "list",
        "NodeBlockquote": "blockquote",
        "NodeCodeBlock": "code",
        "NodeTable": "table",
        "NodeSuperBlock": "super",
        "NodeBlockQueryEmbed": "embed",
        "NodeWidget": "widget",
        "NodeHTMLBlock": "widget",
        "NodeMathBlock": "code",
        "NodeThematicBreak": "paragraph",
        "NodeAudio": "embed",
        "NodeVideo": "embed",
        "NodeIFrame": "embed",
    };

    return map[dataType] || null;
}

/**
 * 更新 Context 中的统一变量池 vars，并自动支持落地持久化。
 */
export async function updateContextVar(
    context: CommandContext,
    key: string,
    value: any,
    options?: { persist?: boolean }
): Promise<void> {
    if (!context.vars) {
        context.vars = {};
    }
    context.vars[key] = value;

    const blockId = getBlockId(context);
    if (!blockId) return;

    // 确定属性持久化的 key 格式 (自动加 custom- 前缀以匹配思源块属性规范)
    const attrKey = key.startsWith("custom-") ? key : `custom-${key}`;

    if (options?.persist !== false) {
        try {
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    [attrKey]: String(value)
                }
            });
            if (context.blockEl) {
                context.blockEl.setAttribute(attrKey, String(value));
            }
            console.log(`[Auto-Persistence] Updated var "${key}" = "${value}" and persisted as attribute "${attrKey}" on block ${blockId}`);
        } catch (e) {
            console.error(`[Auto-Persistence] Failed to persist var "${key}" on block ${blockId}:`, e);
        }
    }
}

/** 导出供外部使用（如 tag-suggestion 过滤） */
export { getBlockType };
