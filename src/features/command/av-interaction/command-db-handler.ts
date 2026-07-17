import { Dialog, showMessage } from "siyuan";
import { getCommandAvId, COMMAND_REGISTRY } from "../registration";
import { encodeBtnHref } from "../global-registration/inline-button";
import { commandRegistry } from "../registry/command-registry";
import { updateCellValue } from "../../data/attribute-view/special/special-handlers";
import { getSqliteEngine, executeWritableSql } from "../../sqlite/sqlite-manager";
import { post } from "../../../shared/api-client/request";
import { getParamColKeyId } from "./query-helper";
import RegistryCommandSelectorDialog from "./dialogs/RegistryCommandSelectorDialog.svelte";
import UIEntriesSelectorDialog from "./dialogs/UIEntriesSelectorDialog.svelte";
import ParamConfigDialog from "./dialogs/ParamConfigDialog.svelte";

export async function handleAvFooterClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    
    // Add debug logging
    const isAvElement = target.closest(".av") || target.closest(".av__container") || target.closest("[data-av-id]");
    if (isAvElement) {
        console.log("[IndexOS-AV-Click] Click inside AV detected. Target:", target, "tagName:", target.tagName, "className:", target.className);
    }

    const addBtn = target.closest('[data-type="av-add-bottom"]') || target.closest(".av__row--util");
    if (!addBtn) {
        // Double check if text content matches "添加条目"
        const txt = target.textContent?.trim() || "";
        if (txt === "添加条目" || txt.includes("添加条目") || txt === "+ 添加条目") {
            console.log("[IndexOS-AV-Click] Click matched by text content '添加条目'. Target:", target);
        } else {
            return;
        }
    } else {
        console.log("[IndexOS-AV-Click] Click matched by closest av-add-bottom or av__row--util. Target:", target);
    }

    const avContainer = target.closest("[data-av-id]") || target.closest('[data-type="NodeAttributeView"]') || target.closest(".av__container") || target.closest(".av");
    if (!avContainer) {
        console.warn("[IndexOS-AV-Click] Could not resolve avContainer for target.");
        return;
    }

    const avId = avContainer.getAttribute("data-av-id") || "";
    const commandAvId = getCommandAvId();
    console.log("[IndexOS-AV-Click] Click resolved avId:", avId, "commandAvId:", commandAvId);

    if (avId !== commandAvId) return;

    // 拦截 command-db 的添加条目点击，防止默认生成空行
    console.log("[IndexOS-AV-Click] Hijacking add item click on command-db!");
    event.preventDefault();
    event.stopPropagation();

    await triggerRegistryCommandSelectorForInsert(avContainer, avId);
}

async function triggerRegistryCommandSelectorForInsert(avContainer: Element, avId: string) {
    let commands: any[] = [];
    try {
        const { db } = await getSqliteEngine();
        const qRes = db.exec(`SELECT id, name, description, params FROM sys_registry_db`);
        if (qRes.length > 0 && qRes[0].values.length > 0) {
            commands = qRes[0].values.map(row => ({
                id: String(row[0] || ""),
                name: String(row[1] || ""),
                description: String(row[2] || ""),
                params: JSON.parse(String(row[3] || "[]"))
            }));
        }
    } catch (e) {
        console.error("[FooterClick] Failed to query registry commands:", e);
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

    new RegistryCommandSelectorDialog({
        target: document.getElementById("registry-command-selector-dialog")!,
        props: {
            dialog,
            commands,
            onSelect: async (cmd: any) => {
                dialog.destroy();
                await insertCommandIntoAv(avId, cmd);
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
            console.error("[FooterClick] Live AV query failed, falling back to SQLite:", e);
            try {
                const existRes = db.exec(`SELECT Command_ID FROM sys_command_db`);
                if (existRes.length > 0 && existRes[0].values.length > 0) {
                    existingIds = existRes[0].values.map(row => String(row[0] || ""));
                }
                console.log("[IndexOS-Duplicate-Debug] Fallback SQLite existingIds:", existingIds);
            } catch (_) {}
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

        // 3. 执行 SQL 插入
        const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const insertSql = `INSERT INTO ${tableName} ("${pkColName}", "Command ID", "UI 入口") VALUES ('${finalName}', '${finalId}', '快捷命令')`;
        
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
    rowEl: HTMLElement,
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
    let cmdInfo = COMMAND_REGISTRY[cleanLabel];
    if (!cmdInfo) {
        const foundKey = Object.keys(COMMAND_REGISTRY).find(k => 
            cleanLabel.includes(k) || k.includes(cleanLabel)
        );
        if (foundKey) {
            cmdInfo = COMMAND_REGISTRY[foundKey];
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
        // Check if they clicked the UI entries / UI 入口 column
        let clickedKeyName = "";
        let clickedColName = "";
        try {
            const { db } = await getSqliteEngine();
            const colQuery = db.exec(`SELECT key_name, col_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
            if (colQuery.length > 0 && colQuery[0].values.length > 0) {
                clickedKeyName = String(colQuery[0].values[0][0]);
                clickedColName = String(colQuery[0].values[0][1]);
            }
        } catch (e) {
            console.error("[AltClick] Failed to resolve column schema details:", e);
        }

        if (clickedKeyName === "UI 入口" || clickedKeyName === "UI Entries" || clickedKeyName === "注册位置") {
            event.preventDefault();
            event.stopPropagation();

            let currentUiEntriesVal = "";
            try {
                const { db } = await getSqliteEngine();
                const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
                const valRes = db.exec(`SELECT "${clickedColName}" FROM ${tableName} WHERE _itemID = ?`, [rowId]);
                if (valRes.length > 0 && valRes[0].values.length > 0 && valRes[0].values[0][0]) {
                    currentUiEntriesVal = String(valRes[0].values[0][0]);
                }
            } catch (e) {
                const uiCell = rowEl.querySelector(`.av__cell[data-col-id="${colId}"]`) as HTMLElement;
                currentUiEntriesVal = uiCell?.textContent?.trim() || "";
            }

            console.log("[UIEntriesConfig] Dialog opened. currentValue:", currentUiEntriesVal);
            const dialog = new Dialog({
                title: `配置注册位置`,
                content: `<div id="ui-entries-config-dialog" style="height: 100%;"></div>`,
                width: "360px",
                height: "300px"
            });

            new UIEntriesSelectorDialog({
                target: document.getElementById("ui-entries-config-dialog")!,
                props: {
                    dialog,
                    commandName: cleanLabel,
                    currentValue: currentUiEntriesVal,
                    onSave: async (updatedValue: string) => {
                        console.log("[UIEntriesConfig] Saving new entries:", updatedValue);
                        await updateCellValue(null, avId, rowId, colId, updatedValue);
                        showMessage("✓ 注册位置更新成功，已刷新后台注册。");
                    }
                }
            });
            return;
        }

        if (clickedKeyName === "Param Mapping" || clickedKeyName === "参数映射") {
            // --- 行为 2: 弹窗可视化配置参数 ---
            event.preventDefault();
            event.stopPropagation();

            const cmdDef = commandRegistry.findByNameOrId(cleanLabel) || commandRegistry.getCommand(resolvedCommand);
            if (!cmdDef) {
                showMessage("此命令尚未在系统注册，无法配置参数");
                return;
            }

            const paramsSchema = cmdDef.params || [];

            if (paramsSchema.length === 0) {
                showMessage(`命令 "${cmdDef.name || cleanLabel}" 不支持参数配置`);
                return;
            }

            const paramColKeyId = await getParamColKeyId(avId);
            if (!paramColKeyId) {
                showMessage("未能在表中找到 'Param Mapping' 参数映射列", 3000, "error");
                return;
            }

            // 获取当前单元格的参数 JSON 字符串
            let currentValStr = "{}";
            try {
                const { db } = await getSqliteEngine();
                const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
                const valRes = db.exec(`SELECT "${clickedColName}" FROM ${tableName} WHERE _itemID = ?`, [rowId]);
                if (valRes.length > 0 && valRes[0].values.length > 0 && valRes[0].values[0][0]) {
                    currentValStr = String(valRes[0].values[0][0]);
                }
            } catch (e) {
                const paramCell = rowEl.querySelector(`.av__cell[data-col-id="${paramColKeyId}"]`) as HTMLElement;
                currentValStr = paramCell?.textContent?.trim() || "{}";
            }

            let currentParams = {};
            try {
                currentParams = JSON.parse(currentValStr);
            } catch (_) {
                currentParams = {};
            }

            console.log("[ParamConfig] Dialog opened. paramsSchema:", paramsSchema);
            const dialog = new Dialog({
                title: "配置命令参数",
                content: `<div class="b3-dialog__content" id="param-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
                width: "480px",
                height: "500px"
            });

            new ParamConfigDialog({
                target: dialog.element.querySelector("#param-config-container")!,
                props: {
                    dialog,
                    commandName: cmdDef.name || cleanLabel,
                    commandId: resolvedCommand,
                    paramsSchema,
                    currentParams,
                    onSave: async (updated: Record<string, any>) => {
                        await updateCellValue(null, avId, rowId, paramColKeyId, JSON.stringify(updated, null, 2));
                    }
                }
            });
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
            showMessage(`未在命令管理 (Command-DB) 中找到名称为 "${cleanLabel}" 的行，请先创建`, 3000, "warning");
            return;
        }

        // 3. 获取 Param Mapping 的 Siyuan key ID
        const paramColKeyId = await getParamColKeyId(commandAvId);
        if (!paramColKeyId) {
            showMessage("未能在命令管理中找到 'Param Mapping' 列", 3000, "error");
            return;
        }

        // 4. 读取当前参数映射值
        const schemaParamCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name = 'Param Mapping'`, [commandAvId]);
        let paramColName = "Param_Mapping";
        if (schemaParamCol.length > 0 && schemaParamCol[0].values.length > 0) {
            paramColName = String(schemaParamCol[0].values[0][0]);
        }

        const valRes = db.exec(`SELECT "${paramColName}" FROM ${tableName} WHERE rowID = ?`, [cmdBoundBlockId]);
        let currentValStr = "{}";
        if (valRes.length > 0 && valRes[0].values.length > 0 && valRes[0].values[0][0]) {
            currentValStr = String(valRes[0].values[0][0]);
        }
        let currentParams = {};
        try {
            currentParams = JSON.parse(currentValStr);
        } catch (_) {
            currentParams = {};
        }

        // 5. 唤起配置弹窗
        console.log("[ParamConfig] Dialog opened via openConfigForCommand. paramsSchema:", paramsSchema);
        const dialog = new Dialog({
            title: "配置命令参数",
            content: `<div class="b3-dialog__content" id="param-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
            width: "480px",
            height: "500px"
        });

        new ParamConfigDialog({
            target: dialog.element.querySelector("#param-config-container")!,
            props: {
                dialog,
                commandName: cmdDef.name || cleanLabel,
                commandId: cmdDef.id,
                paramsSchema,
                currentParams,
                onSave: async (updated: Record<string, any>) => {
                    await updateCellValue(null, commandAvId, cmdRowItemId, paramColKeyId, JSON.stringify(updated, null, 2));
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

        const cmdDef = commandRegistry.getCommand(commandId);
        if (!cmdDef) {
            showTooltip(cell, `
                <div style="font-family: monospace; font-size: 11px; font-weight: bold; color: var(--b3-theme-error); margin-bottom: 2px;">${commandId}</div>
                <div style="color: var(--b3-theme-on-surface-mute); font-size: 10px;">未注册的命令 ID</div>
            `);
            return;
        }

        const requiresParams = cmdDef.params && cmdDef.params.length > 0;
        const scopeLabel = cmdDef.meta?.scope ? (cmdDef.meta.scope.charAt(0).toUpperCase() + cmdDef.meta.scope.slice(1)) : "Global";

        const uiOnly = cmdDef.constraints?.uiOnly ?? false;
        const schedulable = cmdDef.constraints?.schedulable ?? false;

        let envLabel = "双端 (Universal)";
        if (uiOnly) {
            envLabel = "前端 (UI)";
        } else if (schedulable && !uiOnly) {
            envLabel = "后端 (Kernel)";
        }

        // appliesTo 标签映射
        const appliesToRaw = cmdDef.meta?.appliesTo;
        let appliesToHtml = "";
        if (appliesToRaw && appliesToRaw.length > 0 && !appliesToRaw.includes("any")) {
            const labelMap: Record<string, string> = {
                "document": "文档", "paragraph": "段落", "heading": "标题",
                "list": "列表", "blockquote": "引述", "code": "代码块",
                "table": "表格", "super": "超级块", "embed": "嵌入块", "widget": "挂件"
            };
            const tags = appliesToRaw.map(t => labelMap[t] || t).join(", ");
            appliesToHtml = `
                <div style="font-size: 10px; color: var(--b3-theme-on-surface-mute); border-top: 1px dashed var(--b3-border-color); padding-top: 4px; margin-top: 4px;">
                    适用于: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${tags}</code>
                </div>
            `;
        }

        const content = `
            <div style="font-weight: 600; font-size: 12px; color: var(--b3-theme-primary); margin-bottom: 2px;">${cmdDef.name}</div>
            <div style="font-family: monospace; font-size: 10px; color: var(--b3-theme-on-surface-mute); word-break: break-all; margin-bottom: 6px;">${cmdDef.id}</div>
            <div style="font-size: 11px; margin-bottom: 6px; line-height: 1.4; color: var(--b3-theme-on-background); border-top: 1px solid var(--b3-border-color); padding-top: 6px;">
                ${cmdDef.description || "无描述"}
            </div>
            <div style="font-size: 10px; display: flex; gap: 8px; color: var(--b3-theme-on-surface-mute); border-top: 1px dashed var(--b3-border-color); padding-top: 4px; flex-wrap: wrap;">
                <span>范围: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${scopeLabel}</code></span>
                <span>环境: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${envLabel}</code></span>
                <span>参数: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${requiresParams ? "是" : "否"}</code></span>
            </div>
            ${appliesToHtml}
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

export function initHoverTooltipListener() {
    window.addEventListener("mouseover", handleAvMouseOver, true);
}

export function destroyHoverTooltipListener() {
    window.removeEventListener("mouseover", handleAvMouseOver, true);
    hideTooltip();
    if (hoverTooltipEl) {
        hoverTooltipEl.remove();
        hoverTooltipEl = null;
    }
}
