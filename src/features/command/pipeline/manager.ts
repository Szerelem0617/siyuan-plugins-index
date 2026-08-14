/**
 * pipeline/manager.ts
 * 复合命令注册管理：Command-DB 的 "Pipeline 定义" 列存统一规则脚本（script-dsl），
 * 读取后注册为 pipeline.* 命令，执行走统一引擎 runRuleScript。
 */

import { Dialog, showMessage } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { sleep } from "../../../shared/utils";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { getCommandAvId } from "../registration";
import { commandRegistry } from "../registry/command-registry";
import type { CommandContext } from "../command-dispatcher";
import { runRuleScript } from "./engine";
import { parseRuleScript, type RuleScript } from "./script-dsl";

const registeredPipelines = new Set<string>();

/** 由 AV 行 ID 派生稳定的短哈希后缀（避免与思源 block id 格式混淆） */
function shortHash(input: string): string {
    let h1 = 0xdeadbeef ^ input.length;
    let h2 = 0x41c6ce57 ^ input.length;
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)).slice(0, 10);
}

/** 复合命令 ID：pipeline. + 短哈希（不含时间戳-连字符模式，避免与 block id 误判） */
export function pipelineCommandId(rowId: string): string {
    return `pipeline.${shortHash(rowId)}`;
}

export function unregisterAllPipelines(): void {
    for (const id of registeredPipelines) {
        commandRegistry.unregisterCommand(id);
    }
    registeredPipelines.clear();
}

/** 注册（或更新）一个复合命令。executor 闭包携带脚本。 */
export function registerPipelineCommand(id: string, name: string, script: string, globalParams: string): string {
    if (commandRegistry.getCommand(id)) {
        commandRegistry.unregisterCommand(id);
    }
    commandRegistry.registerCommand({
        id,
        name,
        description: `复合命令（Pipeline）：${name}`,
        dispatch: {
            method: "custom",
            executor: async (params, ctx) => {
                const merged: Record<string, unknown> = { ...parseGlobalParams(globalParams), ...(params || {}) };
                const runCtx: CommandContext = {
                    ...ctx,
                    vars: { ...((ctx as any).vars || {}), ...merged }
                };
                const result = await runRuleScript(script, runCtx);
                return result.success
                    ? { success: true, method: "custom", detail: "pipeline ok", value: result.vars }
                    : { success: false, method: "custom", detail: result.detail || "pipeline failed" };
            }
        },
        params: [],
        constraints: { requiresFocus: false, environment: "universal" },
        meta: { contextNeed: "none", category: "custom", source: "user", plugin: "pipeline" }
    });
    registeredPipelines.add(id);
    return id;
}

function parseGlobalParams(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
}

function cleanJsonOrEmpty(jsonStr?: string): string {
    if (!jsonStr) return "";
    const trimmed = jsonStr.trim();
    if (trimmed === "{}" || trimmed === "null" || trimmed === "") return "";
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
    } catch (_) {}
    return trimmed;
}

import { inferPipelineIO } from "./pipeline-io-infer";

/** 获取 Command-DB 的关键列 keyID */
export async function getCommandDbKeyIds(): Promise<{
    pkKeyId: string;
    cmdIdKeyId: string;
    inputKeyId: string;
    outputKeyId: string;
    pipelineKeyId: string;
} | null> {
    const cmdAvId = getCommandAvId();
    if (!cmdAvId) return null;
    const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: cmdAvId });
    const keys: any[] = Array.isArray(keysRes) ? keysRes : (keysRes?.keys || []);
    const findId = (...names: string[]) => {
        for (const name of names) {
            const hit = keys.find((k: any) => k.name === name);
            if (hit) return String(hit.id || "");
        }
        return "";
    };
    const pk = keys.find((k: any) => k.type === "block" || k.name === "主键" || k.name === "Primary Key");
    const result = {
        pkKeyId: pk?.id ? String(pk.id) : (keys[0]?.id ? String(keys[0].id) : ""),
        cmdIdKeyId: findId("Command ID", "Command_ID"),
        inputKeyId: findId("Input", "Input Mapping", "Param Mapping", "参数映射", "入参映射"),
        outputKeyId: findId("Output", "Output Mapping", "出参映射"),
        pipelineKeyId: findId("Pipeline 定义", "Pipeline Config")
    };
    return result.pipelineKeyId ? result : null;
}

/** 在 Command-DB 创建一行复合命令记录（自动填充 Input, Output, Pipeline 定义） */
export async function createPipelineRow(
    name: string,
    script: string,
    inputParams?: string,
    outputParams?: string
): Promise<string> {
    const cmdAvId = getCommandAvId();
    if (!cmdAvId) {
        throw new Error("请先将数据存储到思源（Command-DB 不存在）");
    }
    const keys = await getCommandDbKeyIds();
    if (!keys) {
        throw new Error("Command-DB 缺少 'Pipeline 定义' 列：请删除 IndexOS 笔记本后重新“将数据存到思源”");
    }

    const rule = parseRuleScript(script);
    let finalInputJson = inputParams;
    let finalOutputJson = outputParams;

    if ((!finalInputJson || finalInputJson === "{}" || finalInputJson === "") && rule) {
        const inferred = inferPipelineIO(rule);
        finalInputJson = Object.keys(inferred.input).length > 0 ? JSON.stringify(inferred.input, null, 2) : "";
        if (!finalOutputJson || finalOutputJson === "{}" || finalOutputJson === "") {
            finalOutputJson = Object.keys(inferred.output).length > 0 ? JSON.stringify(inferred.output, null, 2) : "";
        }
    }

    // @ts-ignore
    const rowId = window.Lute?.NewNodeID() || Date.now().toString();
    await post("/api/av/addAttributeViewBlocks", {
        avID: cmdAvId,
        srcs: [{ itemID: rowId, id: "", isDetached: true }]
    });
    await sleep(300);

    const commandId = pipelineCommandId(rowId);
    const ops: any[] = [];
    if (keys.pkKeyId) ops.push({ keyID: keys.pkKeyId, itemID: rowId, value: { type: "block", block: { content: name } } });
    if (keys.cmdIdKeyId) ops.push({ keyID: keys.cmdIdKeyId, itemID: rowId, value: { type: "text", text: { content: commandId } } });
    if (keys.inputKeyId) ops.push({ keyID: keys.inputKeyId, itemID: rowId, value: { type: "text", text: { content: cleanJsonOrEmpty(finalInputJson) } } });
    if (keys.outputKeyId) ops.push({ keyID: keys.outputKeyId, itemID: rowId, value: { type: "text", text: { content: cleanJsonOrEmpty(finalOutputJson) } } });
    if (keys.pipelineKeyId) ops.push({ keyID: keys.pipelineKeyId, itemID: rowId, value: { type: "text", text: { content: script } } });
    
    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: cmdAvId, values: ops });
    return rowId;
}

/** 读取一行复合命令的脚本与 Input/Output */
export async function readPipelineRow(rowId: string): Promise<{
    name: string;
    script: string;
    inputStr: string;
    outputStr: string;
    rule: RuleScript | null;
} | null> {
    const cmdAvId = getCommandAvId();
    if (!cmdAvId) return null;
    const { db } = await getSqliteEngine();
    const tableName = `av_${cmdAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const pkRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [cmdAvId]);
    const pkCol = pkRes.length > 0 && pkRes[0].values.length > 0 ? String(pkRes[0].values[0][0]) : "label";
    
    const pipeRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Pipeline 定义' OR key_name = 'Pipeline Config')`, [cmdAvId]);
    if (pipeRes.length === 0 || pipeRes[0].values.length === 0) return null;
    const pipeCol = String(pipeRes[0].values[0][0]);

    const inputRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Input' OR key_name = 'Input Mapping' OR key_name = 'Param Mapping' OR key_name = '参数映射' OR key_name = '入参映射')`, [cmdAvId]);
    const inputCol = inputRes.length > 0 && inputRes[0].values.length > 0 ? String(inputRes[0].values[0][0]) : "";

    const outputRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Output' OR key_name = 'Output Mapping' OR key_name = '出参映射')`, [cmdAvId]);
    const outputCol = outputRes.length > 0 && outputRes[0].values.length > 0 ? String(outputRes[0].values[0][0]) : "";

    const selectCols = [`"${pkCol}"`, `"${pipeCol}"`];
    if (inputCol) selectCols.push(`"${inputCol}"`);
    if (outputCol) selectCols.push(`"${outputCol}"`);

    const rows = db.exec(`SELECT ${selectCols.join(", ")} FROM "${tableName}" WHERE _itemID = ?`, [rowId]);
    if (rows.length === 0 || rows[0].values.length === 0) return null;
    const r = rows[0].values[0];
    const name = String(r[0] || "");
    const script = String(r[1] || "").trim();
    const inputStr = inputCol && r[2] !== undefined ? String(r[2] || "") : "";
    const outputStr = outputCol ? (inputCol ? String(r[3] || "") : String(r[2] || "")) : "";

    if (!script) return null;
    return { name, script, inputStr, outputStr, rule: parseRuleScript(script) };
}

/** 更新一行复合命令的名称、脚本与 Input/Output */
export async function updatePipelineRow(
    rowId: string,
    name: string,
    script: string,
    inputParams?: string,
    outputParams?: string
): Promise<void> {
    const cmdAvId = getCommandAvId();
    const keys = await getCommandDbKeyIds();
    if (!cmdAvId || !keys) {
        throw new Error("Command-DB 不可用或缺少 Pipeline 列");
    }

    const rule = parseRuleScript(script);
    let finalInputJson = inputParams;
    let finalOutputJson = outputParams;

    if ((!finalInputJson || finalInputJson === "{}" || finalInputJson === "") && rule) {
        const inferred = inferPipelineIO(rule);
        finalInputJson = Object.keys(inferred.input).length > 0 ? JSON.stringify(inferred.input, null, 2) : "";
        if (!finalOutputJson || finalOutputJson === "{}" || finalOutputJson === "") {
            finalOutputJson = Object.keys(inferred.output).length > 0 ? JSON.stringify(inferred.output, null, 2) : "";
        }
    }

    const ops: any[] = [];
    if (keys.pkKeyId) ops.push({ keyID: keys.pkKeyId, itemID: rowId, value: { type: "block", block: { content: name } } });
    if (keys.inputKeyId) ops.push({ keyID: keys.inputKeyId, itemID: rowId, value: { type: "text", text: { content: cleanJsonOrEmpty(finalInputJson) } } });
    if (keys.outputKeyId) ops.push({ keyID: keys.outputKeyId, itemID: rowId, value: { type: "text", text: { content: cleanJsonOrEmpty(finalOutputJson) } } });
    if (keys.pipelineKeyId) ops.push({ keyID: keys.pipelineKeyId, itemID: rowId, value: { type: "text", text: { content: script } } });
    
    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: cmdAvId, values: ops });
}

/** 从 Command-DB 同步所有复合命令脚本并注册 */
export async function syncPipelinesFromCommandDb(): Promise<void> {
    try {
        unregisterAllPipelines();
        const cmdAvId = getCommandAvId();
        if (!cmdAvId) return;

        const { db } = await getSqliteEngine();
        const tableName = `av_${cmdAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const colRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Pipeline 定义' OR key_name = 'Pipeline Config')`, [cmdAvId]);
        if (colRes.length === 0 || colRes[0].values.length === 0) return;
        const pipelineCol = String(colRes[0].values[0][0]);

        const pkRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [cmdAvId]);
        const pkCol = pkRes.length > 0 && pkRes[0].values.length > 0 ? String(pkRes[0].values[0][0]) : "label";
        const paramRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Param Mapping' OR key_name = '参数映射')`, [cmdAvId]);
        const paramCol = paramRes.length > 0 && paramRes[0].values.length > 0 ? String(paramRes[0].values[0][0]) : "Param_Mapping";
        const cmdIdRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Command ID' OR key_name = 'Command_ID')`, [cmdAvId]);
        const cmdIdCol = cmdIdRes.length > 0 && cmdIdRes[0].values.length > 0 ? String(cmdIdRes[0].values[0][0]) : "Command_ID";

        const rows = db.exec(`SELECT _itemID, "${pkCol}", "${pipelineCol}", "${paramCol}", "${cmdIdCol}" FROM "${tableName}" WHERE "${pipelineCol}" IS NOT NULL AND "${pipelineCol}" != ''`);
        if (rows.length === 0 || rows[0].values.length === 0) return;

        for (const row of rows[0].values) {
            const rowId = String(row[0] || "");
            const label = String(row[1] || "");
            const script = String(row[2] || "").trim();
            const globalParams = String(row[3] || "");
            const storedCmdId = String(row[4] || "").trim();
            if (!rowId || !script) continue;
            const rule = parseRuleScript(script);
            if (!rule) {
                console.warn(`[Pipeline] 跳过无法解析的脚本行 "${label}"`);
                continue;
            }
            const commandId = storedCmdId.startsWith("pipeline.") ? storedCmdId : pipelineCommandId(rowId);
            registerPipelineCommand(commandId, rule.name || label || rowId, script, globalParams);
            console.log(`[Pipeline] 已注册复合命令 ${commandId} (${rule.name || label})`);
        }
    } catch (e) {
        console.error("[Pipeline] syncPipelinesFromCommandDb failed:", e);
    }
}

/** 打开复合命令编辑器（新建） */
export function openPipelineEditor(onCreated?: (rowId: string, name: string) => void): void {
    const dialog = new Dialog({
        title: "创建复合命令 (Pipeline)",
        content: `<div id="pipeline-editor-container" style="height: 100%;"></div>`,
        width: "680px",
        height: "720px"
    });
    dialog.element.classList.add("indexos-dialog");

    import("./PipelineEditorDialog.svelte").then(m => {
        new m.default({
            target: dialog.element.querySelector("#pipeline-editor-container")!,
            props: { dialog, onCreated }
        });
    }).catch(e => {
        console.error("[Pipeline] Failed to load editor:", e);
        showMessage("加载复合命令编辑器失败", 5000, "error");
        dialog.destroy();
    });
}

/** 打开复合命令编辑器（编辑已有行，initialScript 为 Pipeline 定义列内容） */
export function openPipelineEditorForRow(rowId: string, initialScript: string, onSaved?: (rowId: string, name: string) => void): void {
    const dialog = new Dialog({
        title: "编辑复合命令 (Pipeline)",
        content: `<div id="pipeline-editor-container" style="height: 100%;"></div>`,
        width: "680px",
        height: "720px"
    });
    dialog.element.classList.add("indexos-dialog");

    import("./PipelineEditorDialog.svelte").then(m => {
        new m.default({
            target: dialog.element.querySelector("#pipeline-editor-container")!,
            props: { dialog, initialScript, editRowId: rowId, onCreated: onSaved }
        });
    }).catch(e => {
        console.error("[Pipeline] Failed to load editor:", e);
        showMessage("加载复合命令编辑器失败", 5000, "error");
        dialog.destroy();
    });
}
