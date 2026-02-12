import { client } from "../../../shared/api-client";
import { Dialog } from "siyuan";
import DbConfigDialog from "./db-config-dialog.svelte";
import { getColIDMap } from "../../../shared/utils/av-utils";

export const ATTR_DB_CONFIG = "custom-index-db-config";

export interface InheritanceRule {
    colId: string;
    mode: "none" | "weak" | "strong"; // weak: fill if empty; strong: overwrite
}

export interface TypeMapping {
    value: string; // The raw value from the source column
    name: string;  // The user-defined display name/type name
}

export interface DbConfig {
    typeFieldId?: string; // Column ID used to determine type
    typeMappings?: TypeMapping[]; // Mappings for values -> type names
    inheritanceRules?: InheritanceRule[];
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
    } catch (e) {
        console.error("Failed to save DB config", e);
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

            // Simple regex to find key="value"
            // We iterate potential keys to find a match
            for (const key of potentialKeys) {
                // Regex: key="value" or key='value'
                // We need to escape the key for regex
                const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const regex = new RegExp(`(?:\\s|^)${escapedKey}=["']([^"']*)["']`, "i");
                const match = row.ial.match(regex);
                if (match) {
                    values.add(match[1]);
                    // Found a value for this row, stop checking other keys for this row? 
                    // Maybe multiple keys exist? Usually just one is primary.
                    // Let's collect all possible values.
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
        title: "数据库高级设置 (Database Advanced Settings)",
        content: `<div class="b3-dialog__content" id="db-config-container"></div>`,
        width: "600px",
        height: "600px",
    });

    new DbConfigDialog({
        target: dialog.element.querySelector("#db-config-container"),
        props: {
            blockId,
            currentConfig,
            columns,
            dialog
        }
    });
}
