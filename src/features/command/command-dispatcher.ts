/**
 * command-dispatcher.ts
 * 命令调度器 —— 全链路绝对防御与高亮日志 Debug 版
 */

import { globalCommand, showMessage } from "siyuan";
import { plugin } from "../../shared/utils";
import { post } from "../../shared/api-client/request";
import { commandRegistry } from "./registry/command-registry";
import type { CommandDef } from "./registry/command-registry";
import { getSupertagAutoContextInfo, getCommandOutputToken } from "./supertag/core/supertag-auto-context";
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

import { sanitizeBlockAttrName } from "./utils/attribute-sanitizer";

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

        if (result.success) {
            if (!result.outputs) result.outputs = {};
            if (result.id && !result.outputs.createdblock) result.outputs.createdblock = result.id;
            if (result.value && typeof result.value === "object" && (result.value as any).id && !result.outputs.createdblock) {
                result.outputs.createdblock = (result.value as any).id;
            }

            for (const schemaOut of (def.outputs || [])) {
                const rawVal = result.outputs[schemaOut.key];
                if (rawVal !== undefined && rawVal !== null) {
                    const token = getCommandOutputToken(def.id, schemaOut.key, schemaOut.default);
                    const cleanVarName = token.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").trim();
                    
                    context.vars[cleanVarName] = String(rawVal);
                    context.vars[token] = String(rawVal);
                    console.log(`[Dispatcher] ⚡ 依照 Command-DB 配置存入出参: ${cleanVarName} (${token}) = "${rawVal}"`);

                    const attrKey = sanitizeBlockAttrName(token);
                    if (context.blockEl) {
                        context.blockEl.setAttribute(attrKey, String(rawVal));
                    }
                    try {
                        const targetBlockId = getBlockId(context);
                        if (targetBlockId) {
                            post("/api/attr/setBlockAttrs", {
                                id: targetBlockId,
                                attrs: { [attrKey]: String(rawVal) }
                            }).catch(() => {});
                        }
                    } catch (_) {}
                }
            }
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
    
    // Layer 3 客制化入参 (最高优先级)
    const layer3Params = parseParam(sources.sources || sources.manual);

    // Layer 2 默认入参
    let liveDbParam: any = null;
    try {
        const liveDbBinding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === def.id || b.label === def.name);
        liveDbParam = liveDbBinding?.inputMapping || liveDbBinding?.paramMapping;
    } catch (e) {
        console.warn(`  [ParamResolver STEP A1] 查找 COMMAND_BINDINGS 警告:`, e);
    }
    const layer2Params = parseParam(liveDbParam || sources.commandDb);

    const effectiveSources: ParamSources = {
        commandDb: liveDbParam || undefined,
        ...sources
    };
    const raw = mergeParamSources(effectiveSources);

    const result: Record<string, unknown> = {};
    const vars = context.vars || {};
    const autoContextInfo = context.supertag ? getSupertagAutoContextInfo(context.supertag, def.id) : {};

    for (const schema of def.params) {
        const layer3Val = layer3Params[schema.key];
        const layer2Val = layer2Params[schema.key];
        
        let value: any = undefined;
        const isLayer3Specified = layer3Val !== undefined && String(layer3Val).trim() !== "";

        if (isLayer3Specified) {
            // 1. 显式客制化配置 (Layer 3) 拥有最高优先级
            value = layer3Val;
        } else {
            // 2. 若 Layer 3 留空，依据单一真理源 Auto-Context 分析获取覆盖值
            const autoMatch = autoContextInfo[schema.key];
            let autoVal: any = undefined;
            if (autoMatch && autoMatch.matched && autoMatch.token) {
                autoVal = await resolveTemplate(autoMatch.token, context);
            }

            // 防守双重保障：若 autoVal 尚未获取且当前参数是 ID 参数，实时白盒感应物理属性与 vars 中的 Block ID 出参
            if ((!autoVal || String(autoVal).includes("{{")) && (schema.key === "id" || schema.type === "blockid")) {
                for (const [vKey, vVal] of Object.entries(vars)) {
                    if ((vKey.startsWith("var.") || vKey.startsWith("custom-")) && typeof vVal === "string" && /^\d{14}-[a-z0-9]{7}$/.test(vVal.trim())) {
                        autoVal = vVal.trim();
                        console.log(`  [ParamResolver Auto-Context-Sensing] ⚡ 成功从 vars 动态感应到前置创块 ID (${vKey}): "${autoVal}"`);
                        break;
                    }
                }
                if ((!autoVal || String(autoVal).includes("{{")) && context.blockEl && context.blockEl.attributes) {
                    for (const attr of Array.from(context.blockEl.attributes)) {
                        if (attr.name.startsWith("custom-") && attr.name !== "custom-supertags" && typeof attr.value === "string" && /^\d{14}-[a-z0-9]{7}$/.test(attr.value.trim())) {
                            autoVal = attr.value.trim();
                            console.log(`  [ParamResolver Auto-Context-Sensing] ⚡ 成功从 DOM 物理属性 ${attr.name} 动态感应到前置创块 ID: "${autoVal}"`);
                            break;
                        }
                    }
                }
            }

            if (autoVal !== undefined && String(autoVal).trim() !== "") {
                value = String(autoVal);
                console.log(`  [ParamResolver Auto-Context] ⚡ 依据单一真理源成功自动覆盖 ${schema.key}: "${value}" (优先于 Layer 2 默认值)`);
            } else {
                // 3. 使用 Layer 2 配置值或 Schema 注册默认值
                value = (layer2Val !== undefined && String(layer2Val).trim() !== "") ? layer2Val : schema.default;
            }
        }

        console.log(`  [ParamResolver STEP B] 处理参数 "${schema.key}" (原始模板值: "${value}")`);
        const attrNameVal = String(result["attrName"] || layer3Params["attrName"] || layer2Params["attrName"] || raw["attrName"] || "").trim();
        const contextualContext = attrNameVal ? { ...context, _currentAttrName: attrNameVal } : context;
        try {
            if (schema.paramMode === "template") {
                result[schema.key] = await resolveTemplate(String(value ?? ""), contextualContext);
            } else if (typeof value === "string") {
                result[schema.key] = await resolveTemplate(value, contextualContext);
            } else {
                result[schema.key] = value;
            }
        } catch (err) {
            console.error(`  [ParamResolver STEP B Error] 参数 "${schema.key}" 解析模板失败:`, err);
            result[schema.key] = value;
        }

        // 自动统一处理：若参数为 id / blockid 且最终解析为空，系统自动填充当前上下文块 ID
        if ((schema.key === "id" || schema.type === "blockid") && (!result[schema.key] || String(result[schema.key]).trim() === "")) {
            const currentBlockId = getBlockId(context);
            if (currentBlockId) {
                result[schema.key] = currentBlockId;
                console.log(`  [ParamResolver Auto-Context-Default] ⚡ 自动为 "${schema.key}" 参数应用当前上下文块 ID: "${currentBlockId}"`);
            }
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
    if (sources.manual) {
        const parsedManual = parseParam(sources.manual);
        for (const [k, v] of Object.entries(parsedManual)) {
            if (v !== undefined && v !== "") {
                merged[k] = v;
            }
        }
    }
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
                    if (!(k in variables)) variables[k] = strVal;
                }
            }
        } catch (_) {}
    }

    // 🔄 状态轮转指令解析：{{cycle:v1,v2,v3}} 或 {{cycle}}
    if (normalizedText.includes("{{cycle")) {
        const cycleRegex = /\{\{cycle(?::([^}]+))?\}\}/g;
        let cycleMatch: RegExpExecArray | null;
        while ((cycleMatch = cycleRegex.exec(normalizedText)) !== null) {
            const fullPlaceholder = cycleMatch[0];
            const optionsRaw = cycleMatch[1]?.trim();

            let options: string[] = [];
            if (optionsRaw !== undefined && optionsRaw !== null) {
                options = optionsRaw.split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
            }
            if (options.length === 0 || (options.length === 1 && !options[0])) {
                options = ["pending", "done"];
            }

            let currentVal = "";
            const currentAttrName = (context as any)?._currentAttrName || "";
            if (currentAttrName) {
                const cleanKey = currentAttrName.replace(/^custom-/, "");
                currentVal = variables[cleanKey] || variables[`custom-${cleanKey}`] || variables[currentAttrName] || "";
            } else {
                for (const opt of options) {
                    for (const [vKey, vVal] of Object.entries(variables)) {
                        if (vVal === opt && !vKey.startsWith("var.")) {
                            currentVal = vVal;
                            break;
                        }
                    }
                    if (currentVal) break;
                }
            }

            let nextVal = options[0];
            const currentIndex = options.indexOf(currentVal);
            if (currentIndex >= 0) {
                nextVal = options[(currentIndex + 1) % options.length];
            } else {
                nextVal = options[0];
            }

            console.log(`[TemplateEngine] 🔄 {{cycle}} 轮转计算: 当前值 "${currentVal}" ➔ 下一状态 "${nextVal}" (候选列表: [${options.join(", ")}])`);
            normalizedText = normalizedText.replace(fullPlaceholder, nextVal);
        }
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
