/**
 * context-extractor.ts
 *
 * Decouples Siyuan-specific DOM parsing, API calls, and SQLite database extraction
 * from the template rendering logic.
 */

import type { CommandContext } from "../command-dispatcher";
import { post } from "../../../shared/api-client/request";
import { runQuery, tableNameToAvId, instantiateAV } from "../../sqlite/sqlite-manager";
import { getGlobalTypeConfigs } from "../../data/av-setting/db-config";

/**
 * Gets the block ID from the current context.
 */
export function getBlockId(context: CommandContext): string {
    return context.blockEl?.getAttribute("data-node-id") ?? "";
}

/**
 * Retrieves the parent block ID and the root document block ID for a given block ID.
 */
export async function getParentIdAndRootId(blockId: string): Promise<{ parentId: string; rootId: string }> {
    if (!blockId) {
        return { parentId: "", rootId: "" };
    }
    try {
        const res = await post("/api/block/getBlockBreadcrumb", { id: blockId });
        const crumbs: any[] = res.data ?? [];
        const rootId = crumbs[0]?.id ?? "";
        const parentId = crumbs.length > 1 ? crumbs[crumbs.length - 2]?.id : rootId;
        return { parentId, rootId };
    } catch (err) {
        console.error("[ContextExtractor] Error getting block breadcrumbs:", err);
        return { parentId: "", rootId: "" };
    }
}

/**
 * Retrieves custom attributes for a given block ID.
 */
export async function getBlockAttrs(blockId: string): Promise<Record<string, string>> {
    if (!blockId) {
        return {};
    }
    try {
        const res = await post("/api/attr/getBlockAttrs", { id: blockId });
        return (res?.data || res || {}) as Record<string, string>;
    } catch (err) {
        console.error("[ContextExtractor] Error getting block attributes:", err);
        return {};
    }
}

/**
 * Resolves SQLite (Layer 4) database attributes for the block.
 */
export async function resolveLayer4Params(blockId: string, supertag?: string): Promise<Record<string, string>> {
    const params: Record<string, string> = {};
    if (!blockId) {
        return params;
    }

    const cleanTag = supertag ? supertag.replace(/^#/, "").trim().toLowerCase() : "";

    const querySQLite = async (): Promise<Array<{ tableName: string; avId: string; name: string; rowData: Record<string, string> }>> => {
        const tablesRes = await runQuery(`
            SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'av_%'
        `);
        if (!tablesRes || !tablesRes.values || tablesRes.values.length === 0) {
            return [];
        }

        const matches: Array<{ tableName: string; avId: string; name: string; rowData: Record<string, string> }> = [];

        for (const row of tablesRes.values) {
            const tableName = row[0];
            if (!tableName) continue;

            try {
                const existsRes = await runQuery(`SELECT count(*) FROM "${tableName}" WHERE rowID = ?`, [blockId]);
                const existsCount = existsRes?.values?.[0]?.[0] || 0;
                if (Number(existsCount) > 0) {
                    const avId = tableNameToAvId(tableName);
                    
                    let dbRealName = "";
                    try {
                        const avConfig = await post("/api/av/getAttributeView", { id: avId });
                        dbRealName = avConfig?.name || (avConfig?.av ? avConfig.av.name : "");
                    } catch { /* ignore */ }

                    const rowRes = await runQuery(`SELECT * FROM "${tableName}" WHERE rowID = ?`, [blockId]);
                    if (rowRes && rowRes.columns && rowRes.values && rowRes.values.length > 0) {
                        const cols = rowRes.columns;
                        const vals = rowRes.values[0];
                        const rowData: Record<string, string> = {};
                        cols.forEach((colName, idx) => {
                            rowData[colName] = vals[idx] !== null && vals[idx] !== undefined ? String(vals[idx]) : "";
                        });
                        matches.push({ tableName, avId, name: dbRealName, rowData });
                    }
                }
            } catch (err) {
                console.error(`[Layer4Params] Error querying table "${tableName}":`, err);
            }
        }
        return matches;
    };

    try {
        // 1. First, search SQLite directly (Read-only query, no HTTP API requests)
        let matchedDbs = await querySQLite();

        // 2. If not found in SQLite, trigger passive sync fallback
        if (matchedDbs.length === 0) {
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const avsAttr = attrsRes.data?.["custom-avs"] || "";
            const avIds = avsAttr.split(",").map((id: string) => id.trim()).filter(Boolean);
            
            let syncedAny = false;
            for (const avId of avIds) {
                try {
                    await instantiateAV(avId, true); // force sync
                    syncedAny = true;
                } catch (syncErr) {
                    console.error(`[Layer4Params] Passive sync failed for ${avId}:`, syncErr);
                }
            }

            if (avIds.length === 0 && cleanTag) {
                const configs = await getGlobalTypeConfigs();
                const matchedConfigs = configs.filter(c => {
                    const typeName = (c.typeName || "").trim().toLowerCase();
                    return typeName === cleanTag || typeName.includes(cleanTag) || cleanTag.includes(typeName);
                });
                for (const config of matchedConfigs) {
                    if (config.avId) {
                        try {
                            await instantiateAV(config.avId, true); // force sync
                            syncedAny = true;
                        } catch (syncErr) { /* ignore */ }
                    }
                }
            }

            // Retry SQLite query if we successfully synced any databases
            if (syncedAny) {
                matchedDbs = await querySQLite();
            }
        }

        if (matchedDbs.length === 0) {
            // 没有对应的数据库时，回退读取块自身的 custom-* 属性作为参数变量
            const attrs = await getBlockAttrs(blockId);
            for (const [k, v] of Object.entries(attrs)) {
                if (k.startsWith("custom-")) {
                    const cleanKey = k.replace(/^custom-/, "");
                    params[k] = String(v);
                    params[cleanKey] = String(v);
                }
            }
            return params;
        }

        // 3. Priority match: exact database name matching supertag > others
        let targetDb = matchedDbs[0];
        if (cleanTag) {
            const sameNameDb = matchedDbs.find(db => {
                const dbName = db.name.trim().toLowerCase();
                return dbName === cleanTag || dbName.includes(cleanTag) || cleanTag.includes(dbName);
            });
            if (sameNameDb) {
                targetDb = sameNameDb;
            }
        }

        // 4. Resolve Schema columns and map to parameter keys
        const schemaRes = await runQuery(`
            SELECT col_name, key_name FROM _av_schema WHERE av_id = ?
        `, [targetDb.avId]);

        if (schemaRes && schemaRes.values) {
            for (const schemaRow of schemaRes.values) {
                const colName = schemaRow[0];
                const keyName = schemaRow[1];
                const cellValue = targetDb.rowData[colName] ?? "";

                if (colName) params[colName] = cellValue;
                if (keyName) params[keyName] = cellValue;
            }
        }
    } catch (e) {
        console.error("[Layer4Params] Error resolving Layer 4 params:", e);
    }

    return params;
}
