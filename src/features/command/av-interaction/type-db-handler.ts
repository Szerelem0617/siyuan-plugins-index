import { Dialog, showMessage } from "siyuan";
import { getTypeAvId, setTypeAvId } from "../registration";
import { post } from "../../../shared/api-client/request";
import { updateCellValue } from "../../av/attribute-view/special/special-handlers";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import UnifiedSupertagConfigDialog from "./dialogs/UnifiedSupertagConfigDialog.svelte";
import PresetSupertagImportDialog from "./dialogs/PresetSupertagImportDialog.svelte";
import { getSupertagDbRecords } from "../../unified-attributes/core/supertag-entity";

export function openPresetSupertagImportDialog(onImportedCallback?: () => void) {
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
            onImported: async () => {
                const { refreshSupertagManager } = await import("../../unified-attributes/manager/supertag-manager");
                await refreshSupertagManager();
                if (onImportedCallback) onImportedCallback();
            }
        }
    });
}

/**
 * 向 supertag-db 系统 AV 数据库中插入或更新一条 Supertag 记录 (使用原生 AV API，绝不走 SQL DML)
 */
export async function insertOrUpdateSupertagDbRecord(
    tag: string,
    options?: { manual?: string; auto?: string; relatedAv?: string }
): Promise<void> {
    const cleanTag = tag.replace(/^#+/, "").trim().toLowerCase();
    if (!cleanTag) return;

    // 1. 获取 typeAvId
    let typeAvId = getTypeAvId();
    if (!typeAvId) {
        try {
            const typeAttrSql = `SELECT block_id, root_id FROM attributes WHERE name = 'custom-index-supertag-db' LIMIT 1`;
            const typeAttrs = await post("/api/query/sql", { stmt: typeAttrSql });
            if (typeAttrs && typeAttrs.length > 0) {
                const blockId = typeAttrs[0].block_id;
                const domRes = await post("/api/block/getBlockDOM", { id: blockId });
                const html = domRes?.dom || domRes?.data?.dom || "";
                const match = html.match(/data-av-id="([^"]+)"/);
                typeAvId = match ? match[1] : blockId;
                if (typeAvId) setTypeAvId(typeAvId);
                if (typeAttrs[0].root_id) setTypeDocId(typeAttrs[0].root_id);
            }
        } catch (_) {}
    }

    if (!typeAvId) {
        // 未实例化时无需操作原生 AV
        return;
    }

    // 2. 获取 supertag-db 的列结构
    const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
    const keys = Array.isArray(keysRes) ? keysRes : (keysRes?.keys || []);
    const primaryKey = keys.find((k: any) => k.type === "block" || k.name === "主键") || keys[0];
    const manualKey = keys.find((k: any) => k.name === "Manual" || k.name === "manual");
    const autoKey = keys.find((k: any) => k.name === "Auto" || k.name === "auto");
    const relatedAvKey = keys.find((k: any) => k.name === "Related av" || k.name === "relatedAv");

    // 3. 查询当前 supertag-db 的行
    const rowsRes = await post("/api/av/renderAttributeView", { id: typeAvId, page: 1, pageSize: 200 });
    const avRows = rowsRes?.data?.view?.rows || rowsRes?.view?.rows || rowsRes?.rows || [];

    let targetRow = avRows.find((r: any) => {
        const pkCell = r.cells?.find((c: any) => c.keyID === primaryKey?.id) || r.cells?.[0];
        const tagContent = pkCell?.value?.block?.content || pkCell?.value?.text?.content || "";
        return tagContent.replace(/^#+/, "").trim().toLowerCase() === cleanTag;
    });

    let rowId = targetRow?.id;

    // 4. 若不存在该行，通过 /api/av/addAttributeViewBlocks 插入新行
    if (!rowId) {
        const newRowId = "row_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        await post("/api/av/addAttributeViewBlocks", {
            avID: typeAvId,
            srcs: [{
                itemID: newRowId,
                id: "",
                isDetached: true
            }]
        });
        rowId = newRowId;
    }

    // 5. 批量写入单元格属性
    const populateOps: any[] = [];

    if (primaryKey && rowId) {
        populateOps.push({
            keyID: primaryKey.id,
            itemID: rowId,
            value: { type: "block", block: { content: cleanTag } }
        });
    }

    if (manualKey && rowId && options?.manual !== undefined) {
        populateOps.push({
            keyID: manualKey.id,
            itemID: rowId,
            value: { type: "text", text: { content: options.manual } }
        });
    }

    if (autoKey && rowId && options?.auto !== undefined) {
        populateOps.push({
            keyID: autoKey.id,
            itemID: rowId,
            value: { type: "text", text: { content: options.auto } }
        });
    }

    if (relatedAvKey && rowId && options?.relatedAv !== undefined) {
        populateOps.push({
            keyID: relatedAvKey.id,
            itemID: rowId,
            value: { type: "text", text: { content: options.relatedAv } }
        });
    }

    if (populateOps.length > 0) {
        await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: typeAvId, values: populateOps });
    }

    // 同步到热 SQLite 虚拟镜像
    try {
        const { instantiateAV } = await import("../../sqlite/sqlite-manager");
        await instantiateAV(typeAvId, true);
    } catch (_) {}
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
                    const { refreshSupertagRegistry } = await import("../utils/sync-service");
                    await refreshSupertagRegistry();
                    window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));
                    showMessage(`✓ 已保存 #${cleanTag} 命令配置`);
                } catch (rErr) {
                    console.warn("[Supertag-UnifiedConfig] 刷新注册表异常:", rErr);
                }
            }
        }
    });
}
