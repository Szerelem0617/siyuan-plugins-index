/**
 * command-dispatcher.ts
 * 命令调度器 —— 全链路绝对防御与高亮日志 Debug 版
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
import { evaluateCommandConstraints, type ExecutionMode } from "./utils/constraint-checker";
import { COMMAND_BINDINGS } from "./registration";
export type { ExecutionMode };

export interface ParamSources {
    manual?: Record<string, unknown>;
    auto?: Record<string, unknown>;
    commandDb?: string | Record<string, unknown> | null;
}

export async function dispatchCommand(
    commandId: string,
    rawParam: string | Record<string, unknown> | null | undefined,
    context: CommandContext,
    sources?: ParamSources
): Promise<DispatchResult> {
    if (!context) {
        context = { blockEl: document.body, protyleEl: null };
    }
    if (!context.vars) {
        context.vars = {};
    }

    const mode: ExecutionMode = context.executionMode || "foreground";

    try {
        const def = commandRegistry.getCommand(commandId);
        if (!def) {
            return dispatchByPrefix(commandId, rawParam, context);
        }

        const targetNodeType = context.blockEl ? (context.blockEl.getAttribute("data-type") || "") : undefined;
        const constraintCheck = evaluateCommandConstraints(def, mode, targetNodeType);
        if (!constraintCheck.allowed) {
            return { success: true, method: def.dispatch.method, detail: constraintCheck.reason || "Skipped" };
        }

        const resolvedParams = sources
            ? await resolveCommandParams(def, sources, context)
            : await resolveCommandParams(def, { commandDb: rawParam }, context);

        if (resolvedParams.enabled === false || resolvedParams.enabled === "false" || resolvedParams.enabled === 0) {
            return { success: true, method: def.dispatch.method, detail: "Skipped via enabled=false" };
        }

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

        return result;

    } catch (error: any) {
        console.error(`💥 [Dispatcher ROOT ERROR] 派发器前置阶段抛出捕获到致命异常:`, error);
        return {
            success: false,
            method: "error",
            detail: error.message || String(error)
        };
    }
}

function parseParam(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (_) {
        return {};
    }
}

export async function resolveCommandParams(
    def: CommandDef,
    sources: ParamSources,
    context: CommandContext
): Promise<Record<string, unknown>> {
    console.log(`  [ParamResolver STEP A] 准备解析 ${def.id} 的参数来源...`);
    
    let liveDbParam: any = null;
    try {
        const liveDbBinding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === def.id || b.label === def.name);
        liveDbParam = liveDbBinding?.inputMapping || liveDbBinding?.paramMapping;
    } catch (e) {
        console.warn(`  [ParamResolver STEP A1] 查找 COMMAND_BINDINGS 警告:`, e);
    }

    const effectiveSources: ParamSources = {
        ...sources,
        commandDb: liveDbParam || sources.commandDb
    };

    const raw = mergeParamSources(effectiveSources);
    const result: Record<string, unknown> = {};
    const vars = context.vars || {};

    for (const schema of def.params) {
        let value = raw[schema.key];
        
        if (value === undefined || value === "") {
            if (schema.key === "id" || schema.type === "blockid") {
                const autoId = vars["var.createdblock"] || vars["createdblock"] || vars["var.id"] || vars["id"];
                if (autoId) {
                    value = String(autoId);
                }
            }
            if (schema.key === "enabled") {
                const autoBool = vars["var.last_boolean_result"] ?? vars["last_boolean_result"] ?? vars["var.completed"] ?? vars["completed"];
                if (autoBool !== undefined) {
                    value = autoBool;
                }
            }
        }

        if (value === undefined || value === "") {
            value = schema.default;
        }

        console.log(`  [ParamResolver STEP B] 处理参数 "${schema.key}" (原始值: "${value}")`);
        try {
            if (schema.paramMode === "template") {
                result[schema.key] = await resolveTemplate(String(value ?? ""), context);
            } else if (typeof value === "string") {
                result[schema.key] = await resolveTemplate(value, context);
            } else {
                result[schema.key] = value;
            }
        } catch (err) {
            console.error(`  [ParamResolver STEP B Error] 参数 "${schema.key}" 解析模板失败:`, err);
            result[schema.key] = value;
        }
    }

    for (const [k, v] of Object.entries(raw)) {
        if (!(k in result)) {
            try {
                result[k] = typeof v === "string" ? await resolveTemplate(v, context) : v;
            } catch (_) {
                result[k] = v;
            }
        }
    }

    return result;
}

export function mergeParamSources(sources: ParamSources): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...parseParam(sources.commandDb) };
    if (sources.auto) Object.assign(merged, sources.auto);
    if (sources.manual) Object.assign(merged, sources.manual);
    return merged;
}

import { promptUserModal } from "./utils/prompt-modal";

export async function resolveTemplate(text: string, context: CommandContext): Promise<string> {
    if (!text || typeof text !== "string" || (!text.includes("{{") && !text.includes("${"))) return text;

    let normalizedText = text.replace(/\$\{([a-zA-Z0-9_.:-]+)\}/g, "{{$1}}");

    if (normalizedText.includes("{{prompt") || normalizedText.includes("{{interactive") || normalizedText.includes("{{input")) {
        const isBackground = context.executionMode === "background";
        const promptRegex = /\{\{(prompt|interactive|input)(?::([^}]+))?\}\}/g;
        let match: RegExpExecArray | null;
        while ((match = promptRegex.exec(normalizedText)) !== null) {
            const fullPlaceholder = match[0];
            if (isBackground) {
                normalizedText = normalizedText.replace(fullPlaceholder, "");
            } else {
                const titlePrompt = match[2]?.trim() || "请输入参数内容";
                const userInput = await promptUserModal(titlePrompt);
                normalizedText = normalizedText.replace(fullPlaceholder, userInput ?? "");
            }
        }
    }

    let blockId = "";
    try {
        blockId = getBlockId(context);
    } catch (_) {}

    const variables: Record<string, string> = {
        "date": formatDate(new Date()),
        "time": formatTime(new Date()),
        "block_id": blockId || "",
    };

    if (context.vars) {
        for (const [k, v] of Object.entries(context.vars)) {
            if (v !== undefined && v !== null) {
                const strVal = String(v);
                const varKey = k.startsWith("var.") ? k : `var.${k}`;
                variables[varKey] = strVal;
            }
        }
    }

    if (blockId && (normalizedText.includes("{{root_id}}") || normalizedText.includes("{{parent_id}}"))) {
        try {
            const { rootId, parentId } = await getParentIdAndRootId(blockId);
            variables["root_id"] = rootId;
            variables["parent_id"] = parentId;
        } catch (_) {}
    }

    if (blockId) {
        try {
            const layer4Params = await resolveLayer4Params(blockId, context.supertag);
            for (const [k, v] of Object.entries(layer4Params)) {
                if (v !== undefined && v !== null && (!(k in variables) || !variables[k])) {
                    variables[k] = String(v);
                }
            }
            const attrs = await getBlockAttrs(blockId);
            for (const [k, v] of Object.entries(attrs)) {
                const cleanKey = k.replace(/^custom-/, "");
                if (v !== undefined && v !== null) {
                    const strVal = String(v);
                    if (!(cleanKey in variables)) variables[cleanKey] = strVal;
                    if (!(`var.${cleanKey}` in variables)) variables[`var.${cleanKey}`] = strVal;
                    if (!(`attr:${cleanKey}` in variables)) variables[`attr:${cleanKey}`] = strVal;
                }
            }
        } catch (_) {}
    }

    return renderTemplate(normalizedText, variables);
}

function dispatchByPrefix(
    commandId: string,
    rawParam: string | Record<string, unknown> | null | undefined,
    context: CommandContext
): DispatchResult {
    return { success: false, method: "unknown", detail: `Command ${commandId} not found` };
}

function dispatchKeyboard(def: CommandDef, context: CommandContext): DispatchResult {
    const key = def.dispatch.key;
    if (!key) return { success: false, method: "keyboard", detail: "No key binding defined" };
    try {
        globalCommand(key);
        return { success: true, method: "keyboard", detail: key };
    } catch (e: any) {
        return { success: false, method: "keyboard", detail: e.message };
    }
}

function dispatchGlobal(def: CommandDef): DispatchResult {
    const cmd = def.dispatch.command;
    if (!cmd) return { success: false, method: "global", detail: "No global command defined" };
    try {
        globalCommand(cmd);
        return { success: true, method: "global", detail: cmd };
    } catch (e: any) {
        return { success: false, method: "global", detail: e.message };
    }
}

async function dispatchApi(
    def: CommandDef,
    resolvedParams: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    const endpoint = def.dispatch.endpoint;
    if (!endpoint) return { success: false, method: "api", detail: "No endpoint defined" };

    try {
        const response = await post(endpoint, resolvedParams);
        const resultId = extractCreatedBlockId(response);
        if (resultId) {
            if (!context.vars) context.vars = {};
            context.vars.createdblock = resultId;
            context.vars.id = resultId;
            context.vars.last_id = resultId;
        }

        return {
            success: true,
            method: "api",
            detail: endpoint,
            value: response,
            id: resultId
        };
    } catch (e: any) {
        return { success: false, method: "api", detail: e.message };
    }
}

function extractCreatedBlockId(res: any): string {
    if (!res) return "";
    if (Array.isArray(res)) {
        for (const item of res) {
            if (item?.doOperations) {
                for (const op of item.doOperations) {
                    if (op?.id) return op.id;
                }
            }
            if (item?.id) return item.id;
        }
    }
    if (typeof res === "object") {
        if (res.data) return extractCreatedBlockId(res.data);
        if (res.doOperations) return extractCreatedBlockId(res.doOperations);
        if (res.id) return res.id;
    }
    return "";
}

async function dispatchCustom(
    def: CommandDef,
    resolvedParams: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    console.log(`[Dispatcher STEP Custom] 调用 executor...`);
    if (def.dispatch.executor) {
        const result = await def.dispatch.executor(resolvedParams, context);
        return result;
    }
    return { success: false, method: "custom", detail: `No executor registered for ${def.id}` };
}

export function focusBlockForDispatch(): void {}
export function cleanupAfterDispatch(): void {}
export function getBlockType(el: HTMLElement | null): string {
    if (!el) return "";
    return el.getAttribute("data-type") || "";
}

export function updateContextVar(context: CommandContext, key: string, value: any): void {
    if (!context.vars) context.vars = {};
    context.vars[key] = value;
    const cleanKey = key.replace(/^(vars?\.)/, "");
    context.vars[cleanKey] = value;
    context.vars[`var.${cleanKey}`] = value;
}
