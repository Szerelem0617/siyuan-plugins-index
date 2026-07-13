import { client } from "../../../shared/api-client";
import { Dialog, showMessage } from "siyuan";
import DbConfigDialog from "./db-config-dialog.svelte";
import { getColIDMap, buildAvHierarchy, resolveInheritance, isValueEmpty } from "../../../shared/utils/av-utils";
import { post } from "../../../shared/api-client/request";
import { formatDate, getAttrFromIAL, i18n } from "../../../shared/utils";
import { SUPERTAG_REGISTRY } from "../../command/registration";

export const ATTR_DB_CONFIG = "custom-index-db-config";

export type { DbConfig, TypeConfig, IDBTypeMapping, InheritanceRule } from "./types";
import { type DbConfig, type TypeConfig } from "./types";

// syncTypeToTypeDb logic removed to decouple Layer 4 from Layer 3.
// Configuration is now stored exclusively in block attributes and discovered via scanning.


export async function syncInheritanceToDb(avId: string, config: DbConfig, avBlockId?: string) {
    if (!config.inheritanceRules || config.inheritanceRules.length === 0) {
        return;
    }

    try {
        const colInfo = await getColIDMap(avId);
        const { blockToItem } = colInfo;
        const parentMap = await buildAvHierarchy(colInfo.keyValues, colInfo.itemToBlock);

        const allBlockIds = Array.from(blockToItem.keys());
        const updateOps: any[] = [];

        const getValStr = (v: any) => {
            if (!v) return "";
            if (typeof v === 'string') return v;
            return v.text?.content || v.number?.content || v.mOption?.[0]?.content || v.content || "";
        };

        for (const bid of allBlockIds) {
            for (const rule of config.inheritanceRules) {
                if (rule.mode === 'none') continue;

                const cellMap = colInfo.colToCells[rule.colId];
                if (!cellMap) continue;

                const cell = cellMap.get(bid);
                const resolvedVal = resolveInheritance(bid, rule.mode, cellMap, parentMap);

                if (!isValueEmpty(resolvedVal)) {
                    let isDifferent = false;
                    const localStr = getValStr(cell);
                    const resolvedStr = getValStr(resolvedVal);

                    if (!cell || isValueEmpty(cell)) {
                        isDifferent = true;
                    } else if (String(localStr) !== String(resolvedStr)) {
                        isDifferent = true;
                    }

                    if (isDifferent) {
                        updateOps.push({
                            keyID: rule.colId,
                            itemID: bid,
                            value: resolvedVal
                        });
                    }
                } else {
                    // console.log(`[Materialized-V3] Skip ${bid} Col ${rule.colId}: No inherited value found.`);
                }
            }
        }

        if (updateOps.length > 0) {
            // Use the authoritative mapping from Kernel
            const blockIDsToMap = Array.from(new Set(updateOps.map(op => op.itemID)));
            let idMap: Record<string, string> = {};
            
            try {
                const mappingRes = await post("/api/av/getAttributeViewItemIDsByBoundIDs", {
                    avID: avId,
                    blockIDs: blockIDsToMap
                });
                if (mappingRes && typeof mappingRes === "object") {
                    idMap = mappingRes as Record<string, string>;
                }
            } catch (e) {
                console.warn("[Materialized-V3] Kernel mapping failed, using local map", e);
            }

            const finalUpdateValues = updateOps.map(op => {
                // If kernel knows the Item ID, use it. Otherwise, fallback to local map or bid itself (for new rows)
                const mappedId = idMap[op.itemID] || blockToItem.get(op.itemID) || op.itemID;
                return { ...op, itemID: mappedId };
            });

            const chunkSize = 50;
            for (let i = 0; i < finalUpdateValues.length; i += chunkSize) {
                const chunk = finalUpdateValues.slice(i, i + chunkSize);
                await post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: avId,
                    values: chunk
                });
            }

            if (avBlockId) {
                await post("/api/transactions", {
                    app: "plugin-index",
                    reqId: Date.now(),
                    transactions: [{
                        doOperations: [{
                            action: "doUpdateUpdated",
                            id: avBlockId,
                            data: formatDate(new Date())
                        }]
                    }]
                });
            }
            return finalUpdateValues.length;
        }
        return 0;
    } catch (e) {
        console.error("[Materialized Sync] Fatal Error", e);
        throw e;
    }
}

export async function loadDbConfig(blockId: string): Promise<DbConfig> {
    try {
        const attrsRes = await client.getBlockAttrs({ id: blockId });
        const configStr = attrsRes.data?.[ATTR_DB_CONFIG];
        if (configStr) {
            return JSON.parse(configStr);
        }
    } catch (e) {
        console.error("Failed to load DB config", e);
    }
    return { typeMappings: [], inheritanceRules: [] };
}

export async function saveDbConfig(blockId: string, config: DbConfig) {
    try {
        await client.setBlockAttrs({
            id: blockId,
            attrs: { [ATTR_DB_CONFIG]: JSON.stringify(config) }
        });
        window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));
    } catch (e) {
        console.error("Failed to save DB config", e);
    }
}

export async function resetDbConfig(blockId: string, avId: string) {
    try {
        // Clear metadata
        await client.setBlockAttrs({
            id: blockId,
            attrs: { [ATTR_DB_CONFIG]: "" }
        });

        window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));
        showMessage(i18n.dbConfig.resetSuccess);
    } catch (e) {
        console.error("Failed to reset DB config", e);
    }
}

export async function setColumnWeakInheritance(avId: string, colId: string, avBlockId: string) {
    try {
        console.log(`[DbConfig] Setting column ${colId} to weak inheritance`);
        const config = await loadDbConfig(avBlockId);

        if (!config.inheritanceRules) {
            config.inheritanceRules = [];
        }

        const existingRuleIndex = config.inheritanceRules.findIndex(r => r.colId === colId);
        if (existingRuleIndex !== -1) {
            config.inheritanceRules[existingRuleIndex].mode = "weak";
        } else {
            config.inheritanceRules.push({ colId, mode: "weak" });
        }

        await saveDbConfig(avBlockId, config);

        const updatedCount = await syncInheritanceToDb(avId, config, avBlockId);

        return updatedCount;
    } catch (e) {
        console.error("[DbConfig] Failed to set weak inheritance", e);
        throw e;
    }
}

/**
 * Retrieves all type mappings across the entire workspace.
 * Used for uniqueness validation and Supertag resolution.
 */
export async function getGlobalTypeConfigs(): Promise<TypeConfig[]> {
    try {
        const stmt = `SELECT id, name, content, ial FROM blocks WHERE ial LIKE '%${ATTR_DB_CONFIG}="%'`;
        const res = await client.sql({ stmt });
        const configs: TypeConfig[] = [];
        const avNameCache = new Map<string, string>();

        if (res.data) {
            for (const row of res.data) {
                const configStr = getAttrFromIAL(row.ial, ATTR_DB_CONFIG);
                // The actual name of the AV could be in row.name or as a block attribute
                const blockAttr = getAttrFromIAL(row.ial, "name") || getAttrFromIAL(row.ial, "custom-av-name") || "";

                let dbName = row.name || blockAttr || "";

                if (configStr) {
                    try {
                        const config: DbConfig = JSON.parse(configStr);
                        const targetAvId = config.avId || row.id;

                        // Helper to resolve the DB name dynamically
                        const resolveDBName = async () => {
                            let finalAvName = dbName;
                            if (!finalAvName) {
                                if (avNameCache.has(targetAvId)) {
                                    finalAvName = avNameCache.get(targetAvId) || "";
                                } else {
                                    try {
                                        const renderRes = await post("/api/av/renderAttributeView", { id: targetAvId });
                                        finalAvName = renderRes?.name || "";
                                        avNameCache.set(targetAvId, finalAvName);
                                    } catch (e) {
                                        avNameCache.set(targetAvId, "");
                                    }
                                }
                            }
                            return finalAvName;
                        };

                        if (config.mode !== "multi" && config.singleClassName) {
                            // Single mode
                            const finalAvName = await resolveDBName();
                            configs.push({
                                typeName: config.singleClassName,
                                avId: targetAvId,
                                blockId: row.id,
                                typeFieldId: undefined,
                                mappedValue: undefined,
                                avName: finalAvName
                            });
                        } else if (config.mode === "multi" || (config.typeMappings && config.typeFieldId)) {
                            // Multi mode (or legacy with no mode explicitly set but has mappings)
                            if (config.typeMappings && config.typeFieldId) {
                                for (const m of config.typeMappings) {
                                    if (m.name) {
                                        const finalAvName = await resolveDBName();
                                        configs.push({
                                            typeName: m.name,
                                            avId: targetAvId, // Fallback to blockId if avId not set
                                            blockId: row.id,
                                            typeFieldId: config.typeFieldId,
                                            mappedValue: m.value,
                                            avName: finalAvName
                                        });
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error("Failed to parse DB config for block:", row.id, e);
                    }
                }
            }
        }

        // Fallback: Scan all databases ('av' blocks) and match their names against SUPERTAG_REGISTRY tags
        try {
            const allAvBlocks = await client.sql({ stmt: "SELECT id, name, content, ial FROM blocks WHERE type = 'av'" });
            if (allAvBlocks && allAvBlocks.data) {
                for (const avRow of allAvBlocks.data) {
                    const avId = avRow.id;
                    const hasExisting = configs.some(c => c.avId === avId);
                    if (hasExisting) continue;

                    const blockName = avRow.name || getAttrFromIAL(avRow.ial, "name") || getAttrFromIAL(avRow.ial, "custom-av-name") || "";
                    if (!blockName) continue;

                    const cleanDbName = blockName.trim().toLowerCase();

                    const uniqueTags = new Set(SUPERTAG_REGISTRY.map(item => item.typeTag.trim().toLowerCase()));
                    for (const tag of uniqueTags) {
                        if (tag === cleanDbName || cleanDbName.includes(tag) || tag.includes(cleanDbName)) {
                            console.log(`[Supertag-Fallback] Found unregistered AV "${blockName}" (${avId}) matching tag "${tag}". Auto-registering config mapping.`);
                            configs.push({
                                typeName: tag,
                                avId: avId,
                                blockId: avRow.id,
                                avName: blockName
                            });
                        }
                    }
                }
            }
        } catch (fallbackErr) {
            console.error("[Supertag-Fallback] Failed to run database scan fallback:", fallbackErr);
        }

        return configs;
    } catch (e) {
        console.error("Failed to get global type configs", e);
        return [];
    }
}

export async function scanColumnValues(blockId: string, colId: string, colName: string): Promise<string[]> {
    try {
        // 1. Get Root ID
        const rootRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${blockId}'` });
        const rootId = rootRes.data?.[0]?.root_id;

        if (!rootId) {
            console.warn("[DbConfig] Could not determine root_id for block:", blockId);
            return [];
        }

        console.log(`[DbConfig] Scanning document (root_id: ${rootId}) for column: ${colName} (${colId})`);

        // 2. Scan blocks
        const stmt = `SELECT ial, markdown FROM blocks WHERE root_id = '${rootId}' LIMIT 2000`;
        const res = await client.sql({ stmt });

        const values = new Set<string>();
        const potentialKeys = [
            `custom-${colId}`,
            `custom-${colName.toLowerCase()}`,
            `custom-${colName}`,
            colName.toLowerCase(), // e.g. "level", "icon"
            colId
        ];

        console.log("[DbConfig] Checking for attribute keys:", potentialKeys);

        let sampleCount = 0;
        const debugKeys = new Set<string>();

        res.data?.forEach((row: any) => {
            if (!row.ial) return;

            // Debug: Collect keys from first 10 non-empty blocks
            if (sampleCount < 10) {
                const keys = row.ial.match(/[\w-]+=/g)?.map((k: string) => k.slice(0, -1));
                if (keys) keys.forEach((k: string) => debugKeys.add(k));
                sampleCount++;
            }

            // Iterate potential keys to find a match
            for (const key of potentialKeys) {
                const val = getAttrFromIAL(row.ial, key);
                if (val) {
                    values.add(val);
                }
            }

            // Special handling for "Icon" in markdown if column name is Icon
            if (colName.toLowerCase() === "icon") {
                const emojiMatch = row.markdown?.match(/^(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation})/u);
                if (emojiMatch) values.add(emojiMatch[1]);
            }
        });

        console.log("[DbConfig] DEBUG: Sample Attribute Keys found in first 10 blocks:", Array.from(debugKeys));

        const result = Array.from(values).filter(v => v !== "").sort((a, b) => {
            const numA = parseFloat(a);
            const numB = parseFloat(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });

        console.log(`[DbConfig] Scanned ${result.length} unique values for '${colName}'`);
        return result;

    } catch (e) {
        console.error("Failed to scan column values", e);
        return [];
    }
}

export async function openDbConfigDialog(avId: string, blockId: string) {
    // blockId is the node ID bound to the AV (likely the database block itself or a parent)
    // Actually, usually the AV is just a view, the "Database" is loosely defined. 
    // But here we are storing config on the `blockId` passed from the event (avBlockID).

    // We need column info for the UI
    const colInfo = await getColIDMap(avId);
    // colInfo: { nameToID: {...}, keyValues: [...] }
    // We want a list of { id, name, type }

    const columns = [];

    // 1. Add AV Columns and check for pinned names
    if (colInfo?.keyValues) {
        let isFirst = true;
        for (const kv of colInfo.keyValues) {
            const nameLower = kv.key.name.toLowerCase();
            const isPinned = nameLower === "level" || nameLower === "icon";

            columns.push({
                id: kv.key.id,
                name: kv.key.name,
                type: kv.key.type,
                values: kv.values, // Potential values for type mapping
                isPrimary: isFirst,
                isPinned: isPinned
            });
            isFirst = false;
        }
    }



    const currentConfig = await loadDbConfig(blockId);

    const dialog = new Dialog({
        title: i18n.dbConfig.dialogTitle,
        content: `<div class="b3-dialog__content" id="db-config-container"></div>`,
        width: "600px",
        height: "600px",
    });

    new DbConfigDialog({
        target: dialog.element.querySelector("#db-config-container"),
        props: {
            avId,
            blockId,
            currentConfig,
            columns,
            dialog
        }
    });
}
