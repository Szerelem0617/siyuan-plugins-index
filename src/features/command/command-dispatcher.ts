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
import { runQuery, tableNameToAvId, checkTableExists, instantiateAV } from "../sqlite/sqlite-manager";
import { getGlobalTypeConfigs } from "../data/av-setting/db-config";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface CommandContext {
    blockEl: HTMLElement;
    protyleEl: HTMLElement | null;
    supertag?: string;
    triggerEl?: HTMLElement;
}

export interface DispatchResult {
    success: boolean;
    method: "keyboard" | "global" | "api" | "custom" | "unknown";
    detail: string;
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
    rawParam: string | null | undefined,
    context: CommandContext
): Promise<DispatchResult> {

    // 1. 查询注册表
    const def = commandRegistry.getCommand(commandId);

    if (!def) {
        // 注册表里找不到：尝试按前缀降级（兼容未注册的命令）
        console.warn(`[Dispatcher] Command "${commandId}" not found in registry, falling back to prefix routing.`);
        return dispatchByPrefix(commandId, rawParam, context);
    }

    // 2. 约束检查
    if (def.constraints.uiOnly) {
        // uiOnly 的命令只能在 UI 上下文（用户点击触发）中执行，
        // 定时任务调用时应检查 schedulable 标志并给出明确警告。
        // 这里仅打印提示，不阻断——当前调用都来自 UI 点击。
        if (!context.blockEl) {
            console.warn(`[Dispatcher] Command "${commandId}" is uiOnly but no blockEl provided.`);
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

    const result = await post(endpoint, body);
    return { success: true, method: "api", detail: `${endpoint} OK` };
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
    await executor(params, context);
    console.log(`[Dispatcher] Custom command executor finished successfully for: ${def.id}`);
    return { success: true, method: "custom", detail: def.id };
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
    rawParam: string | null | undefined,
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
/**
 * 从 SQLite (Layer 4 数据库) 中按优先级解析获取块的列属性键值对。
 * 优先级：
 *   1. 与 supertag 同名的数据库表中的列值。
 *   2. 其他包含该 blockId 的数据库表中的列值。
 */
async function resolveLayer4Params(blockId: string, supertag?: string): Promise<Record<string, string>> {
    const params: Record<string, string> = {};
    if (!blockId) {
        console.warn(`[Layer4Params-Debug] Aborted: blockId is empty!`);
        return params;
    }

    const cleanTag = supertag ? supertag.replace(/^#/, "").trim().toLowerCase() : "";

    const querySQLite = async (): Promise<Array<{ tableName: string; avId: string; name: string; rowData: Record<string, string> }>> => {
        const tablesRes = await runQuery(`
            SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'av_%'
        `);
        if (!tablesRes || !tablesRes.values || tablesRes.values.length === 0) {
            return [];
        }

        const matches: Array<{ tableName: string; avId: string; name: string; rowData: Record<string, string> }> = [];

        for (const row of tablesRes.values) {
            const tableName = row[0];
            if (!tableName) continue;

            try {
                const existsRes = await runQuery(`SELECT count(*) FROM "${tableName}" WHERE rowID = ?`, [blockId]);
                const existsCount = existsRes?.values?.[0]?.[0] || 0;
                if (Number(existsCount) > 0) {
                    const avId = tableNameToAvId(tableName);
                    
                    let dbRealName = "";
                    try {
                        const avConfig = await post("/api/av/getAttributeView", { id: avId });
                        dbRealName = avConfig?.name || (avConfig?.av ? avConfig.av.name : "");
                    } catch { /* ignore */ }

                    const rowRes = await runQuery(`SELECT * FROM "${tableName}" WHERE rowID = ?`, [blockId]);
                    if (rowRes && rowRes.columns && rowRes.values && rowRes.values.length > 0) {
                        const cols = rowRes.columns;
                        const vals = rowRes.values[0];
                        const rowData: Record<string, string> = {};
                        cols.forEach((colName, idx) => {
                            rowData[colName] = vals[idx] !== null && vals[idx] !== undefined ? String(vals[idx]) : "";
                        });
                        matches.push({ tableName, avId, name: dbRealName, rowData });
                    }
                }
            } catch (err) {
                console.error(`[Layer4Params-Debug] Error querying table "${tableName}":`, err);
            }
        }
        return matches;
    };

    try {
        // 1. First, search SQLite directly (Read-only query, no HTTP API requests)
        let matchedDbs = await querySQLite();

        // 2. If not found in SQLite, trigger passive sync fallback
        if (matchedDbs.length === 0) {
            
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const avsAttr = attrsRes.data?.["custom-avs"] || "";
            const avIds = avsAttr.split(",").map((id: string) => id.trim()).filter(Boolean);
            
            let syncedAny = false;
            for (const avId of avIds) {
                try {
                    await instantiateAV(avId, true); // force sync
                    syncedAny = true;
                } catch (syncErr) {
                    console.error(`[Layer4Params-Debug] Passive sync failed for ${avId}:`, syncErr);
                }
            }

            if (avIds.length === 0 && cleanTag) {
                const configs = await getGlobalTypeConfigs();
                const matchedConfigs = configs.filter(c => {
                    const typeName = (c.typeName || "").trim().toLowerCase();
                    return typeName === cleanTag || typeName.includes(cleanTag) || cleanTag.includes(typeName);
                });
                for (const config of matchedConfigs) {
                    if (config.avId) {
                        try {
                            await instantiateAV(config.avId, true); // force sync
                            syncedAny = true;
                        } catch (syncErr) { /* ignore */ }
                    }
                }
            }

            // Retry SQLite query if we successfully synced any databases
            if (syncedAny) {
                matchedDbs = await querySQLite();
            }
        }

        if (matchedDbs.length === 0) {
            return params;
        }

        // 3. Priority match: exact database name matching supertag > others
        let targetDb = matchedDbs[0];
        if (cleanTag) {
            const sameNameDb = matchedDbs.find(db => {
                const dbName = db.name.trim().toLowerCase();
                return dbName === cleanTag || dbName.includes(cleanTag) || cleanTag.includes(dbName);
            });
            if (sameNameDb) {
                targetDb = sameNameDb;
            }
        }

        // 4. Resolve Schema columns and map to parameter keys
        const schemaRes = await runQuery(`
            SELECT col_name, key_name FROM _av_schema WHERE av_id = ?
        `, [targetDb.avId]);

        if (schemaRes && schemaRes.values) {
            for (const schemaRow of schemaRes.values) {
                const colName = schemaRow[0];
                const keyName = schemaRow[1];
                const cellValue = targetDb.rowData[colName] ?? "";

                if (colName) params[colName] = cellValue;
                if (keyName) params[keyName] = cellValue;
            }
        }
    } catch (e) {
        console.error("[Layer4Params-Debug] Error resolving Layer 4 params:", e);
    }

    return params;
}

/**
 * 替换字符串中的 {{占位符}}。
 * 优先级顺序：
 *   1. 与 supertag 同名的 Layer 4 本地表列值。
 *   2. 其他 Layer 4 本地表列值。
 *   3. 块自身的自定义属性 / 系统同步/API变量。
 */
async function resolveTemplate(text: string, context: CommandContext): Promise<string> {
    if (!text.includes("{{")) return text;

    const blockId = context.blockEl?.getAttribute("data-node-id") ?? "";
    let result = text;

    // Detect if we have Class Method Mode or Tool Component Mode
    let isClassMethodMode = false;
    let layer4Params: Record<string, string> = {};

    if (context.supertag) {
        layer4Params = await resolveLayer4Params(blockId, context.supertag);
        // If we found database columns matching, it's Class Method Mode
        if (Object.keys(layer4Params).length > 0) {
            isClassMethodMode = true;
        }
    }

    if (isClassMethodMode) {
        console.log(`[Dispatcher] Executing in Class Method mode for supertag: ${context.supertag}`);
        // 1. Resolve Layer 4 database columns (Priority 1 & 2)
        for (const [key, value] of Object.entries(layer4Params)) {
            result = result.replaceAll(`{{${key}}}`, value);
            result = result.replaceAll(`{{attr:${key}}}`, value);
        }
    } else {
        console.log(`[Dispatcher] Executing in Tool Component mode (no active Class/Database mapping). Database attributes mapping is disabled.`);
    }

    // 2. Resolve basic system / sync variables (both modes support this)
    const syncVars: Record<string, string> = {
        "date": formatDate(new Date()),
        "time": formatTime(new Date()),
        "block_id": blockId,
    };
    for (const [key, value] of Object.entries(syncVars)) {
        result = result.replaceAll(`{{${key}}}`, value);
    }

    // 3. root_id / parent_id (both modes support this)
    if (result.includes("{{root_id}}") || result.includes("{{parent_id}}")) {
        try {
            const res = await post("/api/block/getBlockBreadcrumb", { id: blockId });
            const crumbs: any[] = res.data ?? [];
            const rootId = crumbs[0]?.id ?? "";
            const parentId = crumbs.length > 1 ? crumbs[crumbs.length - 2]?.id : rootId;
            result = result.replaceAll("{{root_id}}", rootId);
            result = result.replaceAll("{{parent_id}}", parentId);
        } catch {
            result = result.replaceAll("{{root_id}}", "");
            result = result.replaceAll("{{parent_id}}", "");
        }
    }

    // 4. Resolve custom attributes (Only Class Method Mode allows {{attr:KEY}} from custom block attributes)
    const attrMatches = result.match(/\{\{attr:([^}]+)\}\}/g);
    if (attrMatches && blockId) {
        if (isClassMethodMode) {
            try {
                const res = await post("/api/attr/getBlockAttrs", { id: blockId });
                const attrs: Record<string, string> = res.data ?? {};
                for (const match of attrMatches) {
                    const attrKey = match.slice(7, -2);
                    result = result.replaceAll(match, attrs[attrKey] ?? "");
                }
            } catch { /* ignore */ }
        } else {
            // For Tool Component mode, replace any residual {{attr:KEY}} with empty string to prevent exposure/errors
            console.log(`[Dispatcher] Custom attribute mapping {{attr:...}} is disabled in Tool Component mode.`);
            for (const match of attrMatches) {
                result = result.replaceAll(match, "");
            }
        }
    }

    return result;
}



/** 解析 AV Command Param 列里的 JSON 字符串 */
export function parseParam(raw: string | null | undefined): Record<string, unknown> {
    if (!raw || raw.trim() === "") return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch (e) {
        console.warn("[Dispatcher] Failed to parse Command Param JSON:", raw, e);
    }
    return {};
}

/**
 * 降级路由：当 commandId 不在注册表中时，按前缀猜测执行方式。
 * 保证向后兼容——手写的 ID（如 "general.graphView"）即使没注册也能工作。
 */
function dispatchByPrefix(
    commandId: string,
    rawParam: string | null | undefined,
    context: CommandContext
): DispatchResult {
    const prefix = commandId.split(".")[0];

    if (prefix === "editor") {
        // keyboard 路经：在 keymap 里按路径查找
        const parts = commandId.split(".");
        let node: any = (window as any).siyuan?.config?.keymap;
        for (const part of parts) { node = node?.[part]; if (!node) break; }
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

    if (prefix === "general") {
        const bareCmd = commandId.split(".").pop()!;
        globalCommand(bareCmd, plugin.app);
        return { success: true, method: "global", detail: `fallback:${bareCmd}` };
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

function formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(d: Date): string {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
