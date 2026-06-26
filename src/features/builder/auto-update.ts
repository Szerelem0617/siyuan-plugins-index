import { client } from "../../shared/api-client";
import { ListProcessor } from "./builder";

export async function autoUpdateBuilder(parentId: string, existingBlock?: any) {
    let block = existingBlock;

    if (!block) {
        let rs = await client.sql({
            stmt: `SELECT id, type, ial FROM blocks WHERE root_id = '${parentId}' AND ial like '%custom-tree-create%' order by updated desc limit 1`
        });
        if (rs.data && rs.data[0]) {
            block = rs.data[0];
        }
    }

    if (!block) return;

    // Parse attribute
    let treeType = null;
    let localAutoUpdate = undefined;

    try {
        const attrsRes = await client.getBlockAttrs({ id: block.id });
        const valRaw = attrsRes.data ? attrsRes.data["custom-tree-create"] : null;

        if (valRaw) {
            let val = valRaw;

            // Cleanup potential quoted mangling (both single and double)
            if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith("\"") && val.endsWith("\""))) {
                val = val.substring(1, val.length - 1);
            }

            try {
                let jsonToParse = val.trim();
                // Fix potential unquoted keys: {treeType: ...} -> {"treeType": ...}
                if (jsonToParse.startsWith("{") && !jsonToParse.includes("\"")) {
                    jsonToParse = jsonToParse.replace(/([{,]\s*)([a-zA-Z0-9_\-]+)\s*:/g, '$1"$2":');
                }

                const data = JSON.parse(jsonToParse);
                treeType = data.treeType;
                localAutoUpdate = data.builderAutoUpdate;
                console.log(`[Builder] Triggered: type=${treeType}, autoUpdate=${localAutoUpdate}`);
            } catch (je) {
                // Second attempt: old raw string format
                if (val === "doc-tree" || val === "heading-tree" || val === "composite-tree") {
                    treeType = val;
                } else {
                    console.warn(`[Builder] Failed to parse JSON or fallback: ${val}`);
                    throw je;
                }
            }
        }
    } catch (e) {
        console.error("[Builder] Failed to parse tree attribute", e);
    }

    // Check Auto Update Settings
    // Respect only local setting. If missing, assume true if the attribute exists.
    if (localAutoUpdate === false) {
        return;
    }

    if (!treeType) {
        // console.log(`[Builder] No treeType found for block ${block.id}`);
        return;
    }

    // console.log(`[Builder] Auto-updating ${treeType} for block ${block.id} (Type: ${block.type})`);

    let actionType = "";
    if (treeType === "doc-tree") actionType = "PUSH_TO_DOC";
    else if (treeType === "heading-tree") actionType = "PUSH_TO_BOTTOM";
    else if (treeType === "composite-tree") actionType = "PUSH_COMBINED";
    else {
        // console.warn(`[Builder] Unknown treeType: ${treeType}`);
        return;
    }

    try {
        const processor = new ListProcessor();
        let typeStr = "NodeList";
        if (block.type === 'i') typeStr = "NodeListItem";

        if (treeType === "composite-tree") {
            // Two-pass update to ensure stable indexing with a minimal delay
            await processor.processRecursive(block.id, typeStr, "PUSH_TO_BOTTOM");
            await new Promise(resolve => setTimeout(resolve, 100)); // 0.1s delay
            await processor.processRecursive(block.id, typeStr, "PUSH_TO_DOC");
        } else {
            await processor.processRecursive(block.id, typeStr, actionType);
        }

    } catch (e) {
        console.error("[Builder] Auto-update failed", e);
    }
}
