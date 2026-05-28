import { Dialog, showMessage } from "siyuan";
import { getCommandAvId, getTypeAvId, COMMAND_REGISTRY } from "../registration";
import { encodeBtnHref } from "../global-registration/inline-button";
import { commandRegistry } from "../registry/command-registry";
import { updateCellValue } from "../../data/attribute-view/special/special-handlers";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import ParamConfigDialog from "./ParamConfigDialog.svelte";
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
        showMessage("未能加载逻辑工厂 (Command-DB) 数据库", 3000, "error");
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
            showMessage(`未在逻辑工厂 (Command-DB) 中找到名称为 "${cleanLabel}" 的行，请先创建`, 3000, "warning");
            return;
        }

        // 3. 获取 Param Mapping 的 Siyuan key ID
        const paramColKeyId = await getParamColKeyId(commandAvId);
        if (!paramColKeyId) {
            showMessage("未能在逻辑工厂中找到 'Param Mapping' 列", 3000, "error");
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
