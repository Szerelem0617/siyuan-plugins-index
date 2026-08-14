/**
 * dispatcher/param-resolver.ts
 *
 * 负责参数解析、多层级来源合并、模版占位符实时替换 ({{time}}, {{cycle}}, {{prompt}} 等)
 * 以及 Auto-Context 链式推导与上下文块 ID 注入。
 */

import type { CommandDef } from "../registry/command-registry";
import { getSupertagAutoContextInfo } from "../supertag/core/supertag-auto-context";
import { getBlockId, getParentIdAndRootId, getBlockAttrs, resolveLayer4Params } from "../utils/context-extractor";
import { renderTemplate, formatDate, formatTime } from "../utils/template-engine";
import { promptUserModal } from "../utils/prompt-modal";
import { COMMAND_BINDINGS } from "../registration";
import type { CommandContext, ParamSources } from "./types";

export function parseParam(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (_) {
        return {};
    }
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

export async function resolveCommandParams(
    def: CommandDef,
    sources: ParamSources,
    context: CommandContext,
    specificCommandId?: string
): Promise<Record<string, unknown>> {
    const actualId = specificCommandId || (context as any)?.actualCommandId || def.id;
    console.log(`  [ParamResolver STEP A] 准备解析 ${actualId} 的参数来源...`);
    
    // Layer 3 客制化入参 (最高优先级)
    const layer3Params = parseParam(sources.sources || sources.manual);

    // Layer 2 默认入参（优先精准匹配当前分身 commandRef，如 plugin-index.command.setBlockAttribute-1）
    let liveDbParam: any = null;
    try {
        const liveDbBinding = Object.values(COMMAND_BINDINGS).find(b => 
            b.commandRef === actualId || b.methodName === actualId || b.commandRef === def.id || b.methodName === def.name
        );
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
                    if ((vKey.startsWith("var.") || vKey.startsWith("custom-") || vKey === "createdblock" || vKey === "id" || vKey === "last_id") && typeof vVal === "string" && /^\d{14}-[a-z0-9]{7}$/.test(vVal.trim())) {
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
                    variables[cleanKey] = strVal;
                    variables[`attr.${cleanKey}`] = strVal;
                    variables[k] = strVal;
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
