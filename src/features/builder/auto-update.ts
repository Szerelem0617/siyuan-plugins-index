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
    try {
        const match = block.ial.match(/custom-tree-create="([^"]*)"/);
        if (match && match[1]) {
             let val = match[1];
             // Robust decoding using DOM
             const txt = document.createElement("textarea");
             txt.innerHTML = val;
             val = txt.value;
             
             treeType = JSON.parse(val).treeType;
        } else {
             console.log(`[Builder] custom-tree-create attribute not found in IAL: ${block.ial}`);
        }
    } catch (e) {
        console.error("[Builder] Failed to parse tree attribute", e);
    }

    if (!treeType) {
        console.log(`[Builder] No treeType found for block ${block.id}`);
        return;
    }

    console.log(`[Builder] Auto-updating ${treeType} for block ${block.id} (Type: ${block.type})`);

    let actionType = "";
    if (treeType === "doc-tree") actionType = "PUSH_TO_DOC";
    else if (treeType === "heading-tree") actionType = "PUSH_TO_BOTTOM";
    else if (treeType === "composite-tree") actionType = "PUSH_COMBINED";
    else {
        console.warn(`[Builder] Unknown treeType: ${treeType}`);
        return;
    }

    try {
        const processor = new ListProcessor();
        let typeStr = "NodeList";
        if (block.type === 'i') typeStr = "NodeListItem";
        
        console.log(`[Builder] Starting ProcessRecursive. ID: ${block.id}, Type: ${typeStr}, Action: ${actionType}`);
        await processor.processRecursive(block.id, typeStr, actionType);
        console.log(`[Builder] Auto-update finished.`);
        
    } catch (e) {
        console.error("[Builder] Auto-update failed", e);
    }
}
