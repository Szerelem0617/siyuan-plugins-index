import { Dialog, showMessage } from "siyuan";
import { getCommandAvId, COMMAND_BINDINGS, getLayer2Commands } from "../registration";
import { commandRegistry } from "../registry/command-registry";
import { updateCellValue } from "../../av/attribute-view/special/special-handlers";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { openConfigForCommand } from "./command-db-handler";
import ConditionalTriggerDialog from "./dialogs/ConditionalTriggerDialog.svelte";
import ManualConfigDialog from "./dialogs/ManualConfigDialog.svelte";
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

    // 核心：在 Alt+Click 点开弹窗的第一时间，强制实时拉取思源最新 AV 数据并同步刷新 SQLite 内存表
    try {
        const { refreshSupertagRegistry } = await import("../utils/sync-service");
        await refreshSupertagRegistry();
    } catch (syncErr) {
        console.warn("[AltClick-TypeDB] 实时刷新注册表告警:", syncErr);
    }

    const { db } = await getSqliteEngine();

    // Check column type / name in Siyuan
    let isConditionalCol = false;
    let isIconMenuCol = false;
    let isRelatedAvCol = false;
    let clickedColName = "";
    try {
        const checkColRes = db.exec(`SELECT key_name, col_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
        if (checkColRes.length > 0 && checkColRes[0].values.length > 0) {
            const keyName = checkColRes[0].values[0][0];
            clickedColName = checkColRes[0].values[0][1];
            if (keyName === "Auto") {
                isConditionalCol = true;
            } else if (keyName === "Manual") {
                isIconMenuCol = true;
            } else if (keyName === "related_av" || clickedColName.toLowerCase().includes("related") || clickedColName.toLowerCase().includes("database") || clickedColName.includes("数据库")) {
                isRelatedAvCol = true;
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

    if (isRelatedAvCol) {
        await handleRelatedAvAltClick(avId, rowId, colId, cellEl);
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
    try {
        const { db } = await getSqliteEngine();
        
        // 1. Query supertag name for the clicked row
        const typeTableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const supertagColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let supertagCol = "supertag";
        if (supertagColRes.length > 0 && supertagColRes[0].values.length > 0) {
            supertagCol = supertagColRes[0].values[0][0];
        }

        // Get SQLite column name for the clicked colId
        const colNameRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
        let colName = "Auto";
        if (colNameRes.length > 0 && colNameRes[0].values.length > 0) {
            colName = colNameRes[0].values[0][0];
        }

        const supertagQuery = db.exec(`SELECT "${supertagCol}", "${colName}" FROM ${typeTableName} WHERE _itemID = ?`, [rowId]);
        if (supertagQuery.length === 0 || supertagQuery[0].values.length === 0) {
            showMessage("未找到该超级标签的行记录", 3000, "error");
            return;
        }

        const supertagLabel = String(supertagQuery[0].values[0][0] || "").trim();
        const currentConditionalVal = String(supertagQuery[0].values[0][1] || "").trim();

        // 2. Open dialog and mount Svelte component
        const dialog = new Dialog({
            title: `配置 Supertag #${supertagLabel} 自动触发 (Auto)`,
            content: `<div id="conditional-config-container" style="height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;"></div>`,
            width: "820px",
            height: "720px"
        });
        dialog.element.classList.add("indexos-dialog");

        new ConditionalTriggerDialog({
            target: dialog.element.querySelector("#conditional-config-container")!,
            props: {
                dialog,
                supertag: supertagLabel,
                currentValue: currentConditionalVal,
                onSave: async (updatedVal: string) => {
                    await updateCellValue(null, avId, rowId, colId, updatedVal);
                    try {
                        const { refreshSupertagRegistry } = await import("../utils/sync-service");
                        await refreshSupertagRegistry();
                    } catch (e) {
                        console.error("[AltClick-Auto] 刷新 Supertag 注册表失败:", e);
                    }
                    showMessage(`✓ 已更新 Supertag #${supertagLabel} 的自动触发 (Auto) 配置 ⚡`);
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
    let conditionalVal = "";

    try {
        const { db } = await getSqliteEngine();
        const tableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // 1. Get the primary key column name (supertag)
        const supertagColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let supertagCol = "supertag";
        if (supertagColRes.length > 0 && supertagColRes[0].values.length > 0) {
            supertagCol = supertagColRes[0].values[0][0];
        }

        let condColName = "";
        try {
            const condColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Conditional' OR key_name = '条件')`, [avId]);
            if (condColRes.length > 0 && condColRes[0].values.length > 0) {
                condColName = String(condColRes[0].values[0][0]);
            }
        } catch (_) {}

        const valRes = db.exec(`SELECT "${supertagCol}", "${clickedColName}"${condColName ? `, "${condColName}"` : ""} FROM ${tableName} WHERE _itemID = ?`, [rowId]);
        if (valRes.length > 0 && valRes[0].values.length > 0) {
            supertagLabel = String(valRes[0].values[0][0] || "supertag").trim();
            currentIconMenuVal = String(valRes[0].values[0][1] || "");
            if (condColName) {
                conditionalVal = String(valRes[0].values[0][2] || "");
            }
        }
    } catch (e) {
        currentIconMenuVal = cellEl?.textContent?.trim() || "";
    }

    const selectableCommands = getLayer2Commands();

    const dialog = new Dialog({
        title: `配置 Supertag #${supertagLabel} 手动命令 (Manual)`,
        content: `<div id="manual-config-dialog" style="height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;"></div>`,
        width: "780px",
        height: "660px"
    });
    dialog.element.classList.add("indexos-dialog");

    new ManualConfigDialog({
        target: dialog.element.querySelector("#manual-config-dialog")!,
        props: {
            dialog,
            supertag: supertagLabel,
            availableCommands: selectableCommands,
            currentVal: currentIconMenuVal,
            onSave: async (updatedVal: string) => {
                await updateCellValue(null, avId, rowId, colId, updatedVal);
                try {
                    const { refreshSupertagRegistry } = await import("../utils/sync-service");
                    await refreshSupertagRegistry();
                } catch (e) {
                    console.error("[AltClick-Manual] 刷新 Supertag 注册表失败:", e);
                }
                showMessage(`✓ 已更新 Supertag #${supertagLabel} 的手动命令 (Manual) 配置 ⚡`);
            }
        }
    });
}

async function handleRelatedAvAltClick(
    avId: string,
    rowId: string,
    colId: string,
    cellEl: HTMLElement
) {
    try {
        const { db } = await getSqliteEngine();
        const typeTableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const supertagColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let supertagCol = "supertag";
        if (supertagColRes.length > 0 && supertagColRes[0].values.length > 0) {
            supertagCol = supertagColRes[0].values[0][0];
        }

        const colNameRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
        let colName = "related_av";
        if (colNameRes.length > 0 && colNameRes[0].values.length > 0) {
            colName = colNameRes[0].values[0][0];
        }

        const supertagQuery = db.exec(`SELECT "${supertagCol}", "${colName}" FROM ${typeTableName} WHERE _itemID = ?`, [rowId]);
        if (supertagQuery.length === 0 || supertagQuery[0].values.length === 0) {
            showMessage("未找到该超级标签的行记录", 3000, "error");
            return;
        }

        const supertagLabel = String(supertagQuery[0].values[0][0] || "").replace(/#/g, "").trim();
        const currentRelatedAv = String(supertagQuery[0].values[0][1] || "").trim();

        if (!currentRelatedAv) {
            const { openSupertagManagerDialog } = await import("../../unified-attributes/manager/supertag-manager-dialog");
            openSupertagManagerDialog();
            showMessage(`🏷️ 请在超级标签管理器中为 #${supertagLabel} 关联已有数据库`);
        } else {
            // 已有关联数据库，定位打开该数据库
            const { post } = await import("../../../shared/api-client/request");
            const { openTab } = await import("siyuan");
            const { plugin } = await import("../../../shared/utils");

            post("/api/query/sql", {
                stmt: `SELECT id FROM blocks WHERE type = 'av' AND (content = '${currentRelatedAv}' OR ial LIKE '%${currentRelatedAv}%' OR markdown LIKE '%${currentRelatedAv}%') LIMIT 1`
            }).then((res) => {
                const targetBlockId = (res && res.length > 0) ? res[0].id : currentRelatedAv;
                openTab({
                    app: plugin.app,
                    doc: {
                        id: targetBlockId,
                        action: ["cb-get-hl", "cb-get-focus"]
                    }
                });
                showMessage(`✓ 已定位到数据库: ${currentRelatedAv}`);
            }).catch(() => {
                showMessage(`正在定位数据库: ${currentRelatedAv}`);
            });
        }
    } catch (e: any) {
        console.error("handleRelatedAvAltClick error:", e);
        showMessage(`操作失败: ${e.message || e}`, 3000, "error");
    }
}
