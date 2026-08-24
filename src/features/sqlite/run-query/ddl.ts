import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { executeCreateView, executeAlterView } from "./view";
import { 
    resolveTableAvId, 
    avIdToTableName, 
    registerFriendlyTableName, 
    instantiateAV, 
    avIdToBlockIdMap, 
    tableSyncTimes, 
    instantiatedAvIdsCache,
    friendlyTableNameMap
} from "../sqlite-manager";

export async function triggerAvBlockRender(avID: string) {
    const blockIds = new Set<string>();
    
    // Find all blocks referencing this avID
    const sqlFind = `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avID}%' OR ial LIKE '%${avID}%')`;
    const res = await post("/api/query/sql", { stmt: sqlFind });
    if (res && res.length > 0) {
        for (const row of res) {
            blockIds.add(row.id);
        }
    }
    
    // Include cached block ID if present
    const cachedBlockId = avIdToBlockIdMap.get(avID);
    if (cachedBlockId) {
        blockIds.add(cachedBlockId);
    }
    
    if (blockIds.size > 0) {
        console.log(`[SQLiteManager] Found ${blockIds.size} AV blocks to trigger re-render for avID ${avID}:`, Array.from(blockIds));
        
        const formatDateStr = (date: Date) => {
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        };
        
        for (const avBlockId of blockIds) {
            // Toggle the block type to a paragraph first to force Siyuan editor to unmount the AV widget
            console.log(`[SQLiteManager] Force reloading columns by toggling block ${avBlockId}`);
            await post("/api/block/updateBlock", {
                id: avBlockId,
                dataType: "markdown",
                data: `<p>Refreshing Database UI...</p>`
            });
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
        
        for (const avBlockId of blockIds) {
            // Then set it back to the Attribute View block
            await post("/api/block/updateBlock", {
                id: avBlockId,
                dataType: "markdown",
                data: `<div data-type="NodeAttributeView" data-av-type="table" data-av-id="${avID}"></div>`
            });
            
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{
                    doOperations: [{
                        action: "doUpdateUpdated",
                        id: avBlockId,
                        data: formatDateStr(new Date())
                    }]
                }]
            });
            console.log(`[SQLiteManager] Triggered unmount/remount re-render of block ${avBlockId} for avID ${avID}`);
        }
    } else {
        console.warn(`[SQLiteManager] Failed to find any block ID for avID ${avID} to trigger re-render`);
    }
}

export interface DDLOptions {
    /** Target document ID to create the AV in. If omitted, uses the current active editor document. */
    targetDocId?: string;
    /** Insert the AV block after this specific block ID (uses insertBlock instead of appendBlock). */
    insertAfterBlockId?: string;
}

export async function executeDDL(processedSql: string, db: any, options?: DDLOptions): Promise<any> {
    // ─── 0. CREATE/ALTER VIEW Statement ───
    const viewRes = await executeCreateView(processedSql, db, options);
    if (viewRes !== null) {
        return viewRes;
    }
    const alterViewRes = await executeAlterView(processedSql, db, options);
    if (alterViewRes !== null) {
        return alterViewRes;
    }

    // ─── 1. CREATE TABLE Statement ───
    const createMatch = processedSql.match(/^\s*CREATE\s+TABLE\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s*\((.+?)\)\s*;?\s*$/is);
    if (createMatch) {
        const tableName = createMatch[1];
        const columnsDef = createMatch[2];
        
        // 1. Check if table already exists
        const existingAvID = resolveTableAvId(tableName);
        if (existingAvID) throw new Error(`Table '${tableName}' already exists.`);
        
        // 2. Determine insertion target
        let appendRes: any;
        const avMarkdown = `<div data-type="NodeAttributeView" data-av-type="table"></div>`;
        
        if (options?.insertAfterBlockId) {
            // Insert after a specific block
            console.log(`[SQLiteManager] Inserting AV block after block: ${options.insertAfterBlockId}`);
            appendRes = await post("/api/block/insertBlock", {
                previousID: options.insertAfterBlockId,
                dataType: "markdown",
                data: avMarkdown
            });
        } else {
            // Append at the bottom of a document
            let docId = options?.targetDocId || "";
            
            if (!docId) {
                // Auto-detect from active editor
                let protyle = (window as any).siyuan.editor?.currentEditor?.protyle;
                if (!protyle) {
                    const findProtyle = (layout: any): any => {
                        if (!layout) return null;
                        if (layout.model?.editor?.protyle) return layout.model.editor.protyle;
                        if (layout.children) {
                            for (const child of layout.children) {
                                const res = findProtyle(child);
                                if (res) return res;
                            }
                        }
                        return null;
                    };
                    protyle = findProtyle((window as any).siyuan.layout.centerLayout);
                }
                
                if (protyle && protyle.block && protyle.block.rootID) {
                    docId = protyle.block.rootID;
                } else {
                    const fallbackRes = await post("/api/query/sql", { stmt: "SELECT root_id FROM blocks LIMIT 1" });
                    if (fallbackRes && fallbackRes.length > 0) {
                        docId = fallbackRes[0].root_id;
                    }
                }
            }
            
            if (!docId) {
                throw new Error("No target document specified and no active document found. Pass options.targetDocId or options.insertAfterBlockId.");
            }
            
            console.log(`[SQLiteManager] Appending AV block at the bottom of document: ${docId}`);
            appendRes = await post("/api/block/appendBlock", {
                parentID: docId,
                dataType: "markdown",
                data: avMarkdown
            });
        }
        
        if (!appendRes || !appendRes[0]?.doOperations) {
            throw new Error(`Failed to create AV block in Siyuan.`);
        }
        
        const ops = appendRes[0].doOperations;
        console.log(`[SQLiteManager] Append block operations:`, JSON.stringify(ops, null, 2));
        
        let avBlockId = "";
        let avId = "";
        
        // Try to extract avBlockId and avId (data-av-id) directly from the returned operations HTML
        for (const op of ops) {
            if (op.data && op.data.includes("NodeAttributeView")) {
                const avDivMatch = op.data.match(/<div[^>]*data-type=["']NodeAttributeView["'][^>]*>/);
                if (avDivMatch) {
                    const divHtml = avDivMatch[0];
                    const nodeMatch = divHtml.match(/data-node-id=["']([^"']+)["']/);
                    if (nodeMatch && nodeMatch[1]) {
                        avBlockId = nodeMatch[1];
                        console.log(`[SQLiteManager] Extracted correct avBlockId from NodeAttributeView div: ${avBlockId}`);
                    }
                }
                
                if (!avBlockId) {
                    avBlockId = op.id;
                }
                
                const match = op.data.match(/data-av-id=["']([^"']+)["']/);
                if (match && match[1]) {
                    avId = match[1];
                    console.log(`[SQLiteManager] Successfully extracted avId from operations data: ${avId}`);
                }
                break;
            }
        }
        
        if (!avBlockId && ops.length > 0) {
            avBlockId = ops[ops.length - 1].id;
        }
        
        if (!avBlockId) {
            throw new Error("Failed to extract AV block ID from append operations.");
        }
        console.log(`[SQLiteManager] Appended AV block ID: ${avBlockId}`);
        
        // Fallback: If avId was not in operation data, query the block DOM
        if (!avId) {
            console.log(`[SQLiteManager] avId not found in operations data. Querying block DOM for AV block ${avBlockId}...`);
            const domRes = await client.getBlockDOM({ id: avBlockId });
            const html = domRes.data?.dom || "";
            const match = html.match(/data-av-id=["']([^"']+)["']/);
            if (match && match[1]) {
                avId = match[1];
                console.log(`[SQLiteManager] Extracted avId from initial DOM: ${avId}`);
            }
        }
        
        // Fallback 2: Trigger render and poll DOM
        if (!avId) {
            console.log(`[SQLiteManager] data-av-id not found in initial DOM. Triggering initialization with renderAttributeView on block ${avBlockId}...`);
            await post("/api/av/renderAttributeView", { id: avBlockId });
            
            for (let attempt = 1; attempt <= 10; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                console.log(`[SQLiteManager] Re-fetching block DOM to extract data-av-id (attempt ${attempt})...`);
                const domRes = await client.getBlockDOM({ id: avBlockId });
                const html = domRes.data?.dom || "";
                const match = html.match(/data-av-id=["']([^"']+)["']/);
                if (match && match[1]) {
                    avId = match[1];
                    console.log(`[SQLiteManager] Successfully extracted generated avID: ${avId} on attempt ${attempt}`);
                    break;
                }
            }
        }
        
        if (!avId) {
            throw new Error(`Failed to extract data-av-id for AV block ${avBlockId}. Cannot perform DDL operations on an uninitialized table.`);
        }
        
        // Ensure it's fully rendered and initialized using the final avId
        console.log(`[SQLiteManager] Final rendering and initializing of Attribute View with avID: ${avId}`);
        const initData = await post("/api/av/renderAttributeView", {
            id: avId,
            page: 1,
            pageSize: 20
        });
        console.log(`[SQLiteManager] renderAttributeView response:`, initData);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 6. Parse and create columns (ignoring commas inside parentheses)
        const colDefs: string[] = [];
        let currentDef = "";
        let parenDepth = 0;
        let inQuoteChar = "";
        
        for (let i = 0; i < columnsDef.length; i++) {
            const char = columnsDef[i];
            if (inQuoteChar) {
                if (char === inQuoteChar) {
                    inQuoteChar = "";
                }
                currentDef += char;
            } else if (char === "'" || char === '"' || char === "`") {
                inQuoteChar = char;
                currentDef += char;
            } else if (char === "(") {
                parenDepth++;
                currentDef += char;
            } else if (char === ")") {
                parenDepth--;
                currentDef += char;
            } else if (char === "," && parenDepth === 0) {
                colDefs.push(currentDef.trim());
                currentDef = "";
            } else {
                currentDef += char;
            }
        }
        if (currentDef.trim()) {
            colDefs.push(currentDef.trim());
        }
        
        console.log(`[SQLiteManager] Parsed column definitions:`, colDefs);
        
        const parsedCols: { name: string; type: string; options: string[]; refTable: string | null }[] = [];
        for (const colDef of colDefs) {
            const trimmed = colDef.trim();
            const matchDef = trimmed.match(/^(?:["`']([^"`']+?)["`']|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+([a-zA-Z]+)(?:\((.+?)\))?(?:\s+REFERENCES\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5\s]+)["`']?)?/i);
            if (!matchDef) {
                console.warn(`[SQLiteManager] Failed to match column definition: "${trimmed}"`);
                continue;
            }
            
            const colName = matchDef[1] || matchDef[2];
            const rawType = matchDef[3].toLowerCase();
            const paramsStr = matchDef[4];
            const refTable = matchDef[5] || null;
            
            let colType = "text";
            const validTypes = ["block", "text", "number", "select", "mselect", "date", "checkbox", "relation", "masset", "rollup", "template", "created", "updated", "url", "email", "phone", "linenumber"];
            if (validTypes.includes(rawType)) {
                if (rawType === "mselect") colType = "mSelect";
                else if (rawType === "masset") colType = "mAsset";
                else if (rawType === "linenumber") colType = "lineNumber";
                else colType = rawType;
            }
            
            let options: string[] = [];
            if (paramsStr && (colType === "select" || colType === "mSelect")) {
                options = paramsStr.split(",").map(o => o.trim().replace(/^['"`]|['"`]$/g, ""));
            }
            
            parsedCols.push({ name: colName, type: colType, options, refTable });
        }
        
        console.log(`[SQLiteManager] Final parsed columns schema:`, parsedCols);
        
        // 7. Apply columns to Siyuan
        let checkKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
        let checkKeys = Array.isArray(checkKeysRes) ? checkKeysRes : (checkKeysRes.keys || []);
        console.log(`[SQLiteManager] Initial columns in AV:`, checkKeys);
        
        // Remove default select column if it exists (usually added by Siyuan by default)
        const defaultSelectCol = checkKeys.find((k: any) => k.type === "select");
        if (defaultSelectCol) {
            console.log(`[SQLiteManager] Removing Siyuan default select column: ${defaultSelectCol.name} (${defaultSelectCol.id})`);
            const removeRes = await post("/api/av/removeAttributeViewKey", {
                avID: avId,
                keyID: defaultSelectCol.id
            });
            console.log(`[SQLiteManager] Remove default select column response:`, removeRes);
            
            // Re-fetch to get updated list of columns
            checkKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
            checkKeys = Array.isArray(checkKeysRes) ? checkKeysRes : (checkKeysRes.keys || []);
            console.log(`[SQLiteManager] Columns in AV after deleting default select column:`, checkKeys);
        }
        
        const primaryKeyCol = checkKeys.find((k: any) => k.type === "block" || k.name === "主键");
        let lastKeyID = checkKeys.length > 0 ? checkKeys[checkKeys.length - 1].id : "";
        
        let startIndex = 0;
        if (parsedCols.length > 0 && parsedCols[0].type === "block" && primaryKeyCol) {
            const selfName = parsedCols[0].name;
            const selfKeyId = primaryKeyCol.id;
            console.log(`[SQLiteManager] Renaming Siyuan primary key column to: ${selfName} (ID: ${selfKeyId})`);
            const renameRes = await post("/api/transactions", {
                reqId: Date.now(),
                app: "plugin-index",
                transactions: [{
                    doOperations: [{
                        action: "updateAttrViewCol",
                        avID: avId,
                        keyID: selfKeyId,
                        id: selfKeyId,
                        name: selfName,
                        type: "block"
                    }]
                }]
            });
            console.log(`[SQLiteManager] Rename primary key response:`, renameRes);
            startIndex = 1;
        }
        
        for (let i = startIndex; i < parsedCols.length; i++) {
            const col = parsedCols[i];
            const newKeyID = (window as any).Lute?.NewNodeID?.() || `key_${Date.now()}_${i}`;
            console.log(`[SQLiteManager] Adding column: ${col.name} (type: ${col.type}, newKeyID: ${newKeyID}, previousKeyID: ${lastKeyID})`);
            
            const addKeyRes = await post("/api/av/addAttributeViewKey", {
                avID: avId,
                keyID: newKeyID,
                keyName: col.name,
                keyType: col.type === "block" ? "text" : col.type,
                keyIcon: "",
                previousKeyID: lastKeyID
            });
            console.log(`[SQLiteManager] Add column response:`, addKeyRes);
            lastKeyID = newKeyID;
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (col.options.length > 0) {
                const optionsVal = col.options.map((o, idx) => ({
                    id: `opt_${Date.now()}_${idx}`,
                    name: o,
                    color: ""
                }));
                console.log(`[SQLiteManager] Setting options for column ${col.name}:`, optionsVal);
                const optionsRes = await post("/api/transactions", {
                    reqId: Date.now(),
                    app: "plugin-index",
                    transactions: [{
                        doOperations: [{
                            action: "updateAttrViewColOptions",
                            avID: avId,
                            id: newKeyID,
                            data: optionsVal
                        }]
                    }]
                });
                console.log(`[SQLiteManager] Set options response:`, optionsRes);
            }
            
            if (col.type === "relation" && col.refTable) {
                const targetAvId = resolveTableAvId(col.refTable);
                if (targetAvId) {
                    const backKeyId = (window as any).Lute?.NewNodeID?.() || `key_${Date.now()}_back`;
                    console.log(`[SQLiteManager] Establishing bidirectional relationship with ${col.refTable} (${targetAvId}) for column ${col.name}`);
                    const relationRes = await post("/api/transactions", {
                        reqId: Date.now(),
                        app: "plugin-index",
                        transactions: [{
                            doOperations: [{
                                action: "updateAttrViewColRelation",
                                avID: avId,
                                id: targetAvId,
                                keyID: newKeyID,
                                isTwoWay: true,
                                backRelationKeyID: backKeyId,
                                name: `关联-${tableName}`,
                                format: col.name
                            }]
                        }]
                    });
                    console.log(`[SQLiteManager] Relation transaction response:`, relationRes);
                } else {
                    console.warn(`[SQLiteManager] Target table '${col.refTable}' for relation column '${col.name}' could not be resolved.`);
                }
            }
        }
        
        // 8. Set table name and trigger Siyuan editor re-render via transactions
        console.log(`[SQLiteManager] Renaming database title to '${tableName}' and triggering re-render for block ${avBlockId}...`);
        await post("/api/transactions", {
            app: "plugin-index",
            reqId: Date.now(),
            transactions: [{
                doOperations: [
                    {
                        action: "setAttrViewName",
                        id: avId, // AV Database ID
                        data: tableName
                    }
                ]
            }]
        });
        
        registerFriendlyTableName(tableName, avId);
        avIdToBlockIdMap.set(avId, avBlockId);
        
        // Call the re-render helper which forces block content reload via updateBlock
        await triggerAvBlockRender(avId);
        
        await instantiateAV(avId, true);
        return { success: true, message: `Table '${tableName}' created successfully with avID '${avId}'.`, avId, blockId: avBlockId };
    }

    // ─── 2. ALTER TABLE Statement ───
    const alterMatch = processedSql.match(/^\s*ALTER\s+TABLE\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s+(ADD\s+COLUMN|DROP\s+COLUMN)\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?(?:\s+([a-zA-Z0-9_\-\(\)'",\s]+))?/is);
    if (alterMatch) {
        const tableName = alterMatch[1];
        const action = alterMatch[2].toUpperCase().replace(/\s+/g, " ");
        const colName = alterMatch[3];
        const colDef = alterMatch[4] || "";
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID });
        const checkKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
        
        if (action === "ADD COLUMN") {
            const typeMatch = colDef.trim().match(/^([a-zA-Z]+)(?:\((.+?)\))?(?:\s+REFERENCES\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?)?/i);
            const rawType = typeMatch ? typeMatch[1].toLowerCase() : "text";
            const paramsStr = typeMatch ? typeMatch[2] : null;
            const refTable = typeMatch ? typeMatch[3] : null;
            
            let colType = "text";
            const validTypes = ["block", "text", "number", "select", "mselect", "date", "checkbox", "relation", "masset", "rollup", "template", "created", "updated", "url", "email", "phone", "linenumber"];
            if (validTypes.includes(rawType)) {
                if (rawType === "mselect") colType = "mSelect";
                else if (rawType === "masset") colType = "mAsset";
                else if (rawType === "linenumber") colType = "lineNumber";
                else colType = rawType;
            }
            
            const lastKeyID = checkKeys.length > 0 ? checkKeys[checkKeys.length - 1].id : "";
            const newKeyID = (window as any).Lute?.NewNodeID?.() || `key_${Date.now()}`;
            
            console.log(`[SQLiteManager] Adding column ${colName} (${colType}) to AV ${avID}`);
            await post("/api/av/addAttributeViewKey", {
                avID,
                keyID: newKeyID,
                keyName: colName,
                keyType: colType,
                keyIcon: "",
                previousKeyID: lastKeyID
            });
            await new Promise(resolve => setTimeout(resolve, 200));
            
            let options: string[] = [];
            if (paramsStr && (colType === "select" || colType === "mSelect")) {
                options = paramsStr.split(",").map(o => o.trim().replace(/^['"`]|['"`]$/g, ""));
            }
            if (options.length > 0) {
                const optionsVal = options.map((o, idx) => ({
                    id: `opt_${Date.now()}_${idx}`,
                    name: o,
                    color: ""
                }));
                await post("/api/transactions", {
                    reqId: Date.now(),
                    app: "plugin-index",
                    transactions: [{
                        doOperations: [{
                            action: "updateAttrViewColOptions",
                            avID: avID,
                            id: newKeyID,
                            data: optionsVal
                        }]
                    }]
                });
            }
            
            if (colType === "relation" && refTable) {
                const targetAvId = resolveTableAvId(refTable);
                if (targetAvId) {
                    const backKeyId = (window as any).Lute?.NewNodeID?.() || `key_${Date.now()}_back`;
                    console.log(`[SQLiteManager] Establishing bidirectional relationship with ${refTable} (${targetAvId})`);
                    await post("/api/transactions", {
                        reqId: Date.now(),
                        app: "plugin-index",
                        transactions: [{
                            doOperations: [{
                                action: "updateAttrViewColRelation",
                                avID: avID,
                                id: targetAvId,
                                keyID: newKeyID,
                                isTwoWay: true,
                                backRelationKeyID: backKeyId,
                                name: `关联-${tableName}`,
                                format: colName
                            }]
                        }]
                    });
                }
            }
            
            tableSyncTimes.delete(avID);
            await instantiateAV(avID, true);
            await triggerAvBlockRender(avID);
            return { success: true, message: `Column '${colName}' added successfully to table '${tableName}'.` };
            
        } else if (action === "DROP COLUMN") {
            const targetCol = checkKeys.find((k: any) => k.name === colName);
            if (!targetCol) throw new Error(`Column '${colName}' not found in table '${tableName}'.`);
            
            console.log(`[SQLiteManager] Dropping column ${colName} (${targetCol.id}) from AV ${avID}`);
            await post("/api/av/removeAttributeViewKey", {
                avID,
                keyID: targetCol.id
            });
            
            tableSyncTimes.delete(avID);
            await instantiateAV(avID, true);
            await triggerAvBlockRender(avID);
            return { success: true, message: `Column '${colName}' dropped successfully from table '${tableName}'.` };
        }
    }

    // ─── 3. DROP TABLE Statement ───
    const dropMatch = processedSql.match(/^\s*DROP\s+TABLE\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s*;?\s*$/is);
    if (dropMatch) {
        const tableName = dropMatch[1];
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        console.log(`[SQLiteManager] Dropping table ${tableName} (avID: ${avID})`);
        
        // 1. Locate Siyuan AV Block ID
        let avBlockId = avIdToBlockIdMap.get(avID) || "";
        
        if (!avBlockId) {
            const sqlFindBlock = `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avID}%' OR ial LIKE '%${avID}%') LIMIT 1`;
            const resFind = await post("/api/query/sql", { stmt: sqlFindBlock });
            if (resFind && resFind.length > 0) {
                avBlockId = resFind[0].id;
            }
        }
        
        // 2. Delete the AV block from Siyuan
        const blockToDelete = avBlockId || avID;
        console.log(`[SQLiteManager] Deleting AV block ${blockToDelete} from Siyuan`);
        try {
            await post("/api/block/deleteBlock", { id: blockToDelete });
        } catch (e) {
            console.warn(`[SQLiteManager] Failed to delete AV block ${blockToDelete} in Siyuan:`, e);
        }
        
        // 3. Clear friendlyName registry and cache
        const cleanNames = [
            tableName,
            tableName.replace(/\s+/g, "_"),
            tableName.replace(/[^a-zA-Z0-9]/g, "_")
        ];
        for (const name of cleanNames) {
            const avIds = friendlyTableNameMap.get(name);
            if (avIds) {
                const updated = avIds.filter(id => id !== avID);
                if (updated.length > 0) {
                    friendlyTableNameMap.set(name, updated);
                } else {
                    friendlyTableNameMap.delete(name);
                }
            }
        }
        avIdToBlockIdMap.delete(avID);
        
        tableSyncTimes.delete(avID);
        instantiatedAvIdsCache.delete(avID);
        
        // 4. Drop from Wasm SQLite memory DB
        const dbTable = avIdToTableName(avID);
        db.run(`DROP TABLE IF EXISTS "${dbTable}";`);
        db.run(`DELETE FROM _meta WHERE id = ?;`, [avID]);
        db.run(`DELETE FROM _av_schema WHERE av_id = ?;`, [avID]);
        
        return { success: true, message: `Table '${tableName}' dropped successfully.` };
    }
    
    return null;
}
