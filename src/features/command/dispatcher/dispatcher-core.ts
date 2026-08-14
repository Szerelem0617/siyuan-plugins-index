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
import { getCommandOutputToken } from "../supertag/core/supertag-auto-context";
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

        // 3. 参数解析与模板替换
        const resolvedParams = sources
            ? await resolveCommandParams(def, sources, context, commandId)
            : await resolveCommandParams(def, { commandDb: rawParam }, context, commandId);

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
            if (result.id && !result.outputs.createdblock) result.outputs.createdblock = result.id;
            if (result.value && typeof result.value === "object" && (result.value as any).id && !result.outputs.createdblock) {
                result.outputs.createdblock = (result.value as any).id;
            }

            for (const schemaOut of (def.outputs || [])) {
                const rawVal = result.outputs[schemaOut.key];
                if (rawVal !== undefined && rawVal !== null) {
                    const token = getCommandOutputToken(def.id, schemaOut.key, schemaOut.default);
                    const cleanVarName = token.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").trim();
                    
                    if (!context.vars) context.vars = {};
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
