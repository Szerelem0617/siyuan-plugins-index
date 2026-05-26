import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep } from "../../../shared/utils";
import { getTargetTablesInfo } from "../registration";

/**
 * Reverses detached database rows in Siyuan AV back into physical document list items,
 * and establishes the proper bidirectional block bindings.
 */
export async function reverseDbToList(): Promise<boolean> {
    try {
        showMessage("[IndexOS] 正在启动大纲模式逆向转换...", 2000);

        // 1. Fetch active Siyuan AV IDs
        const tablesInfo = await getTargetTablesInfo();
        if (!tablesInfo.isInitialized || !tablesInfo.commandsTable || !tablesInfo.typesTable) {
            showMessage("系统存储库尚未初始化，请先执行初始化", 4000, "error");
            return false;
        }

        // We extract the actual raw AV IDs from table names: e.g. "av_20260526215129_p3mezqy" -> "20260526215129-p3mezqy"
        const getAvIdFromTableName = (tbl: string) => {
            const parts = tbl.replace("av_", "").split("_");
            if (parts.length >= 2) {
                return `${parts[0]}-${parts[1]}`;
            }
            return tbl.replace("av_", "");
        };

        const commandAvId = getAvIdFromTableName(tablesInfo.commandsTable);
        const typeAvId = getAvIdFromTableName(tablesInfo.typesTable);

        console.log(`[IndexOS-Reverse] Detected active AVs: Command-DB=${commandAvId}, Type-DB=${typeAvId}`);

        // 2. Query document IDs of Command-DB and Type-DB
        const cmdSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`;
        const cmdDocs = await post("/api/query/sql", { stmt: cmdSql });
        if (!cmdDocs || cmdDocs.length === 0) {
            showMessage("未找到 逻辑工厂 (Command-DB) 的系统属性", 4000, "error");
            return false;
        }
        const cmdDocId = cmdDocs[0].root_id;

        const typeSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-type-db' LIMIT 1`;
        const typeDocs = await post("/api/query/sql", { stmt: typeSql });
        if (!typeDocs || typeDocs.length === 0) {
            showMessage("未找到 类型绑定 (Type-DB) 的系统属性", 4000, "error");
            return false;
        }
        const typeDocId = typeDocs[0].root_id;

        // 3. Process Command-DB (逻辑工厂)
        showMessage("[IndexOS] 正在构建逻辑工厂大纲列表...", 2000);
        const cmdSuccess = await processSingleDbReverse(commandAvId, cmdDocId, tablesInfo.commandLabelCol);
        if (!cmdSuccess) return false;

        // 4. Process Type-DB (类型绑定)
        showMessage("[IndexOS] 正在构建类型绑定大纲列表...", 2000);
        const typeSuccess = await processSingleDbReverse(typeAvId, typeDocId, tablesInfo.typeSupertagCol);
        if (!typeSuccess) return false;

        showMessage("🎉 大纲模式转换完成！", 3000);
        return true;

    } catch (e) {
        console.error("[IndexOS-Reverse] Reverse conversion failed:", e);
        showMessage(`逆向转换失败: ${(e as Error).message}`, 5000, "error");
        return false;
    }
}

async function processSingleDbReverse(avId: string, docId: string, labelColName: string): Promise<boolean> {
    // 1. Fetch AV structure and rows
    const renderRes = await post("/api/av/renderAttributeView", { id: avId });
    const view = renderRes.view || renderRes;
    const rows: any[] = view.rows || [];
    const columns: any[] = view.columns || [];

    if (rows.length === 0) {
        console.log(`[IndexOS-Reverse] AV ${avId} contains no rows, skipping.`);
        return true;
    }

    const labelColIdx = columns.findIndex((c: any) => c.name === labelColName || c.keyName === labelColName || c.keyID === labelColName);
    const pathColIdx = columns.findIndex((c: any) => c.name === "Path" || c.keyName === "Path" || c.keyID === "Path");
    const levelColIdx = columns.findIndex((c: any) => c.name === "Level" || c.keyName === "Level" || c.keyID === "Level");

    const getCellText = (row: any, idx: number): string => {
        if (idx < 0) return "";
        const cell = row.cells[idx];
        return cell?.value?.text?.content || cell?.value?.mText?.content || cell?.value?.block?.content || "";
    };

    const getCellNumber = (row: any, idx: number): number => {
        if (idx < 0) return 1;
        const cell = row.cells[idx];
        return cell?.value?.number?.content ?? 1;
    };

    // 2. Parse items and sort by Path to guarantee hierarchical order
    const items = rows.map(row => {
        const label = getCellText(row, labelColIdx) || row.cells[0]?.value?.block?.content || "";
        const path = getCellText(row, pathColIdx);
        const level = getCellNumber(row, levelColIdx);
        return {
            itemID: row.id,
            label: label.trim(),
            path: path,
            level: level
        };
    }).sort((a, b) => {
        const pathA = a.path || "";
        const pathB = b.path || "";
        return pathA.localeCompare(pathB);
    });

    // 3. Generate Markdown list
    let markdown = "";
    for (const item of items) {
        const path = item.path || "";
        const segments = path.split("/").filter(Boolean);
        const depth = Math.max(0, segments.length - 1);
        const indent = "    ".repeat(depth);
        markdown += `${indent}* ${item.label}\n`;
    }

    console.log(`[IndexOS-Reverse] Generated Markdown for ${avId}:\n`, markdown);

    // 4. Query document blocks to locate preceding block for AV block insertion
    const docBlocks = await client.sql({ stmt: `SELECT id, type FROM blocks WHERE root_id = '${docId}' ORDER BY sort ASC` });
    const blocksList = docBlocks.data || [];
    
    // Find the AV block ID
    const avBlock = blocksList.find((b: any) => b.type === "av");
    if (!avBlock) {
        console.warn(`[IndexOS-Reverse] NodeAttributeView block not found in document ${docId}.`);
        return false;
    }

    const avBlockId = avBlock.id;
    const avBlockIdx = blocksList.findIndex((b: any) => b.id === avBlockId);
    
    // Determine the preceding block. We want to insert the list right before the AV block
    let precedingBlockId = "";
    if (avBlockIdx > 0) {
        precedingBlockId = blocksList[avBlockIdx - 1].id;
    } else {
        // If AV is the first block, we insert it inside doc directly
        precedingBlockId = docId;
    }

    // 5. Delete any existing list blocks in the document to prevent duplicate outline lists
    const existingLists = blocksList.filter((b: any) => b.type === "l");
    for (const listBlock of existingLists) {
        console.log(`[IndexOS-Reverse] Deleting old list block ${listBlock.id}`);
        await post("/api/block/deleteBlock", { id: listBlock.id });
    }
    await sleep(500);

    // 6. Insert new Outline List
    console.log(`[IndexOS-Reverse] Inserting new list block before ${avBlockId}`);
    const insertRes = await client.insertBlock({
        dataType: "markdown",
        data: markdown,
        previousID: precedingBlockId
    });

    if (!insertRes.data || insertRes.data.length === 0) {
        throw new Error(`无法在大纲文档 ${docId} 中插入列表块`);
    }

    console.log("[IndexOS-Reverse] List block inserted. Waiting for index parsing...");
    await sleep(2000); // Wait for indexing to complete

    // 7. Query newly created list items in document
    const listItemsRes = await client.sql({
        stmt: `SELECT id, content FROM blocks WHERE root_id = '${docId}' AND type = 'li' ORDER BY sort ASC`
    });
    const newItems = listItemsRes.data || [];
    console.log(`[IndexOS-Reverse] Found ${newItems.length} list items in document ${docId}. Matches target rows count: ${items.length}`);

    // 8. Bind row IDs (itemID) to physical block IDs
    const bindOps: any[] = [];
    const savedMappingOps: any[] = [];
    
    for (const item of items) {
        // Match list item by label comparison
        const matchedBlock = newItems.find((b: any) => {
            const cleanContent = b.content.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
            return cleanContent.includes(item.label) || item.label.includes(cleanContent);
        });

        if (matchedBlock) {
            console.log(`[IndexOS-Reverse] Binding: Row "${item.label}" (itemID: ${item.itemID}) <-> Block ID ${matchedBlock.id}`);
            bindOps.push({
                itemID: item.itemID,
                id: matchedBlock.id,
                isDetached: false
            });
            savedMappingOps.push({
                id: matchedBlock.id,
                attrs: {
                    "custom-index-item-id": item.itemID
                }
            });
        } else {
            console.warn(`[IndexOS-Reverse] Could not find physical block match for row "${item.label}"`);
        }
    }

    // Execute AV block bindings
    if (bindOps.length > 0) {
        await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: bindOps });
        await sleep(300);
    }

    // Set custom-index-item-id attributes on list items
    if (savedMappingOps.length > 0) {
        await Promise.all(savedMappingOps.map(op => client.setBlockAttrs(op)));
    }

    // 9. Bind the main list block with linked AV attributes
    if (newItems.length > 0) {
        const firstListItemId = newItems[0].id;
        const parentListRes = await client.sql({
            stmt: `SELECT parent_id FROM blocks WHERE id = '${firstListItemId}' LIMIT 1`
        });
        if (parentListRes.data && parentListRes.data.length > 0) {
            const listBlockId = parentListRes.data[0].parent_id;
            console.log(`[IndexOS-Reverse] Binding parent list block ${listBlockId} with AV attributes...`);
            await client.setBlockAttrs({
                id: listBlockId,
                attrs: {
                    "custom-index-linked-av": avId,
                    "custom-index-linked-av-block": avBlockId
                }
            });
        }
    }

    return true;
}
