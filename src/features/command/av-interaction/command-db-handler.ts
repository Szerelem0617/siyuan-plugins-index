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
        console.log("%c[IndexOS-AV-Click-Debug] 🎯 Hijacking 'Add Column (av-header-add)' click on command-db -> Opening UI Entry Config Dialog!", "color: #10b981; font-weight: bold;");
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
                if (avId) {
                    await insertCommandIntoAv(avId, cmd);
                }
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
        
        // 1. 查询 Siyuan Live AV 获取当前所有已存在的 Command ID，规避 SQLite 同步延迟
        let existingIds: string[] = [];
        try {
            const avData = await post("/api/av/renderAttributeView", { id: avId, pageSize: 1000 });
            const view = avData.view || avData;
            const rows = view.rows || [];
            const columns = view.columns || [];
            const cmdIdColIdx = columns.findIndex((c: any) => c.name === "Command ID" || c.name === "Command_ID" || c.keyName === "Command ID" || c.keyName === "Command_ID");
            console.log("[IndexOS-Duplicate-Debug] Columns found:", columns.map(c => ({ id: c.id, name: c.name, keyName: c.keyName })), "cmdIdColIdx:", cmdIdColIdx);
            if (cmdIdColIdx !== -1) {
                existingIds = rows.map((r: any) => {
                    const cell = r.cells[cmdIdColIdx];
                    const val = cell?.value?.text?.content || cell?.value?.mText?.content || cell?.value?.block?.content || "";
                    return val;
                }).filter(Boolean);
                console.log("[IndexOS-Duplicate-Debug] Extracted existingIds from live AV:", existingIds);
            }
        } catch (e) {
            console.error("[FooterClick] Live AV query failed:", e);
        }

        const baseId = cmd.id;
        const hasParams = Array.isArray(cmd.params) && cmd.params.length > 0;

        const duplicateExists = existingIds.includes(baseId) || existingIds.some(id => id.startsWith(baseId + "-"));
        console.log("[IndexOS-Duplicate-Debug] baseId:", baseId, "hasParams:", hasParams, "duplicateExists:", duplicateExists);
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

        // 2. 获取 AV 主键列名（key_name）
        const schemaCols = db.exec(`SELECT col_name, key_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let pkColName = "主键";
        if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
            pkColName = String(schemaCols[0].values[0][1] || "主键");
        }

        const hasOutputs = cmd.outputs && Array.isArray(cmd.outputs) && cmd.outputs.length > 0;
        const inputVal = hasParams ? "{}" : "";
        const outputVal = hasOutputs ? "{}" : "";

        // 3. 执行 SQL 插入
        const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const insertSql = `INSERT INTO ${tableName} ("${pkColName}", "Command ID", "Input", "Output") VALUES ('${finalName}', '${finalId}', '${inputVal}', '${outputVal}')`;
        
        console.log("[av-interaction] Running hijacked INSERT sql:", insertSql);
        await executeWritableSql(insertSql);
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

    const commandAvId = getCommandAvId();
    if (!commandAvId) {
        showMessage("未能加载命令管理 (Command-DB) 数据库", 3000, "error");
        return;
    }

    try {
        const { db } = await getSqliteEngine();
        
        // 1. 获取 Command-DB 的主键列名
        const schemaCols = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [commandAvId]);
        let labelCol = "label";
        if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
            labelCol = String(schemaCols[0].values[0][0]);
        }

        // 2. 匹配对应的 Command-DB 行
        const tableName = `av_${commandAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const rowRes = db.exec(`SELECT rowID, _itemID, "${labelCol}" FROM ${tableName}`);
        let cmdRowItemId = "";
        let cmdBoundBlockId = "";
        
        if (rowRes.length > 0 && rowRes[0].values.length > 0) {
            const match = rowRes[0].values.find((r: any) => {
                const val = String(r[2] || "").trim();
                return val === cleanLabel || cleanLabel.includes(val) || val.includes(cleanLabel);
            });
            if (match) {
                cmdBoundBlockId = String(match[0]);
                cmdRowItemId = String(match[1]);
            }
        }

        if (!cmdRowItemId) {
            showMessage(`未在命令管理 (Command-DB) 中找到名称为 "${cleanLabel}" 的行，请先创建`, 3000, "info");
            return;
        }

        // 3. 获取 Input/Output Mapping 列的 Siyuan key ID
        const inputColKeyId = await getInputColKeyId(commandAvId);
        const outputColKeyId = await getOutputColKeyId(commandAvId);

        if (!inputColKeyId) {
            showMessage("未能在命令管理中找到 'Input Mapping' 列", 3000, "error");
            return;
        }

        // 4. 读取当前参数映射值
        const schemaInputCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Input Mapping' OR key_name = 'Param Mapping')`, [commandAvId]);
        let inputColName = "Input_Mapping";
        if (schemaInputCol.length > 0 && schemaInputCol[0].values.length > 0) {
            inputColName = String(schemaInputCol[0].values[0][0]);
        }

        const schemaOutputCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name = 'Output Mapping'`, [commandAvId]);
        let outputColName = "Output_Mapping";
        if (schemaOutputCol.length > 0 && schemaOutputCol[0].values.length > 0) {
            outputColName = String(schemaOutputCol[0].values[0][0]);
        }

        const inputValRes = db.exec(`SELECT "${inputColName}" FROM ${tableName} WHERE rowID = ?`, [cmdBoundBlockId]);
        let currentInputStr = "{}";
        if (inputValRes.length > 0 && inputValRes[0].values.length > 0 && inputValRes[0].values[0][0]) {
            currentInputStr = String(inputValRes[0].values[0][0]);
        }
        let currentInputParams = {};
        try { currentInputParams = JSON.parse(currentInputStr); } catch (_) {}

        const outputValRes = db.exec(`SELECT "${outputColName}" FROM ${tableName} WHERE rowID = ?`, [cmdBoundBlockId]);
        let currentOutputStr = "{}";
        if (outputValRes.length > 0 && outputValRes[0].values.length > 0 && outputValRes[0].values[0][0]) {
            currentOutputStr = String(outputValRes[0].values[0][0]);
        }
        let currentOutputMapping = {};
        try { currentOutputMapping = JSON.parse(currentOutputStr); } catch (_) {}

        // 5. 唤起配置弹窗
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
                    if (inputColKeyId) {
                        await updateCellValue(null, commandAvId, cmdRowItemId, inputColKeyId, JSON.stringify(updatedInput, null, 2));
                    }
                    if (outputColKeyId && Object.keys(updatedOutput).length > 0) {
                        await updateCellValue(null, commandAvId, cmdRowItemId, outputColKeyId, JSON.stringify(updatedOutput, null, 2));
                    }
                }
            }
        });
    } catch (e: any) {
        console.error("Open Config for Command error:", e);
        showMessage(`读取配置失败: ${e.message}`, 3000, "error");
    }
}

