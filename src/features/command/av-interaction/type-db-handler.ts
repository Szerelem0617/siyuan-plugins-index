import { Dialog, showMessage } from "siyuan";
import { getTypeAvId } from "../registration";
import { updateCellValue } from "../../av/attribute-view/special/special-handlers";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import UnifiedSupertagConfigDialog from "./dialogs/UnifiedSupertagConfigDialog.svelte";
import PresetSupertagImportDialog from "./dialogs/PresetSupertagImportDialog.svelte";
import { getSupertagDbRecords } from "../../unified-attributes/core/supertag-entity";

export function openPresetSupertagImportDialog() {
    const dialog = new Dialog({
        title: "导入预设超级标签 (Preset Supertags)",
        content: `<div id="preset-supertag-import-container"></div>`,
        width: "480px",
        destroyCallback: () => {}
    });
    dialog.element.classList.add("indexos-dialog");
    dialog.element.querySelector('.b3-dialog__header')?.remove();

    new PresetSupertagImportDialog({
        target: dialog.element.querySelector("#preset-supertag-import-container")!,
        props: {
            dialog,
            onImported: () => {}
        }
    });
}

/**
 * 根据标签名直接打开 Supertag 统一聚合配置中心（用于超级标签管理器及全局触发）
 */
export async function openSupertagUnifiedConfigByTag(
    supertag: string,
    initialTab: "manual" | "auto" = "manual"
) {
    const cleanTag = supertag.replace(/^#+/, "").trim().toLowerCase();
    let currentManualVal = "";
    let currentAutoVal = "";
    let relatedAvId = "";
    let isAlreadyCustomized = false;

    try {
        const { getUnifiedSupertagList } = await import("../../unified-attributes/core/supertag-entity");
        const allList = await getUnifiedSupertagList();
        const found = allList.find(item => item.typeName.toLowerCase() === cleanTag);
        if (found) {
            relatedAvId = found.selectedAvId || "";
            currentAutoVal = found.conditionalScript || "";
            isAlreadyCustomized = Boolean(found.hasBehavior);
        }
        const records = await getSupertagDbRecords();
        const rec = records.find(r => r.typeTag.toLowerCase() === cleanTag);
        if (rec) {
            currentManualVal = rec.manual || "";
            currentAutoVal = rec.auto || "";
            matchedRowId = rec.rowId || "";
            if (rec.relatedAv) relatedAvId = rec.relatedAv;
            isAlreadyCustomized = Boolean(rec.manual || rec.auto);
        }
    } catch (e) {
        console.warn("[Supertag-UnifiedConfig] Failed to fetch existing supertag records:", e);
    }

    const typeAvId = getTypeAvId();

    const dialog = new Dialog({
        title: `⚡ Supertag #${cleanTag} 配置中心`,
        content: `<div id="unified-supertag-config-container" style="height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;"></div>`,
        width: "840px",
        height: "720px"
    });
    dialog.element.classList.add("indexos-dialog");
    dialog.element.querySelector('.b3-dialog__header')?.remove();

    new UnifiedSupertagConfigDialog({
        target: dialog.element.querySelector("#unified-supertag-config-container")!,
        props: {
            dialog,
            supertag: cleanTag,
            initialTab,
            currentManualVal,
            currentAutoVal,
            onSave: async ({ manual, auto }) => {
                const cleanManual = (manual === "[]" || !manual) ? "" : manual.trim();
                const cleanAuto = (auto || "").trim();
                const initialCleanManual = (currentManualVal === "[]" || !currentManualVal) ? "" : currentManualVal.trim();
                const initialCleanAuto = (currentAutoVal || "").trim();
                const isUnchanged = (cleanManual === initialCleanManual && cleanAuto === initialCleanAuto);

                // 纯数据库 (未客制化) 且未做任何编辑或配置为空时：不写入 supertag-db，保持纯数据库 (蓝色边框)
                if (!isAlreadyCustomized && (!cleanManual && !cleanAuto || isUnchanged)) {
                    return;
                }

                // 1. 如果存在思源 AV 实例化表 (typeAvId)，通过统一 DML UPSERT 写入思源 AV 实体行与单元格属性
                if (typeAvId) {
                    try {
                        const { runQuery, avIdToTableName } = await import("../../sqlite/sqlite-manager");
                        const exactTableName = avIdToTableName(typeAvId);
                        const escapeSql = (str: string) => (str || "").replace(/'/g, "''");
                        let dmlSql = "";
                        if (relatedAvId) {
                            dmlSql = `INSERT INTO "${exactTableName}" ("主键", "Manual", "Auto", "Related av") VALUES ('${escapeSql(cleanTag)}', '${escapeSql(manual)}', '${escapeSql(auto)}', '${escapeSql(relatedAvId)}') ON CONFLICT("主键") DO UPDATE SET "Manual" = EXCLUDED."Manual", "Auto" = EXCLUDED."Auto", "Related av" = EXCLUDED."Related av"`;
                        } else {
                            dmlSql = `INSERT INTO "${exactTableName}" ("主键", "Manual", "Auto") VALUES ('${escapeSql(cleanTag)}', '${escapeSql(manual)}', '${escapeSql(auto)}') ON CONFLICT("主键") DO UPDATE SET "Manual" = EXCLUDED."Manual", "Auto" = EXCLUDED."Auto"`;
                        }
                        await runQuery(dmlSql);
                    } catch (dmlErr) {
                        console.error("[Supertag-UnifiedConfig] runQuery DML error:", dmlErr);
                    }
                }

                // 2. 同步更新 SQLite 内存热表 (无论是未实例化还是实例化，都保证本地 SQLite 内存表实时一致)
                try {
                    const { db } = await getSqliteEngine();
                    const check = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='supertag-db';`);
                    if (check.length > 0 && check[0].values.length > 0) {
                        const rowCheck = db.exec(`SELECT rowid FROM "supertag-db" WHERE LOWER("主键") = ? OR LOWER(supertag) = ?;`, [cleanTag, cleanTag]);
                        if (rowCheck.length > 0 && rowCheck[0].values.length > 0) {
                            db.run(
                                `UPDATE "supertag-db" SET "Manual" = ?, "Auto" = ?, "Related av" = COALESCE(NULLIF(?, ''), "Related av"), _updated = ? WHERE LOWER("主键") = ? OR LOWER(supertag) = ?;`,
                                [manual, auto, relatedAvId, Date.now(), cleanTag, cleanTag]
                            );
                        } else {
                            db.run(
                                `INSERT INTO "supertag-db" ("主键", "Manual", "Auto", "Related av", _updated) VALUES (?, ?, ?, ?, ?);`,
                                [cleanTag, manual, auto, relatedAvId, Date.now()]
                            );
                        }
                    }
                } catch (sqlErr) {
                    console.error("[Supertag-UnifiedConfig] SQLite memory update error:", sqlErr);
                }

                // 3. 立即刷新注册表并通知 UI 重新加载
                try {
                    const { syncService } = await import("../utils/sync-service");
                    await syncService.syncSupertagsFromSqlite();
                    await syncService.refreshSupertagRegistry();
                    window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));
                    showMessage(`✓ 已保存 #${cleanTag} 命令配置`);
                } catch (rErr) {
                    console.warn("[Supertag-UnifiedConfig] 刷新注册表异常:", rErr);
                }
            }
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

    // 检查点击的列类型与列名
    let isConditionalCol = false;
    let isRelatedAvCol = false;
    try {
        const checkColRes = db.exec(`SELECT key_name, col_name FROM _av_schema WHERE av_id = ? AND key_id = ?`, [avId, colId]);
        if (checkColRes.length > 0 && checkColRes[0].values.length > 0) {
            const keyName = checkColRes[0].values[0][0];
            const clickedColName = checkColRes[0].values[0][1];
            if (keyName === "Auto" || keyName === "Conditional") {
                isConditionalCol = true;
            } else if (keyName === "Related av" || keyName === "related_av" || clickedColName.toLowerCase().includes("related") || clickedColName.toLowerCase().includes("database") || clickedColName.includes("数据库")) {
                isRelatedAvCol = true;
            }
        }
    } catch (e) {
        console.error("[AltClick-TypeDB] Schema check failed:", e);
    }

    if (isRelatedAvCol) {
        await handleRelatedAvAltClick(avId, rowId, colId, cellEl);
        return;
    }

    // 统一聚合配置：无论是点击 Manual 还是 Auto 列，均唤起同一个聚合多 Tab 面板，智能激活对应 Tab
    const initialTab = isConditionalCol ? "auto" : "manual";
    await openSupertagUnifiedConfigForAvRow(avId, rowId, initialTab);
}

async function openSupertagUnifiedConfigForAvRow(
    avId: string,
    rowId: string,
    initialTab: "manual" | "auto"
) {
    try {
        const { db } = await getSqliteEngine();
        const typeTableName = `av_${avId.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // 1. 获取主键列 (supertag)
        const supertagColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [avId]);
        let supertagCol = "supertag";
        if (supertagColRes.length > 0 && supertagColRes[0].values.length > 0) {
            supertagCol = supertagColRes[0].values[0][0];
        }

        // 2. 获取 Manual 与 Auto 列的列名与 key_id
        let manualCol = "Manual";
        let autoCol = "Auto";
        let manualKeyId = "";
        let autoKeyId = "";

        const allSchemaCols = db.exec(`SELECT key_name, col_name, key_id FROM _av_schema WHERE av_id = ?`, [avId]);
        if (allSchemaCols.length > 0 && allSchemaCols[0].values.length > 0) {
            for (const row of allSchemaCols[0].values) {
                const kName = String(row[0] || "").toLowerCase();
                const cName = String(row[1] || "");
                const kId = String(row[2] || "");
                if (kName === "manual" || kName === "icon menu") {
                    manualCol = cName;
                    manualKeyId = kId;
                } else if (kName === "auto" || kName === "conditional") {
                    autoCol = cName;
                    autoKeyId = kId;
                }
            }
        }

        // 3. 读取当前行的 supertag, Manual 和 Auto 数据
        let supertagLabel = "supertag";
        let currentManualVal = "";
        let currentAutoVal = "";

        const rowQuery = db.exec(
            `SELECT "${supertagCol}", "${manualCol}", "${autoCol}" FROM ${typeTableName} WHERE _itemID = ?`,
            [rowId]
        );

        if (rowQuery.length > 0 && rowQuery[0].values.length > 0) {
            supertagLabel = String(rowQuery[0].values[0][0] || "").replace(/^#+/, "").trim();
            currentManualVal = String(rowQuery[0].values[0][1] || "").trim();
            currentAutoVal = String(rowQuery[0].values[0][2] || "").trim();
        }

        if (!supertagLabel) {
            showMessage("未找到该超级标签的行记录", 3000, "error");
            return;
        }

        // 4. 唤起统一多 Tab 聚合配置弹窗
        const dialog = new Dialog({
            title: `⚡ Supertag #${supertagLabel} 配置中心`,
            content: `<div id="unified-supertag-config-container" style="height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;"></div>`,
            width: "840px",
            height: "720px"
        });
        dialog.element.classList.add("indexos-dialog");
        dialog.element.querySelector('.b3-dialog__header')?.remove();

        new UnifiedSupertagConfigDialog({
            target: dialog.element.querySelector("#unified-supertag-config-container")!,
            props: {
                dialog,
                supertag: supertagLabel,
                initialTab,
                currentManualVal,
                currentAutoVal,
                onSave: async ({ manual, auto }) => {
                    // 更新 SiYuan AV 单元格
                    if (manualKeyId) {
                        await updateCellValue(null, avId, rowId, manualKeyId, manual);
                    }
                    if (autoKeyId) {
                        await updateCellValue(null, avId, rowId, autoKeyId, auto);
                    }

                    // 更新 SQLite supertag-db 内存表
                    try {
                        const check = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='supertag-db';`);
                        if (check.length > 0 && check[0].values.length > 0) {
                            db.run(
                                `UPDATE "supertag-db" SET "Manual" = ?, "Auto" = ?, _updated = ? WHERE LOWER("主键") = ? OR LOWER(supertag) = ?;`,
                                [manual, auto, Date.now(), supertagLabel.toLowerCase(), supertagLabel.toLowerCase()]
                            );
                        }
                    } catch (e) {
                        console.error("[AltClick-UnifiedSave] SQLite update error:", e);
                    }
                }
            }
        });
    } catch (e: any) {
        console.error("Open Supertag Unified Config error:", e);
        showMessage(`读取配置失败: ${e.message}`, 3000, "error");
    }
}

async function handleRelatedAvAltClick(
    avId: string,
    rowId: string,
    colId: string,
    _cellEl: HTMLElement
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
        let colName = "Related av";
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
            const { openSupertagManagerDialog } = await import("../../unified-attributes/manager/supertag-manager");
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
