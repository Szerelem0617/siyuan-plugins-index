import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep, formatDate } from "../../../shared/utils";
import { getTargetTablesInfo } from "../registration";
import {
    ATTR_LINKED_AV,
    ATTR_LINKED_AV_BLOCK,
    ATTR_LINKED_LIST,
    ATTR_ITEM_ID,
    ATTR_LAST_SYNC
} from "../../../shared/constants";

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
    const docBlocks = await client.sql({ stmt: `SELECT id, type, parent_id FROM blocks WHERE root_id = '${docId}' ORDER BY sort ASC` });
    const blocksList = docBlocks.data || [];
    
    // Find the AV block ID
    const avBlock = blocksList.find((b: any) => b.type === "av");
    if (!avBlock) {
        console.warn(`[IndexOS-Reverse] NodeAttributeView block not found in document ${docId}.`);
        return false;
    }

    const avBlockId = avBlock.id;
    
    // 5. Delete any existing top-level list blocks in the document to prevent duplicate outline lists
    const existingLists = blocksList.filter((b: any) => b.type === "l" && b.parent_id === docId);
    for (const listBlock of existingLists) {
        console.log(`[IndexOS-Reverse] Deleting old list block ${listBlock.id}`);
        await post("/api/block/deleteBlock", { id: listBlock.id });
    }
    await sleep(500);

    // 6. Insert new Outline List right before the AV block (using nextID)
    console.log(`[IndexOS-Reverse] Inserting new list block before ${avBlockId}`);
    const insertRes = await client.insertBlock({
        dataType: "markdown",
        data: markdown,
        nextID: avBlockId
    });

    if (!insertRes.data || insertRes.data.length === 0) {
        throw new Error(`无法在大纲文档 ${docId} 中插入列表块`);
    }

    const listBlockId = insertRes.data[0].doOperations[0].id;
    console.log(`[IndexOS-Reverse] List block inserted with ID: ${listBlockId}. Waiting for backend parsing...`);
    await sleep(200);
    
    const domRes = await client.getBlockDOM({ id: listBlockId });
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = domRes.data?.dom || "";

    const newItems: { id: string, content: string }[] = [];
    const traverseDom = (el: Element) => {
        for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i];
            const type = child.getAttribute("data-type");
            if (type === "NodeListItem") {
                const itemId = child.getAttribute("data-node-id") || "";
                // Get the text content of the list item paragraph block
                const para = child.querySelector('div[data-type="NodeParagraph"]');
                const content = para ? (para.textContent || "").trim() : "";
                newItems.push({ id: itemId, content });
                traverseDom(child);
            } else {
                traverseDom(child);
            }
        }
    };
    if (tempDiv.firstElementChild) {
        traverseDom(tempDiv.firstElementChild);
    }

    console.log(`[IndexOS-Reverse] Parsed ${newItems.length} list items from DOM. Matches target rows count: ${items.length}`);

    // 8. Re-bind existing detached row IDs (itemID) to the brand new physical block IDs
    const replaceOps: any[] = [];
    const savedMappingOps: any[] = [];
    
    const normalize = (s: string) => (s || "").replace(/[\u200B-\u200D\uFEFF#\s]/g, "").toLowerCase();

    for (const item of items) {
        // Match list item by normalized label comparison (strips '#', spaces, hidden chars, and compares case-insensitively)
        const matchedBlock = newItems.find((b: any) => {
            const cleanContent = normalize(b.content);
            const cleanLabel = normalize(item.label);
            if (!cleanLabel) return false;
            return cleanContent.includes(cleanLabel) || cleanLabel.includes(cleanContent);
        });

        if (matchedBlock) {
            console.log(`[IndexOS-Reverse] Re-binding: Row "${item.label}" (itemID: ${item.itemID}) <-> Block ID ${matchedBlock.id}`);
            replaceOps.push({
                [item.itemID]: matchedBlock.id
            });
            savedMappingOps.push({
                id: matchedBlock.id,
                attrs: {
                    [ATTR_ITEM_ID]: item.itemID
                }
            });
        } else {
            console.warn(`[IndexOS-Reverse] Could not find physical block match for row "${item.label}"`);
        }
    }

    // Execute AV block replacements (re-bindings) via batchReplaceAttributeViewBlocks
    if (replaceOps.length > 0) {
        await post("/api/av/batchReplaceAttributeViewBlocks", {
            avID: avId,
            isDetached: false,
            oldNew: replaceOps
        });
        await sleep(300);
    }

    // Set custom-av-item-id attributes on the physical list items
    if (savedMappingOps.length > 0) {
        await Promise.all(savedMappingOps.map(op => client.setBlockAttrs(op)));
    }

    // 9. Bind the main list block with linked AV attributes, and the AV block with linked list
    if (listBlockId) {
        console.log(`[IndexOS-Reverse] Binding parent list block ${listBlockId} and AV block ${avBlockId}...`);
        
        const now = formatDate(new Date()).replace(/-/g, "").replace(/:/g, "").replace(/ /g, "");

        // Set attributes on list block
        await client.setBlockAttrs({
            id: listBlockId,
            attrs: {
                [ATTR_LINKED_AV]: avId,
                [ATTR_LINKED_AV_BLOCK]: avBlockId,
                [ATTR_LAST_SYNC]: now
            }
        });

        // Set attribute on AV database block
        await client.setBlockAttrs({
            id: avBlockId,
            attrs: {
                [ATTR_LINKED_LIST]: listBlockId
            }
        });
    }

    return true;
}

