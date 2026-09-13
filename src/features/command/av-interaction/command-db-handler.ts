import { Dialog, showMessage } from "siyuan";
import { getCommandAvId, getTypeAvId, COMMAND_BINDINGS } from "../registration";
import { encodeBtnHref } from "../global-registration/inline-button";
import { commandRegistry } from "../registry/command-registry";
import { updateCellValue } from "../../av/attribute-view/special/special-handlers";
import { getSqliteEngine, executeWritableSql } from "../../sqlite/sqlite-manager";
import { post } from "../../../shared/api-client/request";
import { getInputColKeyId, getOutputColKeyId } from "./query-helper";
import RegistryCommandSelectorDialog from "./dialogs/RegistryCommandSelectorDialog.svelte";
import { readCompositeRow, openCompositeEditorForRow, openCompositeEditor } from "../composite/manager";
import GlobalBackgroundEngineDialog from "./dialogs/GlobalBackgroundEngineDialog.svelte";

/** 检测当前 command-db 视图是否处于“复合命令”View 切页 */
function isPipelineViewActive(avContainer: HTMLElement): boolean {
    try {
        const viewsContainer = avContainer.querySelector(".av__views");
        if (viewsContainer) {
            const activeViewItem = Array.from(viewsContainer.querySelectorAll("div, span, button")).find(el => 
                el.classList.contains("item--focus") || 
                el.classList.contains("item--active") || 
                el.classList.contains("active") || 
                el.getAttribute("data-active") === "true" ||
                el.getAttribute("aria-selected") === "true"
            );
            
            if (activeViewItem) {
                const text = activeViewItem.textContent?.trim() || "";
                if (text.includes("复合命令") || text.includes("Pipeline")) {
                    return true;
                }
                if (text.includes("普通命令")) {
                    return false;
                }
            }
        }

        // 双重兜底：校验表头列名是否包含 Pipeline 定义列
        const headerCells = Array.from(avContainer.querySelectorAll(".av__row--header .av__cell"));
        const hasPipelineCol = headerCells.some(cell => {
            const text = cell.textContent?.trim() || "";
            return text.includes("Pipeline") || text.includes("复合");
        });
        if (hasPipelineCol) return true;
    } catch (e) {
        console.warn("[CommandDB-ViewCheck] Error checking view:", e);
    }
    return false;
}

export function openGlobalAutomationDialog() {
    const dialog = new Dialog({
        title: "⚡ 后台执行控制中心 (Background Engine)",
        content: `<div class="b3-dialog__content" id="global-bg-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
        width: "720px",
        height: "560px"
    });
    dialog.element.classList.add("indexos-dialog");
    dialog.element.querySelector('.b3-dialog__header')?.remove();

    new GlobalBackgroundEngineDialog({
        target: dialog.element.querySelector("#global-bg-config-container")!,
        props: { dialog }
    });
}

export function openCustomUserCommandDialog(onCreatedCallback?: (newCmdId: string) => void) {
    const dialog = new Dialog({
        title: "新建自定义 user. 命令",
        content: `<div id="custom-user-cmd-container"></div>`,
        width: "500px",
        destroyCallback: () => {}
    });
    dialog.element.classList.add("indexos-dialog");
    dialog.element.querySelector('.b3-dialog__header')?.remove();

    import("./dialogs/CustomUserCommandDialog.svelte").then(m => {
        new m.default({
            target: dialog.element.querySelector("#custom-user-cmd-container")!,
            props: {
                dialog,
                onCreated: (newCmdId: string) => {
                    if (onCreatedCallback) onCreatedCallback(newCmdId);
                }
            }
        });
    });
}

export async function handleAvFooterClick(event: MouseEvent) {
    const target = event.target as HTMLElement;

    const avContainer = target.closest("[data-av-id]") || target.closest('[data-type="NodeAttributeView"]') || target.closest(".av__container") || target.closest(".av");
    if (!avContainer) return;

    const avId = avContainer.getAttribute("data-av-id") || "";
    const commandAvId = getCommandAvId();
    const typeAvId = getTypeAvId();
    const txt = target.textContent?.trim() || "";

    if (avId !== commandAvId) return;

    // 1. 匹配“添加字段”按钮 (精准限定为按钮本身，防止滚动条误触)
    const addColBtn = target.closest('[data-type="av-header-add"]') || 
                      target.closest('[data-type="av-add-column"]') || 
                      target.closest('.av__col-add') || 
                      target.closest('.av__header-add');
    if (addColBtn || (target.classList.contains("b3-button") && (txt.includes("添加列") || txt.includes("添加字段")))) {
        event.preventDefault();
        event.stopPropagation();
        const { openEntryConfigDialog } = await import("../entry-config-ui");
        openEntryConfigDialog();
        return;
    }

    // 2. 匹配“添加条目”按钮（收紧范围至按钮本身，排除整行空白与 Scroller 滚动条）
    const addRowBtn = target.closest('[data-type="av-add-bottom"]') || 
                      target.closest('.av__row--util .b3-button') || 
                      target.closest('.av__row--util button') || 
                      (target.classList.contains("b3-button") && txt.includes("添加条目"));

    if (addRowBtn) {
        event.preventDefault();
        event.stopPropagation();

        // 若在“复合命令”View 切页下点击“+ 添加条目”，直接调起复合命令配置 Dialog
        if (isPipelineViewActive(avContainer as HTMLElement)) {
            openCompositeEditor();
            return;
        }

        // 普通命令视图 ➔ 调起内置命令选择器
        await triggerRegistryCommandSelectorForInsert(avId);
        return;
    }
}

export async function openRegistryCommandSelectorDialog(onSelectCallback?: (cmd: any) => void) {
    const avId = getCommandAvId() || "";
    let commands = commandRegistry.getAllCommands().map(c => ({
        id: c.id,
        name: c.name,
        description: c.description || "",
        params: c.params || []
    }));

    if (commands.length === 0) {
        showMessage("系统命令注册表为空或查询失败");
        return;
    }

    const dialog = new Dialog({
        title: `选择内置命令并添加`,
        content: `<div id="registry-command-selector-dialog" style="height: 100%;"></div>`,
        width: "480px",
        height: "400px"
    });
    dialog.element.classList.add("indexos-dialog");
    dialog.element.querySelector('.b3-dialog__header')?.remove();

    new RegistryCommandSelectorDialog({
        target: document.getElementById("registry-command-selector-dialog")!,
        props: {
            commands,
            onSelect: async (cmd: any) => {
                dialog.destroy();
                await insertCommandIntoAv(avId, cmd);
                if (onSelectCallback) onSelectCallback(cmd);
            },
            onPipelineCreated: () => {
                dialog.destroy();
                if (onSelectCallback) onSelectCallback(null);
            }
        }
    });
}

async function triggerRegistryCommandSelectorForInsert(avId: string) {
    await openRegistryCommandSelectorDialog();
}

async function insertCommandIntoAv(avId: string, cmd: any) {
    try {
        const { db } = await getSqliteEngine();
        
        // 1. 查询 SQLite command-db 获取当前已存在的所有 Command ID
        let existingIds: string[] = [];
        try {
            const cmdCheck = db.exec(`SELECT "Command ID" FROM "command-db";`);
            if (cmdCheck.length > 0 && cmdCheck[0].values.length > 0) {
                existingIds = cmdCheck[0].values.map((r: any) => String(r[0] || "")).filter(Boolean);
            }
        } catch (e) {
            console.warn("[insertCommandIntoAv] SQLite query failed:", e);
        }

        const baseId = cmd.id;
        const hasParams = Array.isArray(cmd.params) && cmd.params.length > 0;
        const duplicateExists = existingIds.includes(baseId) || existingIds.some(id => id.startsWith(baseId + "-"));
        let finalId = baseId;
        let finalName = cmd.name;

        if (duplicateExists) {
            if (!hasParams) {
                showMessage("不允许重复添加无参命令", 3000, "error");
                return;
            } else {
                let maxSuffix = 0;
                const pattern = new RegExp(`^${baseId.replace(/\./g, "\\.")}-(\\d+)$`);
                for (const id of existingIds) {
                    const match = id.match(pattern);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (num > maxSuffix) maxSuffix = num;
                    }
                }
                const nextSuffixNum = maxSuffix + 1;
                finalId = `${baseId}-${nextSuffixNum}`;
                finalName = `${cmd.name}-${nextSuffixNum}`;
            }
        }

        const hasOutputs = cmd.outputs && Array.isArray(cmd.outputs) && cmd.outputs.length > 0;
        const inputVal = hasParams ? "{}" : "";
        const outputVal = hasOutputs ? "{}" : "";
        const newRowId = `cmd_${Date.now()}_${finalId.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // 2. 写入 SQLite 核心 command-db 表并持久化
        db.run(
            `INSERT INTO "command-db" (rowID, "主键", "Command ID", "Input", "Output", _updated) VALUES (?, ?, ?, ?, ?, ?);`,
            [newRowId, finalName, finalId, inputVal, outputVal, Date.now()]
        );
        const { saveMetaToStorage } = await import("../indexos/command-sqlite");
        await saveMetaToStorage();

        // 3. 兼容模式：若存在物理 AV，同步向物理表写入
        if (avId) {
            try {
                const schemaCols = db.exec(`SELECT col_name, key_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
                let pkColName = "主键";
                if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
                    pkColName = String(schemaCols[0].values[0][1] || "主键");
                }
                const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
                const insertSql = `INSERT INTO ${tableName} ("${pkColName}", "Command ID", "Input", "Output") VALUES ('${finalName}', '${finalId}', '${inputVal}', '${outputVal}')`;
                await executeWritableSql(insertSql);
            } catch (avErr) {
                console.warn("[insertCommandIntoAv] Optional AV sync skipped:", avErr);
            }
        }

        const { refreshSupertagRegistry } = await import("../utils/sync-service");
        await refreshSupertagRegistry();
        showMessage(`✓ 已成功添加命令: ${finalName}`);
    } catch (e: any) {
        console.error("[FooterClick] Failed to insert command:", e);
        showMessage(`添加命令失败: ${e.message || e}`, 5000, "error");
    }
}

export async function openConfigForCommand(cmdDef: any, cleanLabel: string) {
    const paramsSchema = cmdDef.params || [];
    if (paramsSchema.length === 0) {
        showMessage(`命令 "${cleanLabel}" 不支持参数配置`);
        return;
    }

    try {
        const { db } = await getSqliteEngine();
        const commandAvId = getCommandAvId();

        // 1. 优先从 SQLite 内存 command-db 表匹配行
        let cmdRowId = "";
        let currentInputStr = "{}";
        let currentOutputStr = "{}";

        const sqlRowCheck = db.exec(
            `SELECT rowID, "主键", "Command ID", "Input", "Output" FROM "command-db" WHERE "主键" = ? OR "Command ID" = ? OR "主键" LIKE ? OR "Command ID" LIKE ? LIMIT 1;`,
            [cleanLabel, cmdDef.id, `%${cleanLabel}%`, `%${cmdDef.id}%`]
        );

        if (sqlRowCheck.length > 0 && sqlRowCheck[0].values.length > 0) {
            const v = sqlRowCheck[0].values[0];
            cmdRowId = String(v[0]);
            currentInputStr = String(v[3] || "{}");
            currentOutputStr = String(v[4] || "{}");
        } else {
            // 若 SQLite 中尚无此命令行，自动创建并持久化
            cmdRowId = `cmd_${Date.now()}_${cmdDef.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
            db.run(
                `INSERT INTO "command-db" (rowID, "主键", "Command ID", "Input", "Output", _updated) VALUES (?, ?, ?, ?, ?, ?);`,
                [cmdRowId, cleanLabel, cmdDef.id, "{}", "{}", Date.now()]
            );
            const { saveMetaToStorage } = await import("../indexos/command-sqlite");
            await saveMetaToStorage();
        }

        let currentInputParams = {};
        try { currentInputParams = JSON.parse(currentInputStr); } catch (_) {}
        let currentOutputMapping = {};
        try { currentOutputMapping = JSON.parse(currentOutputStr); } catch (_) {}

        // 2. 唤起配置弹窗
        const dialog = new Dialog({
            title: "配置命令参数 & 出参",
            content: `<div class="b3-dialog__content" id="param-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
            width: "560px",
            height: "540px"
        });
        dialog.element.classList.add("indexos-dialog");
        dialog.element.querySelector('.b3-dialog__header')?.remove();

        const { default: UnifiedCommandConfigDialog } = await import("./dialogs/UnifiedCommandConfigDialog.svelte");
        const outputsSchema = (cmdDef && cmdDef.outputs && Array.isArray(cmdDef.outputs)) ? cmdDef.outputs : [];

        new UnifiedCommandConfigDialog({
            target: dialog.element.querySelector("#param-config-container")!,
            props: {
                dialog,
                commandName: cmdDef.name || cleanLabel,
                commandId: cmdDef.id,
                initialTab: "input",
                paramsSchema,
                outputsSchema,
                currentInputParams,
                currentOutputMapping,
                onSave: async (updatedInput: Record<string, any>, updatedOutput: Record<string, string>) => {
                    const inputJson = JSON.stringify(updatedInput, null, 2);
                    const outputJson = JSON.stringify(updatedOutput, null, 2);

                    // 1. 更新 SQLite command-db 内存表并落盘
                    try {
                        db.run(
                            `UPDATE "command-db" SET "Input" = ?, "Output" = ?, _updated = ? WHERE rowID = ?;`,
                            [inputJson, outputJson, Date.now(), cmdRowId]
                        );
                        const { saveMetaToStorage } = await import("../indexos/command-sqlite");
                        await saveMetaToStorage();
                    } catch (sqlErr) {
                        console.error("[openConfigForCommand] SQLite update error:", sqlErr);
                    }

                    // 2. 兼容模式：若存在物理 AV，同步更新物理表单元格
                    if (commandAvId) {
                        try {
                            const inputColKeyId = await getInputColKeyId(commandAvId);
                            const outputColKeyId = await getOutputColKeyId(commandAvId);
                            if (inputColKeyId) {
                                await updateCellValue(null, commandAvId, cmdRowId, inputColKeyId, inputJson);
                            }
                            if (outputColKeyId && Object.keys(updatedOutput).length > 0) {
                                await updateCellValue(null, commandAvId, cmdRowId, outputColKeyId, outputJson);
                            }
                        } catch (_) {}
                    }

                    const { refreshSupertagRegistry } = await import("../utils/sync-service");
                    await refreshSupertagRegistry();
                    showMessage(`✓ 已保存命令 "${cleanLabel}" 参数配置`);
                }
            }
        });
    } catch (e: any) {
        console.error("Open Config for Command error:", e);
        showMessage(`读取配置失败: ${e.message}`, 3000, "error");
    }
}

