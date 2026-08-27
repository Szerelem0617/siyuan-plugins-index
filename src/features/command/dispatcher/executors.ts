/**
 * dispatcher/executors.ts
 *
 * 底层执行协议分发（Keyboard, Global, HTTP API, Custom Executor）
 */

import { globalCommand } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { plugin } from "../../../shared/utils";
import type { CommandDef } from "../registry/command-registry";
import type { CommandContext, DispatchResult } from "./types";

export function dispatchKeyboard(def: CommandDef, _context: CommandContext): DispatchResult {
    const key = def.dispatch.keymapPath ? def.dispatch.keymapPath.join(":") : ((def.dispatch as any).key || "");
    if (!key) return { success: false, method: "keyboard", detail: "No key binding defined" };
    try {
        (globalCommand as any)(key, plugin?.app);
        return { success: true, method: "keyboard", detail: key };
    } catch (e: any) {
        return { success: false, method: "keyboard", detail: e.message };
    }
}

export function dispatchGlobal(def: CommandDef): DispatchResult {
    const cmd = def.dispatch.target || (def.dispatch as any).command || "";
    if (!cmd) return { success: false, method: "global", detail: "No global command defined" };
    try {
        (globalCommand as any)(cmd, plugin?.app);
        return { success: true, method: "global", detail: cmd };
    } catch (e: any) {
        return { success: false, method: "global", detail: e.message };
    }
}

export async function dispatchApi(
    def: CommandDef,
    resolvedParams: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    const endpoint = def.dispatch.endpoint;
    if (!endpoint) return { success: false, method: "api", detail: "No endpoint defined" };

    try {
        const response = await post(endpoint, resolvedParams);
        const resultId = extractCreatedBlockId(response);

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

export function extractCreatedBlockId(res: any): string {
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

export async function dispatchCustom(
    def: CommandDef,
    resolvedParams: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    console.log(`[Dispatcher STEP Custom] 调用 executor...`);
    if (def.dispatch.executor) {
        const result = await def.dispatch.executor(resolvedParams, context);
        return result as DispatchResult;
    }
    return { success: false, method: "custom", detail: `No executor registered for ${def.id}` };
}
