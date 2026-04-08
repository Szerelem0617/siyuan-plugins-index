import { client } from "../../../shared/api-client";
import { Dialog, showMessage } from "siyuan";
import DbConfigDialog from "./db-config-dialog.svelte";
import { getColIDMap, buildAvHierarchy, resolveInheritance, isValueEmpty } from "../../../shared/utils/av-utils";
import { post } from "../../../shared/api-client/request";
import { formatDate, getAttrFromIAL, i18n } from "../../../shared/utils";

export const ATTR_DB_CONFIG = "custom-index-db-config";

export type { DbConfig, TypeConfig, IDBTypeMapping, InheritanceRule } from "./types";
import { type DbConfig, type TypeConfig } from "./types";

/**
 * 核心批量同步逻辑：已大幅优化至 O(Rows * Rules) 复杂度
 */
export async function syncInheritanceToDb(avId: string, config: DbConfig, avBlockId?: string) {
    if (!config.inheritanceRules || config.inheritanceRules.length === 0) {
        return;
    }

    try {
        console.log(`[Materialized Sync] Starting indexed sync for AV: ${avId}`);
        const colInfo = await getColIDMap(avId);
        await buildAvHierarchy(colInfo);

        const allBlockIds = Array.from(colInfo.cellMap.keys());
        console.log(`[Materialized Sync] Fast-processing ${allBlockIds.length} blocks...`);

        const updateOps: any[] = [];

        const getValStr = (v: any) => {
            if (!v) return "";
            if (typeof v === 'string') return v;
            return v.text?.content || v.number?.content || v.mOption?.[0]?.content || v.content || "";
        };

        for (const bid of allBlockIds) {
            const rowData = colInfo.cellMap.get(bid);
            if (!rowData) continue;

            for (const rule of config.inheritanceRules) {
                if (rule.mode === 'none' || !rule.mode) continue;

                const cell = rowData.get(rule.colId);
                const resolvedVal = resolveInheritance(bid, rule.colId, rule.mode, colInfo);

                if (!isValueEmpty(resolvedVal)) {
                    let isDifferent = false;
                    if (!cell || isValueEmpty(cell)) {
                        isDifferent = true;
                    } else {
                        const localStr = getValStr(cell);
                        const resolvedStr = getValStr(resolvedVal);
                        if (String(localStr) !== String(resolvedStr)) {
                            isDifferent = true;
                        }
                    }

                    if (isDifferent) {
                        updateOps.push({
                            keyID: rule.colId,
                            itemID: bid,
                            value: resolvedVal
                        });
                    }
                }
            }
        }

        if (updateOps.length > 0) {
            console.log(`[Materialized Sync] Committing ${updateOps.length} updates.`);
            await post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID: avId,
                values: updateOps
            });

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
            return updateOps.length;
        }
        return 0;
    } catch (e) {
        console.error("[Materialized Sync] Failed", e);
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
        const config = await loadDbConfig(avBlockId);
        if (!config.inheritanceRules) config.inheritanceRules = [];

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
        throw e;
    }
}

export async function getGlobalTypeConfigs(): Promise<TypeConfig[]> {
    try {
        const stmt = `SELECT id, name, content, ial FROM blocks WHERE ial LIKE '%${ATTR_DB_CONFIG}="%'`;
        const res = await client.sql({ stmt });
        const configs: TypeConfig[] = [];
        const avNameCache = new Map<string, string>();

        if (res.data) {
            for (const row of res.data) {
                const configStr = getAttrFromIAL(row.ial, ATTR_DB_CONFIG);
                const blockAttr = getAttrFromIAL(row.ial, "name") || getAttrFromIAL(row.ial, "custom-av-name") || "";
                let dbName = row.name || blockAttr || "";

                if (configStr) {
                    try {
                        const config: DbConfig = JSON.parse(configStr);
                        const targetAvId = config.avId || row.id;

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
                            if (config.typeMappings && config.typeFieldId) {
                                for (const m of config.typeMappings) {
                                    if (m.name) {
                                        const finalAvName = await resolveDBName();
                                        configs.push({
                                            typeName: m.name,
                                            avId: targetAvId,
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
                        console.error("Failed to parse DB config", row.id, e);
                    }
                }
            }
        }
        return configs;
    } catch (e) {
        console.error("Failed to get global type configs", e);
        return [];
    }
}

export async function scanColumnValues(blockId: string, colId: string, colName: string): Promise<string[]> {
    try {
        const rootRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${blockId}'` });
        const rootId = rootRes.data?.[0]?.root_id;
        if (!rootId) return [];

        const stmt = `SELECT ial, markdown FROM blocks WHERE root_id = '${rootId}' LIMIT 2000`;
        const res = await client.sql({ stmt });

        const values = new Set<string>();
        const potentialKeys = [
            `custom-${colId}`,
            `custom-${colName.toLowerCase()}`,
            `custom-${colName}`,
            colName.toLowerCase(), 
            colId
        ];

        res.data?.forEach((row: any) => {
            if (!row.ial) return;
            for (const key of potentialKeys) {
                const val = getAttrFromIAL(row.ial, key);
                if (val) values.add(val);
            }
            if (colName.toLowerCase() === "icon") {
                const emojiMatch = row.markdown?.match(/^(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation})/u);
                if (emojiMatch) values.add(emojiMatch[1]);
            }
        });

        return Array.from(values).filter(v => v !== "").sort((a, b) => {
            const numA = parseFloat(a);
            const numB = parseFloat(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });
    } catch (e) {
        return [];
    }
}

export async function openDbConfigDialog(avId: string, blockId: string) {
    const colInfo = await getColIDMap(avId);
    const columns = colInfo.keyValues.map((kv: any, index: number) => {
        const nameLower = kv.key.name.toLowerCase();
        return {
            id: kv.key.id,
            name: kv.key.name,
            type: kv.key.type,
            values: kv.values,
            isPrimary: index === 0,
            isPinned: ["level", "icon", "path", "father"].includes(nameLower)
        };
    });

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
