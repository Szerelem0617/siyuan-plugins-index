/**
 * pipeline/manager.ts
 * 复合命令注册管理：从 Command-DB 读取 Pipeline 定义 → 注册/注销 pipeline.* 命令
 */

import { Dialog, showMessage } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { sleep } from "../../../shared/utils";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { getCommandAvId } from "../registration";
import { commandRegistry } from "../registry/command-registry";
import { runPipeline } from "./engine";
import { validatePipeline, type PipelineConfig } from "./types";

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

/** 注册（或更新）一个复合命令。executor 闭包携带当前配置。 */
export function registerPipelineCommand(id: string, name: string, config: PipelineConfig, globalParams: string): string {
    if (commandRegistry.getCommand(id)) {
        commandRegistry.unregisterCommand(id);
    }
    commandRegistry.registerCommand({
        id,
        name,
        description: `复合命令（Pipeline）：${name}`,
        dispatch: {
            method: "custom",
            executor: async (params, ctx) => runPipeline(config, ctx, params || globalParams || undefined)
        },
        params: [],
        constraints: { requiresFocus: false, environment: "universal" },
        meta: { scope: "global", category: "custom", source: "user", plugin: "pipeline" }
    });
    registeredPipelines.add(id);
    return id;
}

/** 获取 Command-DB 的关键列 keyID */
export async function getCommandDbKeyIds(): Promise<{
    pkKeyId: string;
    cmdIdKeyId: string;
    paramKeyId: string;
    uiKeyId: string;
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
        paramKeyId: findId("Param Mapping", "参数映射"),
        uiKeyId: findId("UI 入口"),
        pipelineKeyId: findId("Pipeline 定义", "Pipeline Config")
    };
    return result.pipelineKeyId ? result : null;
}

/** 在 Command-DB 创建一行复合命令记录 */
export async function createPipelineRow(name: string, config: PipelineConfig, globalParams = "{}"): Promise<string> {
    const cmdAvId = getCommandAvId();
    if (!cmdAvId) {
        throw new Error("请先将数据存储到思源（Command-DB 不存在）");
    }
    const keys = await getCommandDbKeyIds();
    if (!keys) {
        throw new Error("Command-DB 缺少 'Pipeline 定义' 列：请删除 IndexOS 笔记本后重新“将数据存到思源”");
    }

    // @ts-ignore
    const rowId = window.Lute?.NewNodeID() || Date.now().toString();
    await post("/api/av/addAttributeViewBlocks", {
        avID: cmdAvId,
        srcs: [{ itemID: rowId, id: "", isDetached: true }]
    });
    await sleep(300);

    const ops: any[] = [];
    const commandId = pipelineCommandId(rowId);
    if (keys.pkKeyId) ops.push({ keyID: keys.pkKeyId, itemID: rowId, value: { type: "block", block: { content: name } } });
    if (keys.cmdIdKeyId) ops.push({ keyID: keys.cmdIdKeyId, itemID: rowId, value: { type: "text", text: { content: commandId } } });
    if (keys.paramKeyId) ops.push({ keyID: keys.paramKeyId, itemID: rowId, value: { type: "text", text: { content: globalParams } } });
    if (keys.uiKeyId) ops.push({ keyID: keys.uiKeyId, itemID: rowId, value: { type: "mSelect", mSelect: [{ content: "快捷命令" }] } });
    if (keys.pipelineKeyId) ops.push({ keyID: keys.pipelineKeyId, itemID: rowId, value: { type: "text", text: { content: JSON.stringify(config, null, 2) } } });
    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: cmdAvId, values: ops });
    return rowId;
}

/**
 * 从 Command-DB 同步所有 Pipeline 定义并注册为复合命令。
 * 仅已实例化时调用（未实例化没有 Command-DB）。
 */
export async function syncPipelinesFromCommandDb(): Promise<void> {
    try {
        unregisterAllPipelines();
        const cmdAvId = getCommandAvId();
        if (!cmdAvId) return;

        const { db } = await getSqliteEngine();
        const tableName = `av_${cmdAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const colRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Pipeline 定义' OR key_name = 'Pipeline Config')`, [cmdAvId]);
        if (colRes.length === 0 || colRes[0].values.length === 0) {
            return; // 旧库没有 Pipeline 列
        }
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
            const rawConfig = String(row[2] || "").trim();
            const globalParams = String(row[3] || "");
            const storedCmdId = String(row[4] || "").trim();
            if (!rowId || !rawConfig) continue;
            try {
                const parsed = JSON.parse(rawConfig);
                const { ok, errors } = validatePipeline(parsed);
                if (!ok) {
                    console.warn(`[Pipeline] 跳过无效配置 "${label}":`, errors);
                    continue;
                }
                const name = parsed.name || label || rowId;
                // 优先使用 Command ID 列存的值（旧格式兼容），否则按行 ID 派生哈希 ID
                const commandId = storedCmdId.startsWith("pipeline.") ? storedCmdId : pipelineCommandId(rowId);
                registerPipelineCommand(commandId, name, parsed, globalParams);
                console.log(`[Pipeline] 已注册复合命令 ${commandId} (${name})`);
            } catch (e) {
                console.error(`[Pipeline] 解析 "${label}" 失败:`, e);
            }
        }
    } catch (e) {
        console.error("[Pipeline] syncPipelinesFromCommandDb failed:", e);
    }
}

/** 打开复合命令编辑器对话框 */
export function openPipelineEditor(onCreated?: (rowId: string, name: string) => void): void {
    const dialog = new Dialog({
        title: "创建复合命令 (Pipeline)",
        content: `<div id="pipeline-editor-container" style="height: 100%;"></div>`,
        width: "560px",
        height: "640px"
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
