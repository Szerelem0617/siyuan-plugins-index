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
import type { CommandDef } from "./registry/command-registry";
import { getBlockId, getParentIdAndRootId, getBlockAttrs, resolveLayer4Params } from "./utils/context-extractor";
export { getBlockId };
import { renderTemplate, formatDate, formatTime } from "./utils/template-engine";
import { persistOutputVariablesToLayer4 } from "./supertag";

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
    /** API 调用返回的原始响应 */
    data?: unknown;
    /** 新建/修改的块 ID（由 API 响应提取） */
    id?: string;
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
    context: CommandContext,
    sources?: ParamSources
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
    // 统一参数解析：#1 manual > #2 auto > #3 commandDb > 变量解析内嵌 > #5 schema 默认值
    const resolvedParams = sources
        ? await resolveCommandParams(def, sources, context)
        : await resolveCommandParams(def, { commandDb: rawParam }, context);

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

            // 自动把出参保存写回/建列到 Layer 4 数据库
            const targetBlockId = getBlockId(context);
            if (targetBlockId && context.supertag && context.vars) {
                await persistOutputVariablesToLayer4(targetBlockId, context.supertag, context.vars);
            }
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

    // 只有在 params 中完全未定义/未传入 id 字段时，才自动注入上下文块 ID
    const body: Record<string, unknown> = { ...params };
    if (!("id" in body) && context.blockEl) {
        const autoId = context.blockEl.getAttribute("data-node-id") ?? undefined;
        if (autoId) {
            console.log(`[Dispatcher] api 命令 ${def.id} 未配置 id 字段，自动注入上下文块 ID ${autoId}`);
        }
        body.id = autoId;
    }

    // 插入类命令必须提供目标（parentID/previousID/nextID）。
    // 缺失时思源内核 doInsert 找不到 block tree 会广播 "reloadui"，导致整个界面重载。
    const insertEndpoints = new Set(["/api/block/insertBlock", "/api/block/prependBlock", "/api/block/appendBlock"]);
    if (insertEndpoints.has(endpoint) && !body.parentID && !body.previousID && !body.nextID) {
        const blockId = context.blockEl?.getAttribute("data-node-id") || "";
        if (blockId) {
            body.previousID = blockId;
            console.log(`[Dispatcher] ${def.id} 未提供插入目标，自动注入 previousID=${blockId}（触发块）`);
        } else {
            console.error(`[Dispatcher] ${def.id} 缺少插入目标（parentID/previousID/nextID），已阻止请求，避免触发思源 UI 重载`);
            return { success: false, method: "api", detail: "缺少插入目标：请提供 parentID / previousID / nextID，或使用 {{block_id}} 占位符" };
        }
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

        // 支持处理在入参/出参配置对话框中用户自定义的 _outputMapping 别名映射
        if (params && typeof params._outputMapping === "object" && params._outputMapping !== null) {
            context.vars._outputMapping = params._outputMapping;
            for (const [, alias] of Object.entries(params._outputMapping as Record<string, string>)) {
                if (alias) {
                    context.vars[alias] = extractedId;
                }
            }
        }
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
        const r = result as Record<string, any>;
        return {
            success: r.success !== false,
            method: "custom",
            detail: def.id,
            value: r.value,
            continue: r.continue,
            status: r.status,
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
// 统一参数解析（优先级：#1 Pipeline 人为规划 > #2 Pipeline 自动赋予 >
//                #3 Command-DB 配置 > 变量解析内嵌；#5 seed/registry 仅作默认模板）
// ─────────────────────────────────────────────────────────────────────────────

/** 参数来源。优先级：#1 manual > #2 auto > #3 commandDb */
export interface ParamSources {
    /** #1 Pipeline 人为规划参数（显式/脚本传参，最高优先级） */
    manual?: Record<string, unknown>;
    /** #2 Pipeline 自动赋予参数（当前通过 context.vars + {{var.x}} 实现，此字段预留给引擎自动映射） */
    auto?: Record<string, unknown>;
    /** #3 Command-DB 持久化配置（paramMapping 列，JSON 字符串或对象） */
    commandDb?: string | Record<string, unknown> | null;
}

/** 按优先级逐键合并各来源（后者覆盖前者） */
export function mergeParamSources(sources: ParamSources): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...parseParam(sources.commandDb) };
    if (sources.auto) Object.assign(merged, sources.auto);
    if (sources.manual) Object.assign(merged, sources.manual);
    return merged;
}

/**
 * 统一参数解析入口：
 *   1. mergeParamSources 按 #1 > #2 > #3 逐键合并；
 *   2. schema 缺省值兜底（#5 seed/registry 仅作模板，不参与优先级）；
 *   3. 所有字符串值统一做占位符解析（#4 变量解析内嵌；template 模式强制转字符串）；
 *   4. 剔除空字符串，防止传给思源 API 时空值字段校验失败。
 */
export async function resolveCommandParams(
    def: CommandDef,
    sources: ParamSources,
    context: CommandContext
): Promise<Record<string, unknown>> {
    const raw = mergeParamSources(sources);
    const result: Record<string, unknown> = {};

    for (const schema of def.params) {
        const value = raw[schema.key] ?? schema.default;
        if (schema.paramMode === "template") {
            result[schema.key] = await resolveTemplate(String(value ?? ""), context);
        } else if (typeof value === "string") {
            result[schema.key] = await resolveTemplate(value, context);
        } else {
            result[schema.key] = value;
        }
    }

    // 用户填写的但 schema 中没有定义的额外字段也合并进来（灵活扩展），字符串同样做占位符解析
    for (const [k, v] of Object.entries(raw)) {
        if (!(k in result)) {
            result[k] = typeof v === "string" ? await resolveTemplate(v, context) : v;
        }
    }

    console.log(`[ParamResolver] ${def.id}: manual=${Object.keys(sources.manual || {}).length} auto=${Object.keys(sources.auto || {}).length} commandDb=${sources.commandDb ? 1 : 0} -> resolved`, result);
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
export async function resolveTemplate(text: string, context: CommandContext): Promise<string> {
    if (!text || typeof text !== "string" || (!text.includes("{{") && !text.includes("${"))) return text;

    // 统一规范化 ${xxx} 为 {{xxx}}
    let normalizedText = text.replace(/\$\{([a-zA-Z0-9_.:-]+)\}/g, "{{$1}}");

    const blockId = getBlockId(context);
    const variables: Record<string, string> = {
        "date": formatDate(new Date()),
        "time": formatTime(new Date()),
        "block_id": blockId || "",
    };

    // 1. 注入内存参数池 (context.vars)
    if (context.vars) {
        for (const [k, v] of Object.entries(context.vars)) {
            if (v !== undefined && v !== null) {
                const strVal = String(v);
                const varKey = k.startsWith("var.") ? k : `var.${k}`;
                variables[varKey] = strVal;
            }
        }
    }

    // 2. 解析父块与根块 ID（按需加载）
    if (normalizedText.includes("{{root_id}}") || normalizedText.includes("{{parent_id}}")) {
        const { rootId, parentId } = await getParentIdAndRootId(blockId);
        variables["root_id"] = rootId;
        variables["parent_id"] = parentId;
    }

    // 3. 注入 Layer 4 关联参数/属性
    if (blockId) {
        const layer4Params = await resolveLayer4Params(blockId, context.supertag);
        for (const [k, v] of Object.entries(layer4Params)) {
            if (v !== undefined && v !== null && (!(k in variables) || !variables[k])) {
                variables[k] = String(v);
            }
        }

        // 4. 读取触发块的真实 Block Attrs（用于未在内存中找到的属性，支持 var.KEY 检索）
        const attrs = await getBlockAttrs(blockId);
        for (const [k, v] of Object.entries(attrs)) {
            // 自动去掉 custom- 前缀暴露给用户
            const cleanKey = k.replace(/^custom-/, "");
            if (v !== undefined && v !== null) {
                const strVal = String(v);
                if (!(cleanKey in variables)) variables[cleanKey] = strVal;
                if (!(k in variables)) variables[k] = strVal;
                // 同步支持 {{var.createdblock}} 检索块上的属性
                const varKey = `var.${cleanKey}`;
                if (!(varKey in variables)) variables[varKey] = strVal;
            }
        }
    }

    return renderTemplate(normalizedText, variables, false);
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
    _rawParam: string | Record<string, unknown> | null | undefined,
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
