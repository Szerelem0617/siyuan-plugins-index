import { Dialog, showMessage } from "siyuan";
import { getCommandAvId, getTypeAvId, COMMAND_BINDINGS } from "../registration";
import { encodeBtnHref } from "../global-registration/inline-button";
import { commandRegistry } from "../registry/command-registry";
import { updateCellValue } from "../../av/attribute-view/special/special-handlers";
import { getSqliteEngine, executeWritableSql } from "../../sqlite/sqlite-manager";
import { post } from "../../../shared/api-client/request";
import { getInputColKeyId, getOutputColKeyId } from "./query-helper";
import RegistryCommandSelectorDialog from "./dialogs/RegistryCommandSelectorDialog.svelte";
import { readPipelineRow, openPipelineEditorForRow, openPipelineEditor } from "../pipeline/manager";
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
        title: "⚡ 后台执行控制中心",
        content: `<div class="b3-dialog__content" id="global-bg-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
        width: "720px",
        height: "560px"
    });
    dialog.element.classList.add("indexos-dialog");

    new GlobalBackgroundEngineDialog({
        target: dialog.element.querySelector("#global-bg-config-container")!,
        props: { dialog }
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

    // 拦截 Supertag-DB 上的 Alt + Click 快捷导入预设 Supertag 按钮
    if (avId === typeAvId) {
        const addRowBtn = target.closest('[data-type="av-add-bottom"]') || 
                          target.closest('.av__row--util .b3-button') || 
                          (target.classList.contains("b3-button") && txt.includes("添加条目"));
        if (addRowBtn && event.altKey) {
            console.log("%c[IndexOS-AV-Click-Debug] 🎯 Intercepted Alt+Click on Supertag-DB add row -> Opening Preset Import Dialog!", "color: #10b981; font-weight: bold;");
            event.preventDefault();
            event.stopPropagation();
            const { openPresetSupertagImportDialog } = await import("./type-db-handler");
            openPresetSupertagImportDialog();
            return;
        }
    }

    if (avId !== commandAvId) return;

    // 1. 匹配“添加字段”按钮 (精准限定为按钮本身，防止滚动条误触)
    const addColBtn = target.closest('[data-type="av-header-add"]') || 
                      target.closest('[data-type="av-add-column"]') || 
                      target.closest('.av__col-add') || 
                      target.closest('.av__header-add');
    if (addColBtn || (target.classList.contains("b3-button") && (txt.includes("添加列") || txt.includes("添加字段")))) {
        console.log("%c[IndexOS-AV-Click-Debug] 🎯 Hijacking 'Add Column (av-header-add)' click on command-db -> Opening Global Automation Dialog!", "color: #10b981; font-weight: bold;");
        event.preventDefault();
        event.stopPropagation();
        openGlobalAutomationDialog();
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
            openPipelineEditor();
            return;
        }

        // 普通命令视图 ➔ 调起内置命令选择器
        await triggerRegistryCommandSelectorForInsert(avId);
        return;
    }
}

async function triggerRegistryCommandSelectorForInsert(avId: string) {
    let commands: any[] = [];
    try {
        // 先从内存注册表中获取全量已注册命令（包括动态注册的第三方插件命令）
        const memoryCommands = commandRegistry.getAllCommands().map(c => ({
            id: c.id,
            name: c.name,
            description: c.description || "",
            params: c.params || []
        }));

        const existingIds = new Set(memoryCommands.map(c => c.id));

        // 再补充 SQLite 中可能存在的记录
        const { db } = await getSqliteEngine();
        const qRes = db.exec(`SELECT id, name, description, params FROM sys_registry_db`);
        if (qRes.length > 0 && qRes[0].values.length > 0) {
            for (const row of qRes[0].values) {
                const id = String(row[0] || "");
                if (id && !existingIds.has(id)) {
                    memoryCommands.push({
                        id,
                        name: String(row[1] || ""),
                        description: String(row[2] || ""),
                        params: JSON.parse(String(row[3] || "[]"))
                    });
                }
            }
        }
        commands = memoryCommands;
        console.log(`[SelectorDialog] Total available commands: ${commands.length}`, commands.map(c => c.id));
    } catch (e) {
        console.error("[FooterClick] Failed to query registry commands:", e);
        commands = commandRegistry.getAllCommands().map(c => ({
            id: c.id,
            name: c.name,
            description: c.description || "",
            params: c.params || []
        }));
        console.log(`[SelectorDialog] Fallback commands count: ${commands.length}`, commands.map(c => c.id));
    }

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

        new RegistryCommandSelectorDialog({
            target: document.getElementById("registry-command-selector-dialog")!,
            props: {
                dialog,
                commands,
                onSelect: async (cmd: any) => {
                    dialog.destroy();
                    await insertCommandIntoAv(avId, cmd);
                },
                onPipelineCreated: () => {
                    // 复合命令行已由 createPipelineRow 创建并注册，直接关闭选择器
                    dialog.destroy();
                }
            }
        });
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

export async function handleCommandDbAltClick(
    event: MouseEvent,
    avId: string,
    rowId: string,
    colId: string,
    _rowEl: HTMLElement,
    avContainer: HTMLElement,
    isPrimaryKeyCell: boolean
) {
    let cleanLabel = "";
    let targetCommand = "";

    try {
        const { db } = await getSqliteEngine();
        const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        
        // 查找主键列（Label）
        const schemaCols = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let labelCol = "label";
        if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
            labelCol = String(schemaCols[0].values[0][0]);
        }
        
        // 查找 Command ID 列
        const schemaCmdIdCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Command ID' OR key_name = '命令ID')`, [avId]);
        let cmdIdCol = "Command_ID";
        if (schemaCmdIdCol.length > 0 && schemaCmdIdCol[0].values.length > 0) {
            cmdIdCol = String(schemaCmdIdCol[0].values[0][0]);
        }
        
        // 精确查询当前点击行的 label 和 Command ID
        const rowQuery = db.exec(`SELECT "${labelCol}", "${cmdIdCol}" FROM ${tableName} WHERE _itemID = ?`, [rowId]);
        if (rowQuery.length > 0 && rowQuery[0].values.length > 0) {
            cleanLabel = String(rowQuery[0].values[0][0] || "").trim();
            targetCommand = String(rowQuery[0].values[0][1] || "").trim();
        }
    } catch (e) {
        console.error("[AltClick] SQLite query failed, falling back to DOM scraping:", e);
    }

    // Fallback: 精准的 DOM 匹配
    if (!cleanLabel) {
        const pkHeader = avContainer.querySelector('.av__row--header .av__cell[data-dtype="block"]');
        const pkColId = pkHeader?.getAttribute("data-col-id");
        const labelCell = pkColId ? avContainer.querySelector(`.av__row[data-id="${rowId}"] .av__cell[data-col-id="${pkColId}"]`) : null;
        const rawLabel = (labelCell?.textContent || "").trim();
        cleanLabel = rawLabel.replace(/[\u200B-\uFEFF]/g, '');
    }

    if (!cleanLabel) return;

    // 查找对应的 Command 定义
    let cmdInfo = COMMAND_BINDINGS[cleanLabel];
    if (!cmdInfo) {
        const foundKey = Object.keys(COMMAND_BINDINGS).find(k => 
            cleanLabel.includes(k) || k.includes(cleanLabel)
        );
        if (foundKey) {
            cmdInfo = COMMAND_BINDINGS[foundKey];
        }
    }
    const resolvedCommand = cmdInfo?.commandRef || targetCommand || cleanLabel;

    if (isPrimaryKeyCell) {
        // --- 行为 1: 复制命令按钮链接 ---
        event.preventDefault();
        event.stopPropagation();

        if (!resolvedCommand) {
            showMessage("未找到有效的命令 ID", 2000, "error");
            return;
        }

        const href = encodeBtnHref({ command: resolvedCommand });
        navigator.clipboard.writeText(href).then(() => {
            showMessage(`已复制命令按钮链接: ${resolvedCommand}`, 2000);
        }).catch(err => {
            console.error("[ButtonLink] Failed to copy:", err);
            showMessage("复制链接失败", 2000, "error");
        });
    } else {
        // 解析点击列名，用于区分 Pipeline 定义 / Input / Output 的 Alt+Click 行为
        let clickedKeyName = "";
        try {
            const { db } = await getSqliteEngine();
            const colQuery = db.exec(`SELECT key_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
            if (colQuery.length > 0 && colQuery[0].values.length > 0) {
                clickedKeyName = String(colQuery[0].values[0][0]);
            }
        } catch (e) {
            console.error("[AltClick] Failed to resolve column schema details:", e);
        }

        // 优先检查当前行是否为复合命令 (Composite Command) 行
        const pipelineRow = await readPipelineRow(rowId);
        const isPipeline = Boolean(pipelineRow && pipelineRow.script) || (resolvedCommand && (resolvedCommand.startsWith("composite.") || resolvedCommand.startsWith("pipeline.")));

        if (isPipeline || clickedKeyName === "Composite") {
            // --- 行为 0: Composite 行根据 Alt+Click 的列智能打开对应 Tab ---
            event.preventDefault();
            event.stopPropagation();

            const isOutputClick = clickedKeyName === "Output";
            const isInputClick = clickedKeyName === "Input";
            const initialTab: "steps" | "input" | "output" = isOutputClick ? "output" : isInputClick ? "input" : "steps";

            if (!pipelineRow || !pipelineRow.script) {
                // 如果是新行但点击了 Pipeline 定义列，打开新建编辑器
                openPipelineEditor(initialTab);
                return;
            }
            openPipelineEditorForRow(rowId, pipelineRow.script, initialTab);
            return;
        }

        if (clickedKeyName === "Input" || clickedKeyName === "Input Mapping" || clickedKeyName === "入参映射" || clickedKeyName === "Output" || clickedKeyName === "Output Mapping" || clickedKeyName === "出参映射" || clickedKeyName === "Param Mapping" || clickedKeyName === "参数映射") {
            // --- 行为 2: 普通命令弹窗可视化配置参数与出参（双 Tab 联动一体化） ---
            event.preventDefault();
            event.stopPropagation();

            const cmdDef = commandRegistry.findByNameOrId(cleanLabel) || commandRegistry.getCommand(resolvedCommand);
            if (!cmdDef) {
                showMessage("此命令尚未在系统注册，无法配置参数");
                return;
            }

            const isOutputClick = clickedKeyName === "Output" || clickedKeyName === "Output Mapping" || clickedKeyName === "出参映射";
            const initialTab = isOutputClick ? "output" : "input";

            const paramsSchema = cmdDef.params || [];
            const outputsSchema = (cmdDef && cmdDef.outputs && Array.isArray(cmdDef.outputs)) ? cmdDef.outputs : [];

            const inputColKeyId = await getInputColKeyId(avId);
            const outputColKeyId = await getOutputColKeyId(avId);

            // 获取当前单元格的参数 JSON 字符串
            let currentInputStr = "{}";
            let currentOutputStr = "{}";
            try {
                const { db } = await getSqliteEngine();
                const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
                
                const inputColQuery = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Input' OR key_name = 'Input Mapping' OR key_name = '入参映射' OR key_name = 'Param Mapping')`, [avId]);
                const inputColName = inputColQuery.length > 0 && inputColQuery[0].values.length > 0 ? String(inputColQuery[0].values[0][0]) : "";

                const outputColQuery = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Output' OR key_name = 'Output Mapping' OR key_name = '出参映射')`, [avId]);
                const outputColName = outputColQuery.length > 0 && outputColQuery[0].values.length > 0 ? String(outputColQuery[0].values[0][0]) : "";

                if (inputColName) {
                    const inputValRes = db.exec(`SELECT "${inputColName}" FROM ${tableName} WHERE _itemID = ?`, [rowId]);
                    if (inputValRes.length > 0 && inputValRes[0].values.length > 0 && inputValRes[0].values[0][0]) {
                        currentInputStr = String(inputValRes[0].values[0][0]);
                    }
                }
                if (outputColName) {
                    const outputValRes = db.exec(`SELECT "${outputColName}" FROM ${tableName} WHERE _itemID = ?`, [rowId]);
                    if (outputValRes.length > 0 && outputValRes[0].values.length > 0 && outputValRes[0].values[0][0]) {
                        currentOutputStr = String(outputValRes[0].values[0][0]);
                    }
                }
            } catch (e) {
                console.error("[ParamConfig] Query columns error:", e);
            }

            let currentInputParams = {};
            let currentOutputMapping = {};
            try { currentInputParams = JSON.parse(currentInputStr); } catch (_) {}
            try { currentOutputMapping = JSON.parse(currentOutputStr); } catch (_) {}

            console.log(`[UnifiedConfig] Dialog opened. initialTab: "${initialTab}", paramsSchema:`, paramsSchema, "outputsSchema:", outputsSchema);
            const dialog = new Dialog({
                title: "配置命令参数 & 出参",
                content: `<div class="b3-dialog__content" id="param-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
                width: "560px",
                height: "540px"
            });
            dialog.element.classList.add("indexos-dialog");

            const { default: UnifiedCommandConfigDialog } = await import("./dialogs/UnifiedCommandConfigDialog.svelte");

            new UnifiedCommandConfigDialog({
                target: dialog.element.querySelector("#param-config-container")!,
                props: {
                    dialog,
                    commandName: cmdDef.name || cleanLabel,
                    commandId: resolvedCommand,
                    initialTab,
                    paramsSchema,
                    outputsSchema,
                    currentInputParams,
                    currentOutputMapping,
                    onSave: async (updatedInput: Record<string, any>, updatedOutput: Record<string, string>) => {
                        const hasParams = paramsSchema && paramsSchema.length > 0;
                        const inputJson = hasParams ? (Object.keys(updatedInput).length > 0 ? JSON.stringify(updatedInput, null, 2) : "{}") : "";
                        if (inputColKeyId) {
                            await updateCellValue(null, avId, rowId, inputColKeyId, inputJson);
                        }

                        const hasOutputs = outputsSchema && outputsSchema.length > 0;
                        const outputJson = hasOutputs ? (Object.keys(updatedOutput).length > 0 ? JSON.stringify(updatedOutput, null, 2) : "{}") : "";
                        if (outputColKeyId) {
                            await updateCellValue(null, avId, rowId, outputColKeyId, outputJson);
                        }
                    }
                }
            });
            return;
        }
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
        console.log("[UnifiedConfig] Dialog opened via openConfigForCommand. paramsSchema:", paramsSchema);
        const dialog = new Dialog({
            title: "配置命令参数 & 出参",
            content: `<div class="b3-dialog__content" id="param-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
            width: "560px",
            height: "540px"
        });
        dialog.element.classList.add("indexos-dialog");

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

// ─────────────────────────────────────────────────────────────────────────────
// Hover Tooltip System for Command-DB Metadata
// ─────────────────────────────────────────────────────────────────────────────

interface AVHoverContext {
    cell: HTMLElement;
    row: HTMLElement;
    avContainer: HTMLElement;
    avId: string;
    rowId: string;
    colId: string;
    isPrimaryKeyCell: boolean;
}

function parseAVHoverEvent(event: MouseEvent): AVHoverContext | null {
    const target = event.target as HTMLElement;
    const cell = target.closest(".av__cell") as HTMLElement;
    if (!cell) return null;

    const row = (cell.closest(".av__row") || cell.closest(".av__gallery-item") || cell.closest(".av__kanban-item")) as HTMLElement;
    const avContainer = cell.closest(".av") as HTMLElement;
    if (!avContainer || !row) return null;

    const avId = avContainer.getAttribute("data-av-id") || "";
    const rowId = row.getAttribute("data-id") || "";
    const colId = cell.getAttribute("data-col-id") || cell.getAttribute("data-field-id") || "";
    const isHeader = !!cell.closest(".av__row--header") || cell.classList.contains("av__cell--header");
    if (isHeader) return null;

    const pkHeader = avContainer.querySelector('.av__row--header .av__cell[data-dtype="block"]');
    const pkColId = pkHeader?.getAttribute("data-col-id");
    const isPrimaryKeyCell = pkColId ? (colId === pkColId) : false;

    return {
        cell,
        row,
        avContainer,
        avId,
        rowId,
        colId,
        isPrimaryKeyCell
    };
}

let activeHoverCell: HTMLElement | null = null;
let hoverTooltipEl: HTMLElement | null = null;

async function handleAvMouseOver(event: MouseEvent) {
    const hoverCtx = parseAVHoverEvent(event);
    if (!hoverCtx) {
        hideTooltip();
        return;
    }

    const { cell, avId, rowId, isPrimaryKeyCell } = hoverCtx;
    const commandAvId = getCommandAvId();

    if (avId !== commandAvId || !isPrimaryKeyCell) {
        hideTooltip();
        return;
    }

    if (activeHoverCell === cell) {
        return;
    }

    activeHoverCell = cell;
    cell.addEventListener("mouseleave", hideTooltip, { once: true });

    try {
        const { db } = await getSqliteEngine();
        const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        
        const schemaCmdIdCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Command ID' OR key_name = '命令ID')`, [avId]);
        let cmdIdCol = "Command_ID";
        if (schemaCmdIdCol.length > 0 && schemaCmdIdCol[0].values.length > 0) {
            cmdIdCol = String(schemaCmdIdCol[0].values[0][0]);
        }

        const rowQuery = db.exec(`SELECT "${cmdIdCol}" FROM ${tableName} WHERE _itemID = ?`, [rowId]);
        if (rowQuery.length === 0 || rowQuery[0].values.length === 0) {
            hideTooltip();
            return;
        }

        const commandId = String(rowQuery[0].values[0][0] || "").trim();
        if (!commandId) {
            hideTooltip();
            return;
        }

        // 智能匹配：先按 ID 查找，找不到按中文名或模糊匹配查找
        const cmdDef = commandRegistry.findByNameOrId(commandId);
        if (!cmdDef) {
            showTooltip(cell, `
                <div style="font-family: monospace; font-size: 11px; font-weight: bold; color: var(--b3-theme-error); margin-bottom: 2px;">${commandId}</div>
                <div style="color: var(--b3-theme-on-surface-mute); font-size: 10px;">未找到对应命令 ID 或中文定义</div>
            `);
            return;
        }

        const requiresParams = cmdDef.params && cmdDef.params.length > 0;
        const env = cmdDef.constraints?.environment || "universal";
        const scope = cmdDef.constraints?.targetScope || "any";

        const envMap: Record<string, string> = {
            "ui": "前端 (UI)",
            "universal": "通用双端 (Universal)"
        };

        const scopeMap: Record<string, string> = {
            "none": "全局独立 (None)",
            "block": "块专用 (Block)",
            "doc": "页面专用 (Doc)",
            "any": "通用多态 (Any)"
        };

        const envText = envMap[env] || env;
        const scopeText = scopeMap[scope] || scope;

        const content = `
            <div style="font-weight: 600; font-size: 12px; color: var(--b3-theme-primary); margin-bottom: 2px;">${cmdDef.name}</div>
            <div style="font-family: monospace; font-size: 10px; color: var(--b3-theme-on-surface-mute); word-break: break-all; margin-bottom: 6px;">${cmdDef.id}</div>
            <div style="font-size: 11px; margin-bottom: 6px; line-height: 1.4; color: var(--b3-theme-on-background); border-top: 1px solid var(--b3-border-color); padding-top: 6px;">
                ${cmdDef.description || "无描述"}
            </div>
            <div style="font-size: 10px; display: flex; gap: 8px; color: var(--b3-theme-on-surface-mute); border-top: 1px dashed var(--b3-border-color); padding-top: 4px; flex-wrap: wrap;">
                <span>环境: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${envText}</code></span>
                <span>作用域: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${scopeText}</code></span>
                <span>参数: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${requiresParams ? "是" : "否"}</code></span>
            </div>
        `;
        showTooltip(cell, content);
    } catch (err) {
        console.error("[HoverTooltip] Error:", err);
    }
}

function showTooltip(cell: HTMLElement, htmlContent: string) {
    if (!hoverTooltipEl) {
        hoverTooltipEl = document.createElement("div");
        hoverTooltipEl.style.position = "absolute";
        hoverTooltipEl.style.zIndex = "99999";
        hoverTooltipEl.style.pointerEvents = "none";
        hoverTooltipEl.style.padding = "8px 12px";
        hoverTooltipEl.style.borderRadius = "4px";
        hoverTooltipEl.style.backgroundColor = "var(--b3-theme-background)";
        hoverTooltipEl.style.color = "var(--b3-theme-on-background)";
        hoverTooltipEl.style.border = "1px solid var(--b3-border-color)";
        hoverTooltipEl.style.boxShadow = "var(--b3-dialog-shadow)";
        hoverTooltipEl.style.fontSize = "11px";
        hoverTooltipEl.style.maxWidth = "280px";
        document.body.appendChild(hoverTooltipEl);
    }

    hoverTooltipEl.innerHTML = htmlContent;
    
    const rect = cell.getBoundingClientRect();
    hoverTooltipEl.style.left = `${rect.left + window.scrollX}px`;
    hoverTooltipEl.style.top = `${rect.bottom + window.scrollY + 6}px`;
    hoverTooltipEl.style.display = "block";
}

function hideTooltip() {
    activeHoverCell = null;
    if (hoverTooltipEl) {
        hoverTooltipEl.style.display = "none";
    }
}

import { initAvHeaderIndicators, destroyAvHeaderIndicators } from "../../av/hint";

export function initHoverTooltipListener() {
    window.addEventListener("mouseover", handleAvMouseOver, true);
    initAvHeaderIndicators();
}

export function destroyHoverTooltipListener() {
    window.removeEventListener("mouseover", handleAvMouseOver, true);
    hideTooltip();
    if (hoverTooltipEl) {
        hoverTooltipEl.remove();
        hoverTooltipEl = null;
    }
    destroyAvHeaderIndicators();
}
