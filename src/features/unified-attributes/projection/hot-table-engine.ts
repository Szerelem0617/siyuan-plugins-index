/**
 * hot-table-engine.ts
 *
 * SQLite 投影热表引擎
 * 负责 proj_xxx 内存热表的生命周期、全库打标块扫描装配、单块动态同步、反向单元格编辑与延迟回写
 */

import { post } from "../../../shared/api-client/request";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { parseSupertags } from "../core/supertag-diff";
import { parsePhysicalAttrKey, getPhysicalAttrKey } from "../core/supertag-schema";
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

            // 检查是否有任何当前 Tag 专属属性 (包含 custom-tag-* 与 custom-b32-*)
            const hasTagCustomAttr = Object.keys(attrs).some(k => {
                const parsed = parsePhysicalAttrKey(k);
                if (parsed && parsed.tag) {
                    const pTag = parsed.tag.toLowerCase();
                    return pTag === rootTag || pTag === cleanTag;
                }
                return false;
            });

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

            // 严格只收集属于当前 Supertag 的专属属性
            for (const k of Object.keys(attrs)) {
                const parsed = parsePhysicalAttrKey(k);
                if (parsed && parsed.tag) {
                    const pTag = parsed.tag.toLowerCase();
                    if (pTag === rootTag || pTag === cleanTag) {
                        attrKeysSet.add(parsed.slug);
                    }
                }
            }
        }

        try {
            const { getSupertagSchema } = await import("../core/supertag-schema");
            const schema = await getSupertagSchema(cleanTag);
            schema.forEach(f => attrKeysSet.add(f.slug.toLowerCase()));
        } catch (_) {}

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
                        const directKey = getPhysicalAttrKey(cleanTag, a);
                        const rootKey = getPhysicalAttrKey(rootTag, a);
                        return r.attrs[directKey] ?? r.attrs[rootKey] ?? "";
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
            const parsed = parsePhysicalAttrKey(k);
            if (parsed && parsed.tag) {
                const pTag = parsed.tag.toLowerCase();
                if (pTag === rootTag || pTag === cleanTag) {
                    const colName = parsed.slug;
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
        }

        // 构造 INSERT OR REPLACE
        let content = (blockContent || "").replace(/#([^#\s]+)#?/g, "").trim();
        if (!content) {
            // 1. 保留内存热表中已有的 title
            try {
                const existingRow = db.exec(`SELECT title FROM "${binding.tableName}" WHERE id = '${blockId}';`);
                if (existingRow && existingRow.length > 0 && existingRow[0].values.length > 0) {
                    const existingTitle = String(existingRow[0].values[0][0] || "").trim();
                    if (existingTitle && existingTitle !== "未命名项") {
                        content = existingTitle;
                    }
                }
            } catch (_) {}
        }
        if (!content) {
            // 2. 从思源 SQL 查询真实块内容
            try {
                const sqlRes = await post("/api/query/sql", {
                    stmt: `SELECT content FROM blocks WHERE id = '${blockId}' LIMIT 1`
                });
                const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
                if (rows && rows.length > 0 && rows[0].content) {
                    content = String(rows[0].content).replace(/#([^#\s]+)#?/g, "").trim();
                }
            } catch (_) {}
        }
        if (!content) {
            content = "未命名项";
        }

        const colNames = ["id", "title", "_updated", "_dirty"];
        const colValues: any[] = [blockId, content, Date.now(), 0];

        for (const col of existingCols) {
            if (col !== "id" && col !== "title" && col !== "_root_id" && col !== "_updated" && col !== "_dirty") {
                colNames.push(col);
                const directKey = getPhysicalAttrKey(cleanTag, col);
                const rootKey = getPhysicalAttrKey(rootTag, col);
                const val = customAttrs[directKey] ?? customAttrs[rootKey] ?? "";
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
 * 单元格反向编辑：在 SQLite 热表中更新并即时写回物理 Markdown 属性
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

        // 1. 在 SQLite 热表中执行 SQL UPDATE (0 延迟即刻呈现，置 _dirty = 1)
        const updateSql = `UPDATE "${binding.tableName}" SET "${cleanAttrName}" = ?, _updated = ?, _dirty = 1 WHERE id = ?;`;
        db.run(updateSql, [cleanValue, Date.now(), blockId]);

        // 2. 提交到批量写回协调器 (Debounced Batch Pipeline)
        const { writebackCoordinator } = await import("./writeback-coordinator");
        writebackCoordinator.enqueue(blockId, binding.tagName, cleanAttrName, cleanValue, avId);
    } catch (e) {
        console.error(`[HotTableEngine] handleCellUpdateInSQLite 异常:`, e);
    }
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
