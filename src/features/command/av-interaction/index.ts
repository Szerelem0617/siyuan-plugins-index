import { Dialog, showMessage } from "siyuan";
import { getCommandAvId, getTypeAvId, COMMAND_REGISTRY } from "../registration";
import { encodeBtnHref } from "../global-registration/inline-button";
import { commandRegistry } from "../registry/command-registry";
import { updateCellValue } from "../../data/attribute-view/special/special-handlers";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import ParamConfigDialog from "./ParamConfigDialog.svelte";
import OnCreateSelectorDialog from "./OnCreateSelectorDialog.svelte";
import { parseAVClickEvent } from "../../../shared/utils";

/**
 * 初始化按钮链接与参数配置快捷监听器
 * 功能：Alt + Click 点击 Command-DB (Layer 2) 或 Type-DB (Layer 3) 单元格进行配置
 */
export function initButtonLinkListener() {
    window.addEventListener("click", handleAvAltClick, true);
}

export function destroyButtonLinkListener() {
    window.removeEventListener("click", handleAvAltClick, true);
}

async function getParamColKeyId(avId: string): Promise<string> {
    try {
        const { db } = await getSqliteEngine();
        const res = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name = 'Param Mapping' OR key_name = '参数映射')`, [avId]);
        if (res.length > 0 && res[0].values.length > 0) {
            return String(res[0].values[0][0]);
        }
        // Fallback: search for any column containing 'Param' or '参数'
        const fallbackRes = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name LIKE '%Param%' OR key_name LIKE '%参数%')`, [avId]);
        if (fallbackRes.length > 0 && fallbackRes[0].values.length > 0) {
            return String(fallbackRes[0].values[0][0]);
        }
    } catch (_) { /* ignore */ }
    return "";
}

async function handleAvAltClick(event: MouseEvent) {
    const clickCtx = parseAVClickEvent(event);
    if (!clickCtx) return;

    const { cell: cellEl, row: rowEl, avContainer, avId, rowId, colId, isHeader, isPrimaryKeyCell } = clickCtx;
    const commandAvId = getCommandAvId();
    const typeAvId = getTypeAvId();
    console.log("[Interaction-Debug] avId:", avId, "commandAvId:", commandAvId, "typeAvId:", typeAvId);

    if (avId !== commandAvId && avId !== typeAvId) {
        console.log("[Interaction-Debug] avId mismatch, returning early");
        return;
    }
    if (isHeader || rowEl.classList.contains("av__row--footer")) return;

    // ─────────────────────────────────────────────────────────────────────────
    // 路由分支一：在 Command-DB (命令主表) 中点击
    // ─────────────────────────────────────────────────────────────────────────
    if (avId === commandAvId) {
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
                const schemaParamCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Param Mapping' OR key_name = '参数映射')`, [avId]);
                let paramColName = "Param_Mapping";
                if (schemaParamCol.length > 0 && schemaParamCol[0].values.length > 0) {
                    paramColName = String(schemaParamCol[0].values[0][0]);
                }
                const valRes = db.exec(`SELECT "${paramColName}" FROM ${tableName} WHERE _itemID = ?`, [rowId]);
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

    // ─────────────────────────────────────────────────────────────────────────
    // 路由分支二：在 Type-DB (类型绑定表) 中点击
    // ─────────────────────────────────────────────────────────────────────────
    else if (avId === typeAvId) {
        event.preventDefault();
        event.stopPropagation();

        const { db } = await getSqliteEngine();

        // Check if the clicked column name in Siyuan matches "On Create" or "创建时"
        let isOnCreateCol = false;
        try {
            const checkColRes = db.exec(`SELECT key_name FROM _av_schema WHERE av_id = ? AND col_name = ?`, [avId, colId]);
            if (checkColRes.length > 0 && checkColRes[0].values.length > 0) {
                const keyName = checkColRes[0].values[0][0];
                if (keyName === "On Create" || keyName === "创建时") {
                    isOnCreateCol = true;
                }
            }
        } catch (e) {
            console.error("[AltClick-TypeDB] Schema check failed:", e);
        }

        if (isOnCreateCol) {
            await openOnCreateSelector(avId, rowId, colId);
            return;
        }

        // 提取所点单元格内的命令名（可以是 Block Icon Menu 的逗号分隔，也可以是关联字段的标签）
        const cellText = cellEl.textContent || "";
        const tags = Array.from(cellEl.querySelectorAll(".av__cell--relation-tag, span")).map(el => el.textContent?.trim()).filter(Boolean);
        const tokens = cellText.split(/[,，\n;；]/).map(s => s.trim()).filter(Boolean);
        const cleanLabels = Array.from(new Set([...tags, ...tokens])).map(s => s.replace(/[\u200B-\uFEFF]/g, "").trim()).filter(Boolean);

        const matchedCmds: { label: string; cmdDef: any }[] = [];
        for (const label of cleanLabels) {
            let cmdInfo = COMMAND_REGISTRY[label];
            if (!cmdInfo) {
                const foundKey = Object.keys(COMMAND_REGISTRY).find(k => label.includes(k) || k.includes(label));
                if (foundKey) cmdInfo = COMMAND_REGISTRY[foundKey];
            }
            const commandRef = cmdInfo?.commandRef || label;
            const cmdDef = commandRegistry.findByNameOrId(label) || commandRegistry.getCommand(commandRef);
            if (cmdDef) {
                matchedCmds.push({ label: cmdDef.name || label, cmdDef });
            }
        }

        if (matchedCmds.length === 0) {
            showMessage("此单元格没有绑定任何可配置的命令");
            return;
        }

        if (matchedCmds.length === 1) {
            await openConfigForCommand(matchedCmds[0].cmdDef, matchedCmds[0].label);
        } else {
            // 多个命令，弹出选择框
            const selectDialog = new Dialog({
                title: "选择要配置的命令",
                content: `<div class="b3-dialog__content" style="padding: 16px; display: flex; flex-direction: column; gap: 8px;" id="command-selector-container"></div>`,
                width: "360px"
            });
            const container = selectDialog.element.querySelector("#command-selector-container")!;
            container.innerHTML = `<div style="margin-bottom: 12px; font-weight: bold; color: var(--b3-theme-on-surface-light); font-size: 13px;">检测到绑定了多个命令，请选择一个进行配置：</div>`;
            
            matchedCmds.forEach(cmd => {
                const btn = document.createElement("button");
                btn.className = "b3-button b3-button--outline fn__block";
                btn.style.textAlign = "left";
                btn.style.padding = "8px 12px";
                btn.style.marginBottom = "4px";
                btn.textContent = `⚡ ${cmd.label}`;
                btn.addEventListener("click", async () => {
                    selectDialog.destroy();
                    await openConfigForCommand(cmd.cmdDef, cmd.label);
                });
                container.appendChild(btn);
            });
        }
    }
}

async function openConfigForCommand(cmdDef: any, cleanLabel: string) {
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

async function openOnCreateSelector(avId: string, rowId: string, colId: string) {
    const commandAvId = getCommandAvId();
    if (!commandAvId) {
        showMessage("无法获取命令管理数据库 (Command-DB)", 3000, "error");
        return;
    }

    try {
        const { db } = await getSqliteEngine();
        
        // 1. Get the relation column name "绑定命令" in Type-DB
        const relColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name = '绑定命令'`, [avId]);
        if (relColRes.length === 0 || relColRes[0].values.length === 0) {
            showMessage("未能在超级标签管理表中找到'绑定命令'关系列", 3000, "error");
            return;
        }
        const typeRelationCol = relColRes[0].values[0][0];

        // 2. Query supertag name for the clicked row
        const typeTableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const supertagColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let supertagCol = "supertag";
        if (supertagColRes.length > 0 && supertagColRes[0].values.length > 0) {
            supertagCol = supertagColRes[0].values[0][0];
        }

        const supertagQuery = db.exec(`SELECT "${supertagCol}", "${typeRelationCol}", "${colId}" FROM ${typeTableName} WHERE _itemID = ?`, [rowId]);
        if (supertagQuery.length === 0 || supertagQuery[0].values.length === 0) {
            showMessage("未找到该超级标签的行记录", 3000, "error");
            return;
        }

        const supertagLabel = String(supertagQuery[0].values[0][0] || "").trim();
        const relationRaw = String(supertagQuery[0].values[0][1] || "");
        const currentOnCreateVal = String(supertagQuery[0].values[0][2] || "").trim();

        // 3. Resolve linked rowIDs
        let linkedRowIds: string[] = [];
        if (relationRaw) {
            try {
                linkedRowIds = JSON.parse(relationRaw);
            } catch (_) {}
        }

        // 4. Query labels of bound commands from Command-DB
        const cmdTableName = `av_${commandAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const cmdLabelColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [commandAvId]);
        let cmdLabelCol = "label";
        if (cmdLabelColRes.length > 0 && cmdLabelColRes[0].values.length > 0) {
            cmdLabelCol = cmdLabelColRes[0].values[0][0];
        }

        const boundCommands: { label: string; rowId: string }[] = [];
        if (linkedRowIds.length > 0) {
            const placeholders = linkedRowIds.map(() => "?").join(",");
            const cmdsQuery = db.exec(`SELECT _itemID, "${cmdLabelCol}" FROM ${cmdTableName} WHERE _itemID IN (${placeholders})`, linkedRowIds);
            if (cmdsQuery.length > 0 && cmdsQuery[0].values.length > 0) {
                cmdsQuery[0].values.forEach((row: any) => {
                    boundCommands.push({
                        rowId: String(row[0]),
                        label: String(row[1] || "").trim()
                    });
                });
            }
        }

        // 5. Open dialog and mount Svelte component
        const dialog = new Dialog({
            title: "配置 On Create 命令",
            content: `<div class="b3-dialog__content" id="on-create-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
            width: "400px",
            height: "480px"
        });

        new OnCreateSelectorDialog({
            target: dialog.element.querySelector("#on-create-config-container")!,
            props: {
                dialog,
                supertag: supertagLabel,
                boundCommands,
                currentValue: currentOnCreateVal,
                onSave: async (updatedVal: string) => {
                    await updateCellValue(null, avId, rowId, colId, updatedVal);
                }
            }
        });

    } catch (e: any) {
        console.error("Open On Create Config error:", e);
        showMessage(`读取配置失败: ${e.message}`, 3000, "error");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover Tooltip System for Command-DB Metadata (Requires Params, Target Scope, etc.)
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
    
    // Only target the primary key (label) cell in Command-DB
    if (avId !== commandAvId || !isPrimaryKeyCell) {
        hideTooltip();
        return;
    }

    if (activeHoverCell === cell) {
        return; // Already showing tooltip for this cell
    }

    activeHoverCell = cell;
    
    // Add mouseleave listener to the cell to hide tooltip when leaving
    cell.addEventListener("mouseleave", hideTooltip, { once: true });

    try {
        const { db } = await getSqliteEngine();
        const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        
        // Find Command ID column name
        const schemaCmdIdCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Command ID' OR key_name = '命令ID')`, [avId]);
        let cmdIdCol = "Command_ID";
        if (schemaCmdIdCol.length > 0 && schemaCmdIdCol[0].values.length > 0) {
            cmdIdCol = String(schemaCmdIdCol[0].values[0][0]);
        }

        // Query Command ID for the hovered row
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

        const content = `
            <div style="font-weight: 600; font-size: 12px; color: var(--b3-theme-primary); margin-bottom: 2px;">${cmdDef.name}</div>
            <div style="font-family: monospace; font-size: 10px; color: var(--b3-theme-on-surface-mute); word-break: break-all; margin-bottom: 6px;">${cmdDef.id}</div>
            <div style="font-size: 11px; margin-bottom: 6px; line-height: 1.4; color: var(--b3-theme-on-background); border-top: 1px solid var(--b3-border-color); padding-top: 6px;">
                ${cmdDef.description || "无描述"}
            </div>
            <div style="font-size: 10px; display: flex; gap: 8px; color: var(--b3-theme-on-surface-mute); border-top: 1px dashed var(--b3-border-color); padding-top: 4px;">
                <span>范围: <code style="background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 2px;">${scopeLabel}</code></span>
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
    
    // Position near the cell
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
