import { Dialog, showMessage } from "siyuan";
import { getCommandAvId, COMMAND_BINDINGS } from "../registration";
import { commandRegistry } from "../registry/command-registry";
import { updateCellValue } from "../../av/attribute-view/special/special-handlers";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { openConfigForCommand } from "./command-db-handler";
import ConditionalTriggerDialog from "./dialogs/ConditionalTriggerDialog.svelte";
import PresetSupertagImportDialog from "./dialogs/PresetSupertagImportDialog.svelte";

export function openPresetSupertagImportDialog() {
    const dialog = new Dialog({
        title: "导入预设超级标签 (Preset Supertags)",
        content: `<div id="preset-supertag-import-container"></div>`,
        width: "480px",
        destroyCallback: () => {}
    });
    dialog.element.classList.add("indexos-dialog");

    new PresetSupertagImportDialog({
        target: dialog.element.querySelector("#preset-supertag-import-container")!,
        props: {
            dialog,
            onImported: () => {}
        }
    });
}

export async function handleTypeDbAltClick(
    event: MouseEvent,
    avId: string,
    rowId: string,
    colId: string,
    cellEl: HTMLElement
) {
    event.preventDefault();
    event.stopPropagation();

    const { db } = await getSqliteEngine();

    // Check column type / name in Siyuan
    let isConditionalCol = false;
    let isIconMenuCol = false;
    let clickedColName = "";
    try {
        const checkColRes = db.exec(`SELECT key_name, col_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
        if (checkColRes.length > 0 && checkColRes[0].values.length > 0) {
            const keyName = checkColRes[0].values[0][0];
            clickedColName = checkColRes[0].values[0][1];
            if (keyName === "Conditional" || keyName === "触发器" || keyName === "On Create" || keyName === "创建时") {
                isConditionalCol = true;
            } else if (keyName === "Icon Menu" || keyName === "Icon menu & button" || keyName === "图标菜单" || keyName === "绑定命令") {
                isIconMenuCol = true;
            }
        }
    } catch (e) {
        console.error("[AltClick-TypeDB] Schema check failed:", e);
    }

    if (isConditionalCol) {
        await openConditionalSelector(avId, rowId, colId);
        return;
    }

    if (isIconMenuCol) {
        await openIconMenuSelector(avId, rowId, colId, clickedColName, cellEl);
        return;
    }

    // 提取所点单元格内的命令名（可以是 Icon Menu 的逗号分隔，也可以是关联字段的标签）
    const cellText = cellEl.textContent || "";
    const tags = Array.from(cellEl.querySelectorAll(".av__cell--relation-tag, span")).map(el => el.textContent?.trim()).filter(Boolean);
    const tokens = cellText.split(/[,，\n;；]/).map(s => s.trim()).filter(Boolean);
    const cleanLabels = Array.from(new Set([...tags, ...tokens])).map(s => s.replace(/[\u200B-\uFEFF]/g, "").trim()).filter(Boolean);

    const matchedCmds: { label: string; cmdDef: any }[] = [];
    for (const label of cleanLabels) {
        let cmdInfo = COMMAND_BINDINGS[label];
        if (!cmdInfo) {
            const foundKey = Object.keys(COMMAND_BINDINGS).find(k => label.includes(k) || k.includes(label));
            if (foundKey) cmdInfo = COMMAND_BINDINGS[foundKey];
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
        selectDialog.element.classList.add("indexos-dialog");
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

async function openConditionalSelector(avId: string, rowId: string, colId: string) {
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

        // Get SQLite column name for the clicked colId (which is Siyuan key ID)
        const colNameRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
        if (colNameRes.length === 0 || colNameRes[0].values.length === 0) {
            showMessage("未能在超级标签管理表中找到该列的 Schema 映射", 3000, "error");
            return;
        }
        const colName = colNameRes[0].values[0][0];

        const supertagQuery = db.exec(`SELECT "${supertagCol}", "${typeRelationCol}", "${colName}" FROM ${typeTableName} WHERE _itemID = ?`, [rowId]);
        if (supertagQuery.length === 0 || supertagQuery[0].values.length === 0) {
            showMessage("未找到该超级标签的行记录", 3000, "error");
            return;
        }

        const supertagLabel = String(supertagQuery[0].values[0][0] || "").trim();
        const relationRaw = String(supertagQuery[0].values[0][1] || "");
        const currentConditionalVal = String(supertagQuery[0].values[0][2] || "").trim();

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

        const boundCommands: { label: string; rowId: string; commandRef: string }[] = [];
        if (linkedRowIds.length > 0) {
            const placeholders = linkedRowIds.map(() => "?").join(",");
            const cmdsQuery = db.exec(`SELECT _itemID, "${cmdLabelCol}" FROM ${cmdTableName} WHERE _itemID IN (${placeholders})`, linkedRowIds);
            if (cmdsQuery.length > 0 && cmdsQuery[0].values.length > 0) {
                cmdsQuery[0].values.forEach((row: any) => {
                    const label = String(row[1] || "").trim();
                    const cmdInfo = COMMAND_BINDINGS[label];
                    boundCommands.push({
                        rowId: String(row[0]),
                        label: label,
                        commandRef: cmdInfo?.commandRef || label
                    });
                });
            }
        }

        // 5. Open dialog and mount Svelte component
        const dialog = new Dialog({
            title: "配置条件触发器 (Conditional Triggers)",
            content: `<div class="b3-dialog__content" id="conditional-config-container" style="height: 100%; display: flex; flex-direction: column;"></div>`,
            width: "720px",
            height: "640px"
        });
        dialog.element.classList.add("indexos-dialog");

        new ConditionalTriggerDialog({
            target: dialog.element.querySelector("#conditional-config-container")!,
            props: {
                dialog,
                supertag: supertagLabel,
                boundCommands,
                currentValue: currentConditionalVal,
                onSave: async (updatedVal: string) => {
                    await updateCellValue(null, avId, rowId, colId, updatedVal);
                }
            }
        });

    } catch (e: any) {
        console.error("Open Conditional Config error:", e);
        showMessage(`读取配置失败: ${e.message}`, 3000, "error");
    }
}

async function openIconMenuSelector(avId: string, rowId: string, colId: string, clickedColName: string, cellEl: HTMLElement) {
    let currentIconMenuVal = "";
    let supertagLabel = "supertag";
    let boundCommandRowIds: string[] = [];

    try {
        const { db } = await getSqliteEngine();
        const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // 1. Get the primary key column name (supertag)
        const supertagColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let supertagCol = "supertag";
        if (supertagColRes.length > 0 && supertagColRes[0].values.length > 0) {
            supertagCol = supertagColRes[0].values[0][0];
        }

        // 2. Get the relation column name '绑定命令' in Type-DB
        const relColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name = '绑定命令'`, [avId]);
        let typeRelationCol = "";
        if (relColRes.length > 0 && relColRes[0].values.length > 0) {
            typeRelationCol = relColRes[0].values[0][0];
        }

        const valRes = db.exec(`SELECT "${supertagCol}", "${clickedColName}"${typeRelationCol ? `, "${typeRelationCol}"` : ""} FROM ${tableName} WHERE _itemID = ?`, [rowId]);
        if (valRes.length > 0 && valRes[0].values.length > 0) {
            supertagLabel = String(valRes[0].values[0][0] || "supertag").trim();
            currentIconMenuVal = String(valRes[0].values[0][1] || "");
            const relationRaw = String(valRes[0].values[0][2] || "");
            if (relationRaw) {
                try {
                    boundCommandRowIds = JSON.parse(relationRaw);
                } catch (_) {}
            }
        }
    } catch (e) {
        currentIconMenuVal = cellEl?.textContent?.trim() || "";
    }

    const commandAvId = getCommandAvId();
    let selectableCommands: any[] = [];

    // Query Command IDs and Labels of ONLY the bound commands from Command-DB
    if (commandAvId && boundCommandRowIds.length > 0) {
        try {
            const { db } = await getSqliteEngine();
            const cmdTableName = `av_${commandAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const cmdLabelColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [commandAvId]);
            let cmdLabelCol = "label";
            if (cmdLabelColRes.length > 0 && cmdLabelColRes[0].values.length > 0) {
                cmdLabelCol = cmdLabelColRes[0].values[0][0];
            }

            const schemaCmdIdCol = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Command ID' OR key_name = '命令ID')`, [commandAvId]);
            let cmdIdCol = "Command_ID";
            if (schemaCmdIdCol.length > 0 && schemaCmdIdCol[0].values.length > 0) {
                cmdIdCol = String(schemaCmdIdCol[0].values[0][0]);
            }

            const placeholders = boundCommandRowIds.map(() => "?").join(",");
            const cmdsQuery = db.exec(`SELECT _itemID, "${cmdLabelCol}", "${cmdIdCol}" FROM ${cmdTableName} WHERE _itemID IN (${placeholders})`, boundCommandRowIds);
            if (cmdsQuery.length > 0 && cmdsQuery[0].values.length > 0) {
                cmdsQuery[0].values.forEach((row: any) => {
                    const label = String(row[1] || "").trim();
                    const commandId = String(row[2] || "").trim();
                    const cmdDef = commandRegistry.findByNameOrId(label) || commandRegistry.getCommand(commandId);
                    selectableCommands.push({
                        id: commandId || cmdDef?.id || label,
                        name: cmdDef?.name || label,
                        description: cmdDef?.description || `命令 ID: ${commandId}`,
                        params: cmdDef?.params || []
                    });
                });
            }
        } catch (err) {
            console.error("[AltClick-IconMenu] Failed to query bound commands from Command-DB:", err);
        }
    }

    // Fallback: If no relation row IDs, fallback to memory registered commands that match labels
    if (selectableCommands.length === 0) {
        selectableCommands = commandRegistry.getAllCommands().map(c => ({
            id: c.id,
            name: c.name,
            description: c.description || "",
            params: c.params || []
        }));
    }

    if (selectableCommands.length === 0) {
        showMessage("请先在'绑定命令'关联列中添加命令", 3000, "info");
        return;
    }

    const dialog = new Dialog({
        title: `配置 Icon menu & Button`,
        content: `<div id="icon-menu-config-dialog" style="height: 100%;"></div>`,
        width: "560px",
        height: "560px"
    });
    dialog.element.classList.add("indexos-dialog");

    console.log(`[IconMenu-Dialog] openIconMenuSelector avId=${avId} rowId=${rowId} supertag="${supertagLabel}" currentIconMenuVal="${currentIconMenuVal}" boundRows=${boundCommandRowIds.length} selectable=${selectableCommands.length}`);

    const IconMenuConfigDialog = (await import("./dialogs/IconMenuConfigDialog.svelte")).default;

    new IconMenuConfigDialog({
        target: dialog.element.querySelector("#icon-menu-config-dialog")!,
        props: {
            dialog,
            supertag: supertagLabel,
            availableCommands: selectableCommands,
            currentIconMenuVal,
            onSave: async (updatedVal: string) => {
                await updateCellValue(null, avId, rowId, colId, updatedVal);
                showMessage(`✓ 已更新 Supertag #${supertagLabel} 的 Icon Menu 配置`);
            }
        }
    });
}
