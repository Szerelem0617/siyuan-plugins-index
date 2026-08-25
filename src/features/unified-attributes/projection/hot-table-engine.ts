/**
 * hot-table-engine.ts
 *
 * SQLite 投影热表引擎
 * 负责 proj_xxx 内存热表的生命周期、全库打标块扫描装配、单块动态同步、反向单元格编辑与延迟回写
 */

import { post } from "../../../shared/api-client/request";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { settings } from "../../../core/settings";
import { showMessage } from "siyuan";
import { parseSupertags } from "../core/supertag-diff";
import { type VirtualAVBinding } from "./types";
import { notifyFrontendToRerender } from "./rerender-dispatcher";

export function parseIALString(ial: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!ial) return result;
    const regex = /([\w\-]+)="((?:\\.|[^"\\])*)"/g;
    let match;
    while ((match = regex.exec(ial)) !== null) {
        const key = match[1];
        let val = match[2];
        val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        result[key] = val;
    }
    return result;
}

export function extractCleanValue(data: any): string {
    if (data === null || data === undefined) return "";
    if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
        return String(data);
    }
    if (data.text?.content !== undefined) return String(data.text.content);
    if (Array.isArray(data.mSelect) && data.mSelect.length > 0) {
        return data.mSelect[0].name || data.mSelect[0].content || "";
    }
    if (data.select?.name) return data.select.name;
    if (data.checkbox?.checked !== undefined) return data.checkbox.checked ? "true" : "false";
    return JSON.stringify(data);
}

/**
 * 扫描全库打标块并初始化/重建 SQLite 热表
 */
export async function projectSupertagToSQLite(
    tagName: string,
    avId: string,
    binding: VirtualAVBinding
): Promise<{ success: boolean; rowCount: number; attrNames: string[]; message?: string }> {
    const cleanTag = tagName.replace(/^#/, "").trim();
    const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();
    const tableName = binding.tableName;

    try {
        // 1. 查询全库命中标签或带有该 tag custom 属性的物理块
        const blocksRes = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, content, ial, tag, updated, created FROM blocks WHERE ial LIKE '%custom-supertags%' OR ial LIKE '%custom-${rootTag}%' OR ial LIKE '%custom-${cleanTag}%' OR tag LIKE '%#${rootTag}#%' OR tag = '${rootTag}' OR tag LIKE '%#${rootTag}.%' OR tag LIKE '%#${rootTag}/%' ORDER BY updated DESC LIMIT 500`
        });

        const rows: any[] = Array.isArray(blocksRes) ? blocksRes : (blocksRes?.data || []);
        const parsedRows: any[] = [];
        const attrKeysSet = new Set<string>();

        for (const row of rows) {
            const attrs = parseIALString(row.ial || "");
            const blockTags = new Set<string>();

            // 解析显式 Supertags
            if (attrs["custom-supertags"]) {
                parseSupertags(attrs["custom-supertags"]).forEach(t => blockTags.add(t.toLowerCase()));
            }
            if (attrs["custom-index-tags"]) {
                parseSupertags(attrs["custom-index-tags"]).forEach(t => blockTags.add(t.toLowerCase()));
            }

            // 解析行内标签与块 tag 属性
            if (row.tag) {
                row.tag.split(/[\s,]+/).forEach((t: string) => {
                    const cl = t.replace(/#/g, "").trim().toLowerCase();
                    if (cl) blockTags.add(cl);
                });
            }

            const isTagMatched = Array.from(blockTags).some(t => 
                t === cleanTag.toLowerCase() || 
                t === rootTag || 
                t.startsWith(`${rootTag}.`) || 
                t.startsWith(`${rootTag}/`)
            );

            // 检查是否有任何当前 Tag 专属的 custom-<tag>-* 属性
            const hasTagCustomAttr = Object.keys(attrs).some(k => 
                k.startsWith(`custom-${rootTag}-`) || k.startsWith(`custom-${cleanTag}-`)
            );

            if (!isTagMatched && !hasTagCustomAttr) {
                continue; // 严格过滤：非此 Tag 的块绝不投影！
            }

            parsedRows.push({
                id: row.id,
                content: String(row.content || "未命名项").replace(/#([^#\s]+)#?/g, "").trim() || "未命名项",
                root_id: row.root_id || "",
                updated: parseInt(row.updated || "0") || Date.now(),
                attrs
            });

            // 严格只收集以当前 rootTag 或 cleanTag 开头的专属属性 (custom-<tag>-<attr>)
            for (const k of Object.keys(attrs)) {
                if (k.startsWith("custom-")) {
                    const rawClean = k.replace(/^custom-/, "");
                    if (rawClean.startsWith(`${rootTag}-`) || rawClean.startsWith(`${cleanTag}-`)) {
                        const prefix = rawClean.startsWith(`${rootTag}-`) ? `${rootTag}-` : `${cleanTag}-`;
                        attrKeysSet.add(rawClean.slice(prefix.length));
                    }
                }
            }
        }

        if (attrKeysSet.size === 0) attrKeysSet.add("status");
        const attrNames = Array.from(attrKeysSet);
        binding.attrNames = attrNames;

        const { db } = await getSqliteEngine();
        db.exec(`DROP TABLE IF EXISTS "${tableName}";`);

        const colDefs = [
            `"id" TEXT PRIMARY KEY`,
            `"title" TEXT`,
            `"_root_id" TEXT`,
            `"_updated" INTEGER`,
            `"_dirty" INTEGER DEFAULT 0`,
            ...attrNames.map(a => `"${a}" TEXT`)
        ].join(",\n    ");

        const createSql = `CREATE TABLE "${tableName}" (\n    ${colDefs}\n);`;
        db.exec(createSql);

        // 批量插入初始数据
        if (parsedRows.length > 0) {
            const colNames = ["id", "title", "_root_id", "_updated", "_dirty", ...attrNames];
            const placeholders = colNames.map(() => "?").join(", ");
            const insertSql = `INSERT INTO "${tableName}" (${colNames.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders});`;
            const stmt = db.prepare(insertSql);

            for (const r of parsedRows) {
                const rowValues = [
                    r.id,
                    r.content,
                    r.root_id,
                    r.updated,
                    0,
                    ...attrNames.map(a => {
                        return r.attrs[`custom-${cleanTag}-${a}`] ||
                               r.attrs[`custom-${rootTag}-${a}`] ||
                               "";
                    })
                ];
                stmt.run(rowValues);
            }
            stmt.free();
        }

        return { success: true, rowCount: parsedRows.length, attrNames };
    } catch (err) {
        console.error(`[HotTableEngine] 初始化 SQLite 热表失败:`, err);
        return { success: false, rowCount: 0, attrNames: [], message: String(err) };
    }
}

/**
 * 将单个块的属性实时同步/插入到 SQLite 内存虚拟投影热表中 (0 延迟即时呈现)
 */
export async function syncBlockToSQLite(
    binding: VirtualAVBinding,
    avId: string,
    blockId: string,
    tagName: string,
    customAttrs: Record<string, string>,
    blockContent?: string
) {
    const cleanTag = tagName.replace(/^#/, "").trim();
    const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();

    try {
        const { db } = await getSqliteEngine();

        // 确保表存在
        const tableCheck = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${binding.tableName}';`);
        if (!tableCheck || tableCheck.length === 0 || tableCheck[0].values.length === 0) {
            await projectSupertagToSQLite(binding.tagName || rootTag, avId, binding);
        }

        // 获取热表的列定义
        const colInfoRes = db.exec(`PRAGMA table_info("${binding.tableName}");`);
        if (!colInfoRes || colInfoRes.length === 0) return;

        const existingCols = colInfoRes[0].values.map((r: any) => String(r[1])); // 列名列表
        
        // 如果 customAttrs 中有热表中尚未建立的专属新列，动态 ALTER TABLE ADD COLUMN
        for (const [k] of Object.entries(customAttrs)) {
            if (k.startsWith(`custom-${rootTag}-`) || k.startsWith(`custom-${cleanTag}-`)) {
                const prefix = k.startsWith(`custom-${rootTag}-`) ? `custom-${rootTag}-` : `custom-${cleanTag}-`;
                const colName = k.slice(prefix.length);
                if (!existingCols.includes(colName) && colName !== "id" && colName !== "title" && !colName.startsWith("_")) {
                    try {
                        db.exec(`ALTER TABLE "${binding.tableName}" ADD COLUMN "${colName}" TEXT;`);
                        existingCols.push(colName);
                        if (!binding.attrNames.includes(colName)) {
                            binding.attrNames.push(colName);
                        }
                    } catch (_) {}
                }
            }
        }

        // 构造 INSERT OR REPLACE
        const content = String(blockContent || "未命名项").replace(/#([^#\s]+)#?/g, "").trim() || "未命名项";
        const colNames = ["id", "title", "_updated", "_dirty"];
        const colValues: any[] = [blockId, content, Date.now(), 0];

        for (const col of existingCols) {
            if (col !== "id" && col !== "title" && col !== "_root_id" && col !== "_updated" && col !== "_dirty") {
                colNames.push(col);
                const val = customAttrs[`custom-${rootTag}-${col}`] ??
                            customAttrs[`custom-${cleanTag}-${col}`] ??
                            "";
                colValues.push(val);
            }
        }

        const placeholders = colNames.map(() => "?").join(", ");
        const sql = `INSERT OR REPLACE INTO "${binding.tableName}" (${colNames.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders});`;
        db.run(sql, colValues);
    } catch (err) {
        console.error(`[HotTableEngine] 同步块到热表失败:`, err);
    }
}

/**
 * 当块被移除 Supertag 时，实时从内存热表中删除该行
 */
export async function removeBlockFromSQLite(binding: VirtualAVBinding, blockId: string) {
    try {
        const { db } = await getSqliteEngine();
        db.run(`DELETE FROM "${binding.tableName}" WHERE id = ?;`, [blockId]);
    } catch (_) {}
}

/**
 * 单元格反向编辑：在 SQLite 中执行 UPDATE，并根据设置判断是否即时回写块属性
 */
export async function handleCellUpdateInSQLite(
    binding: VirtualAVBinding,
    operation: any
): Promise<void> {
    if (!operation) return;
    const avId = operation.avID || operation.avId;
    const keyId = operation.keyID || operation.keyId;
    const blockId = operation.rowID || operation.itemID || operation.rowId;
    const rawData = operation.data !== undefined ? operation.data : operation.value;

    if (!keyId || !blockId) return;

    try {
        const cleanAttrName = keyId.replace(/^col_/, "");
        if (cleanAttrName === "primary_block") return;

        const cleanValue = extractCleanValue(rawData);
        const { db } = await getSqliteEngine();

        // 1. 在 SQLite 热表中执行 SQL UPDATE
        const updateSql = `UPDATE "${binding.tableName}" SET "${cleanAttrName}" = ?, _dirty = 1, _updated = ? WHERE id = ?;`;
        db.run(updateSql, [cleanValue, Date.now(), blockId]);

        // 2. 根据设置判断是否即时写回物理 Markdown 属性
        const syncMode = (settings.get("virtualAvSyncMode") as string) || "realtime";
        if (syncMode === "realtime") {
            const tag = binding.tagName;
            const attrKey = `custom-${tag}-${cleanAttrName}`;
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    [attrKey]: cleanValue
                }
            });
        }

        // 3. 通知 Protyle 刷新表格显示
        setTimeout(() => {
            notifyFrontendToRerender(avId);
        }, 100);
    } catch (e) {
        console.error(`[HotTableEngine] handleCellUpdateInSQLite 异常:`, e);
    }
}

/**
 * 延迟模式下批量统一回写所有 _dirty 标记的行
 */
export async function flushDirtyBlocks(binding: VirtualAVBinding): Promise<number> {
    let flushCount = 0;
    try {
        const { db } = await getSqliteEngine();
        const dirtyRes = db.exec(`SELECT * FROM "${binding.tableName}" WHERE _dirty = 1;`);
        
        if (dirtyRes && dirtyRes.length > 0 && dirtyRes[0].values.length > 0) {
            const columns = dirtyRes[0].columns;
            const rows = dirtyRes[0].values;
            const idIdx = columns.indexOf("id");
            const batchAttrs: Array<{ id: string; attrs: Record<string, string> }> = [];

            for (const row of rows) {
                const blockId = String(row[idIdx]);
                const attrs: Record<string, string> = {};

                for (let c = 0; c < columns.length; c++) {
                    const col = columns[c];
                    if (col !== "id" && col !== "title" && !col.startsWith("_")) {
                        const val = row[c] !== null && row[c] !== undefined ? String(row[c]) : "";
                        attrs[`custom-${binding.tagName}-${col}`] = val;
                    }
                }
                batchAttrs.push({ id: blockId, attrs });
            }

            try {
                await post("/api/attr/batchSetBlockAttrs", { blockAttrs: batchAttrs });
            } catch (batchErr) {
                for (const item of batchAttrs) {
                    await post("/api/attr/setBlockAttrs", { id: item.id, attrs: item.attrs });
                }
            }

            flushCount = rows.length;
        }
    } catch (flushErr) {
        console.error(`[HotTableEngine] 统一回写异常:`, flushErr);
    }
    return flushCount;
}

/**
 * 删除指定的 SQLite 投影热表
 */
export async function dropHotTable(tableName: string) {
    try {
        const { db } = await getSqliteEngine();
        db.exec(`DROP TABLE IF EXISTS "${tableName}";`);
    } catch (_) {}
}
