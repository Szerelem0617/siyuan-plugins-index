/**
 * dispatcher/dispatcher-core.ts
 *
 * IndexOS 统一命令调度中枢 (Command Dispatcher Core)
 * 职责：
 * 1. 上下文预计算与标准化（结合 Dual-Track Context）
 * 2. 前置约束安全检查（环境、目标作用域）
 * 3. 多层级参数解析与模版替换
 * 4. 底层协议分发与出参/物理属性自动同步
 */

import { post } from "../../../shared/api-client/request";
import { commandRegistry } from "../registry/command-registry";
import { getCompositeOutputToken } from "../composite/composite-auto-context";
import { getBlockId } from "../utils/context-extractor";
import { evaluateCommandConstraints } from "../utils/constraint-checker";
import { sanitizeBlockAttrName } from "../utils/attribute-sanitizer";
import { normalizeCommandContext } from "./context-builder";
import { resolveCommandParams } from "./param-resolver";
import { dispatchKeyboard, dispatchGlobal, dispatchApi, dispatchCustom } from "./executors";
import type { CommandContext, ParamSources, DispatchResult, ExecutionMode } from "./types";

export async function dispatchCommand(
    commandId: string,
    rawParam: string | Record<string, unknown> | null | undefined,
    rawContext?: Partial<CommandContext> | null,
    sources?: ParamSources
): Promise<DispatchResult> {
    // 1. 统一构建和标准化双轨上下文 (自动预计算 geometry 空间物理坐标与 vars)
    const context: CommandContext = normalizeCommandContext(rawContext);
    const mode: ExecutionMode = context.executionMode || "foreground";

    try {
        const def = commandRegistry.getCommand(commandId);
        if (!def) {
            return dispatchByPrefix(commandId, rawParam, context);
        }

        // 2. 前置约束环境检查
        const targetNodeType = context.blockEl ? (context.blockEl.getAttribute("data-type") || "") : undefined;
        const constraintCheck = evaluateCommandConstraints(def, mode, targetNodeType);
        if (!constraintCheck.allowed) {
            return { success: true, method: def.dispatch.method, detail: constraintCheck.reason || "Skipped" };
        }

        // 3. 参数解析与模板替换 (显式传入的 rawParam 作为 Layer 3 manual 优先解析)
        const resolvedParams = sources
            ? await resolveCommandParams(def, sources, context, commandId)
            : await resolveCommandParams(def, { manual: rawParam }, context, commandId);

        if (resolvedParams.enabled === false || resolvedParams.enabled === "false" || resolvedParams.enabled === 0) {
            return { success: true, method: def.dispatch.method, detail: "Skipped via enabled=false" };
        }

        // 4. 底层分发协议执行
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

        // 5. 出参捕获与变量池同步
        if (result.success) {
            if (!result.outputs) result.outputs = {};
            const resultId = result.id || (result.value && typeof result.value === "object" ? (result.value as any).id : undefined);

            for (const schemaOut of (def.outputs || [])) {
                const rawVal = result.outputs[schemaOut.key] ?? (schemaOut.key === "id" || schemaOut.type === "blockid" ? resultId : undefined);
                if (rawVal !== undefined && rawVal !== null) {
                    const token = getCompositeOutputToken(def.id, schemaOut.key, schemaOut.default);
                    const bareVarName = token.replace(/^\{\{\s*var\./, "").replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").replace(/^var\./, "").trim() || schemaOut.key;
                    
                    if (!context.vars) context.vars = {};
                    context.vars[bareVarName] = String(rawVal);
                    context.vars[`var.${bareVarName}`] = String(rawVal);
                    context.vars[token] = String(rawVal);
                    result.outputs[bareVarName] = String(rawVal);
                }
            }

            // 6. 🌟 出参固化到属性流水线 (支持显式 _saveOutputs 声明 与 Manual 跨时间依赖自动感知)
            const saveOutputsConfig = (resolvedParams as any)?._saveOutputs || (resolvedParams as any)?.saveOutputs;
            const targetBlockId = getBlockId(context);

            // 6.1 收集所有需要持久化落盘的出参字段列表
            const keysToPersist: { outKey: string; targetProp?: string }[] = [];

            // A. 显式配置驱动
            if (saveOutputsConfig) {
                if (Array.isArray(saveOutputsConfig)) {
                    for (const k of saveOutputsConfig) {
                        if (typeof k === "string" && k.trim()) {
                            keysToPersist.push({ outKey: k.trim() });
                        }
                    }
                } else if (typeof saveOutputsConfig === "object") {
                    for (const [k, v] of Object.entries(saveOutputsConfig)) {
                        const targetProp = (typeof v === "string" && v.trim() !== "" && v !== "true") ? v.trim() : undefined;
                        keysToPersist.push({ outKey: k.trim(), targetProp });
                    }
                }
            }

            // B. 智能跨时间依赖感知：如果当前在 Supertag 上下文中，且该 Supertag 的 Manual 菜单命令入参引用了某个出参
            if (context.supertag) {
                const cleanTag = context.supertag.replace(/^#+/, "").trim().toLowerCase();
                const { SUPERTAG_REGISTRY } = await import("../registration");
                const boundManuals = SUPERTAG_REGISTRY.filter(item =>
                    item.typeTag.replace(/^#+/, "").trim().toLowerCase() === cleanTag &&
                    item.uiLocation !== "BoundOnly"
                );

                for (const manual of boundManuals) {
                    const inputStr = manual.inputMapping || "";
                    if (inputStr.includes("{{")) {
                        const matches = inputStr.matchAll(/\{\{(?:var\.)?([a-zA-Z0-9_.-]+)\}\}/g);
                        for (const m of matches) {
                            const refKey = m[1].trim();
                            // 检查该引用 key 是否匹配当前命令产出的出参 (例如 createdblock, id)
                            if (refKey && !keysToPersist.some(p => p.outKey === refKey || p.targetProp === refKey)) {
                                if (refKey in result.outputs || (resultId && (refKey.includes("block") || refKey.includes("id")))) {
                                    keysToPersist.push({ outKey: refKey });
                                }
                            }
                        }
                    }
                }
            }

            // 6.2 统一执行属性落盘与 AV 动态建列
            if (targetBlockId && keysToPersist.length > 0 && result.outputs) {
                try {
                    const customAttrs: Record<string, string> = {};
                    const { resolveTargetAttributeKey } = await import("../effect/set-block-attribute");

                    for (const { outKey, targetProp } of keysToPersist) {
                        const rawKey = outKey.replace(/^var\./, "");
                        let val = result.outputs[rawKey] ||
                                  result.outputs[outKey] ||
                                  context.vars?.[rawKey] ||
                                  context.vars?.[outKey];

                        if (val === undefined || val === null || String(val).trim() === "") {
                            // 智能匹配：如果当前命令产出了唯一有效 ID，且字段名含 block/id/card
                            if (resultId && (rawKey.includes("block") || rawKey.includes("id") || rawKey.includes("card"))) {
                                val = resultId;
                            } else if (Object.keys(result.outputs).length === 1) {
                                val = Object.values(result.outputs)[0];
                            }
                        }

                        if (val !== undefined && val !== null && String(val).trim() !== "") {
                            const finalPropName = targetProp || rawKey;
                            const resolvedKey = await resolveTargetAttributeKey(finalPropName, val, context.supertag);
                            customAttrs[resolvedKey.physicalKey] = String(val).trim();
                        }
                    }

                    if (Object.keys(customAttrs).length > 0) {
                        await post("/api/attr/setBlockAttrs", {
                            id: targetBlockId,
                            attrs: customAttrs
                        });
                    }
                } catch (saveErr) {
                    console.error(`[Dispatcher] 出参固化到块属性失败:`, saveErr);
                }
            }
        }

        return result;

    } catch (error: any) {
        console.error(`💥 [Dispatcher ROOT ERROR] 派发器抛出捕获到致命异常:`, error);
        return {
            success: false,
            method: "error",
            detail: error.message || String(error)
        };
    }
}

export function dispatchByPrefix(
    commandId: string,
    _rawParam: string | Record<string, unknown> | null | undefined,
    _context: CommandContext
): DispatchResult {
    return { success: false, method: "unknown", detail: `Command ${commandId} not found` };
}

export function getBlockType(el: HTMLElement | null): string {
    if (!el) return "";
    return el.getAttribute("data-type") || "";
}

export function updateContextVar(context: CommandContext, key: string, value: any): void {
    if (!context.vars) context.vars = {};
    const cleanKey = key.replace(/^vars?\./, "").replace(/^var\./, "");
    context.vars[key] = value;
    context.vars[cleanKey] = value;
    context.vars[`var.${cleanKey}`] = value;
}
