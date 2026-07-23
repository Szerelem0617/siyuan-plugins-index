import { post } from "../../../shared/api-client/request";
import { 
    resolveTableAvId, 
    instantiateAV, 
    getAVSchema, 
    tableSyncTimes, 
    avIdToTableName 
} from "../sqlite-manager";
import { 
    parseSetAssignments, 
    parseColumnList, 
    parseValuesTuples, 
    cleanIdentifier 
} from "./tokenizer";

function packCellValue(kt: string, val: any): any {
    if (kt === "checkbox") {
        return { type: "checkbox", checkbox: { checked: Boolean(val) } };
    } else if (kt === "number") {
        return { type: "number", number: { content: val === null || val === undefined ? "" : String(val), isNotEmpty: val !== null && val !== undefined } };
    } else if (kt === "relation") {
        let blockIDs: string[] = [];
        if (typeof val === "string" && val.startsWith("[")) {
            try { blockIDs = JSON.parse(val); } catch { blockIDs = [val]; }
        } else if (Array.isArray(val)) {
            blockIDs = val;
        } else if (val) {
            blockIDs = [val];
        }
        return { type: "relation", relation: { blockIDs } };
    } else if (kt === "select") {
        return { type: "select", select: { content: val === null || val === undefined ? "" : String(val) } };
    } else if (kt === "mSelect") {
        let contents: string[] = [];
        if (typeof val === "string" && val.startsWith("[")) {
            try { contents = JSON.parse(val); } catch { contents = [val]; }
        } else if (Array.isArray(val)) {
            contents = val;
        } else if (val) {
            contents = [val];
        }
        return { type: "mSelect", mSelect: contents.map(c => ({ content: c, color: "" })) };
    } else {
        return { type: kt, [kt]: { content: val === null || val === undefined ? "" : String(val) } };
    }
}

export async function executeDML(processedSql: string, db: any): Promise<any> {
    // ─── 1. UPSERT / REPLACE INTO Statement ───
    // Matches: REPLACE INTO <table> (cols) VALUES (vals)
    // Matches: UPSERT INTO <table> (cols) VALUES (vals)
    // Matches: INSERT INTO <table> (cols) VALUES (vals) ON CONFLICT ... DO UPDATE ...
    const upsertMatch = processedSql.match(/^\s*(?:REPLACE|UPSERT)\s+INTO\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s*\((.+?)\)\s*VALUES\s*(.+?)\s*;?\s*$/is) ||
                        processedSql.match(/^\s*INSERT\s+INTO\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s*\((.+?)\)\s*VALUES\s*(.+?)\s+ON\s+CONFLICT.*$/is);
    if (upsertMatch) {
        const tableName = cleanIdentifier(upsertMatch[1]);
        const colsClause = upsertMatch[2];
        const valsClause = upsertMatch[3];

        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);

        const colNames = parseColumnList(colsClause);
        const tuples = parseValuesTuples(valsClause);
        if (tuples.length === 0) throw new Error("No VALUES tuples provided for UPSERT.");

        let schema = await getAVSchema(avID);
        if (schema.length === 0) {
            await instantiateAV(avID, true);
            schema = await getAVSchema(avID);
        }

        await instantiateAV(avID, true);
        const dbTable = avIdToTableName(avID);

        // Find primary key column index in INSERT columns (id / rowID / _itemID)
        const idColIndex = colNames.findIndex(c => c.toLowerCase() === "id" || c.toLowerCase() === "rowid" || c.toLowerCase() === "_itemid");

        let insertedCount = 0;
        let updatedCount = 0;
        const allUpdates: any[] = [];

        for (const tuple of tuples) {
            if (tuple.length !== colNames.length) {
                throw new Error(`Column count (${colNames.length}) does not match value count (${tuple.length}) in tuple.`);
            }

            let existingItemID: string | null = null;
            if (idColIndex !== -1) {
                const targetId = String(tuple[idColIndex]);
                try {
                    const res = db.exec(`SELECT "_itemID" FROM "${dbTable}" WHERE rowID = ? OR "_itemID" = ?`, [targetId, targetId]);
                    if (res.length > 0 && res[0].values.length > 0) {
                        existingItemID = String(res[0].values[0][0]);
                    }
                } catch {}
            }

            if (existingItemID) {
                // UPDATE existing row
                updatedCount++;
                for (let i = 0; i < colNames.length; i++) {
                    const colName = colNames[i];
                    if (i === idColIndex) continue; // Skip ID key update
                    const val = tuple[i];
                    const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
                    if (!colSchema) continue;

                    allUpdates.push({
                        keyID: colSchema.keyId,
                        itemID: existingItemID,
                        value: packCellValue(colSchema.keyType, val)
                    });
                }
            } else {
                // INSERT new detached row
                insertedCount++;
                // @ts-ignore
                const newRowID = (idColIndex !== -1 && tuple[idColIndex]) ? String(tuple[idColIndex]) : (window.Lute?.NewNodeID?.() || `row_${Date.now()}`);
                
                await post("/api/av/addAttributeViewBlocks", {
                    avID: avID,
                    srcs: [{ itemID: newRowID, id: "", isDetached: true }]
                });

                for (let i = 0; i < colNames.length; i++) {
                    const colName = colNames[i];
                    const val = tuple[i];
                    const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
                    if (!colSchema) continue;

                    allUpdates.push({
                        keyID: colSchema.keyId,
                        itemID: newRowID,
                        value: packCellValue(colSchema.keyType, val)
                    });
                }
            }
        }

        tableSyncTimes.delete(avID);

        if (allUpdates.length > 0) {
            console.log(`[SQLiteManager] Executing Siyuan UPSERT batch on AV ${avID}: ${insertedCount} inserted, ${updatedCount} updated.`);
            await post("/api/av/batchSetAttributeViewBlockAttrs", { avID, values: allUpdates });
        }

        return {
            success: true,
            insertedCount,
            updatedCount,
            message: `UPSERT completed: ${insertedCount} inserted, ${updatedCount} updated.`
        };
    }

    // ─── 2. UPDATE Statement ───
    const updateMatch = processedSql.match(/^\s*UPDATE\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s+SET\s+(.+?)\s+WHERE\s+(.+?)\s*$/is);
    if (updateMatch) {
        const tableName = cleanIdentifier(updateMatch[1]);
        const setClause = updateMatch[2];
        const whereClause = updateMatch[3];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        const rowIDs: string[] = [];
        const singleIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s*=\s*['"`]([a-zA-Z0-9_\-]+)['"`]\s*$/i);
        const inIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s+IN\s*\((.+?)\)\s*$/i);
        
        if (singleIdMatch) {
            rowIDs.push(singleIdMatch[1]);
        } else if (inIdMatch) {
            const rawIds = inIdMatch[1].split(",");
            for (const rawId of rawIds) {
                rowIDs.push(cleanIdentifier(rawId));
            }
        } else {
            console.log(`[SQLiteManager] Complex WHERE clause detected: "${whereClause}". Running in-memory filter query...`);
            await instantiateAV(avID, true);
            const dbTable = avIdToTableName(avID);
            const cleanWhere = whereClause.trim().replace(/;+$/, "");
            const querySql = `SELECT rowID FROM "${dbTable}" WHERE ${cleanWhere};`;
            try {
                const res = db.exec(querySql);
                if (res.length > 0 && res[0].values.length > 0) {
                    for (const row of res[0].values) {
                        rowIDs.push(String(row[0]));
                    }
                }
            } catch (err: any) {
                throw new Error(`Failed to evaluate WHERE clause on in-memory table: ${err.message || err}`);
            }
        }
        
        const assignments = parseSetAssignments(setClause);
        let schema = await getAVSchema(avID);
        if (schema.length === 0) {
            await instantiateAV(avID, true);
            schema = await getAVSchema(avID);
        }
        
        tableSyncTimes.delete(avID);
        
        const values: any[] = [];
        const dbTable = avIdToTableName(avID);
        for (const [colName, val] of Object.entries(assignments)) {
            const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
            if (!colSchema) throw new Error(`Column '${colName}' not found in table schema.`);
            
            for (const rowID of rowIDs) {
                let itemID = rowID;
                try {
                    const itemIDRes = db.exec(`SELECT "_itemID" FROM "${dbTable}" WHERE rowID = ?`, [rowID]);
                    if (itemIDRes.length > 0 && itemIDRes[0].values.length > 0) {
                        itemID = String(itemIDRes[0].values[0][0]);
                    }
                } catch (e) {
                    // fallback to rowID
                }
                
                values.push({
                    keyID: colSchema.keyId,
                    itemID: itemID,
                    value: packCellValue(colSchema.keyType, val)
                });
            }
        }
        
        if (values.length > 0) {
            console.log(`[SQLiteManager] Executing Siyuan batch UPDATE on AV ${avID} with ${values.length} cell updates.`);
            await post("/api/av/batchSetAttributeViewBlockAttrs", { avID, values });
            return { success: true, updatedRows: rowIDs.length, message: `Successfully updated ${rowIDs.length} rows` };
        }
        return { success: true, updatedRows: 0, message: "No rows updated" };
    }
    
    // ─── 3. INSERT Statement ───
    const insertMatch = processedSql.match(/^\s*INSERT\s+INTO\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s*\((.+?)\)\s*VALUES\s*(.+?)\s*;?\s*$/is);
    if (insertMatch) {
        const tableName = cleanIdentifier(insertMatch[1]);
        const colsClause = insertMatch[2];
        const valsClause = insertMatch[3];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        const colNames = parseColumnList(colsClause);
        const tuples = parseValuesTuples(valsClause);
        if (tuples.length === 0) throw new Error("No VALUES tuples provided for INSERT.");
        
        let schema = await getAVSchema(avID);
        if (schema.length === 0) {
            await instantiateAV(avID, true);
            schema = await getAVSchema(avID);
        }
        
        const insertedIds: string[] = [];
        const values: any[] = [];

        for (const tuple of tuples) {
            if (colNames.length !== tuple.length) {
                throw new Error(`Column count (${colNames.length}) does not match value count (${tuple.length}) in tuple.`);
            }

            // Generate new Siyuan block ID
            // @ts-ignore
            const newRowID = window.Lute?.NewNodeID?.() || `row_${Date.now()}`;
            insertedIds.push(newRowID);
            
            console.log(`[SQLiteManager] Inserting new detached row ${newRowID} to AV ${avID}`);
            await post("/api/av/addAttributeViewBlocks", {
                avID: avID,
                srcs: [{ itemID: newRowID, id: "", isDetached: true }]
            });

            for (let idx = 0; idx < colNames.length; idx++) {
                const colName = colNames[idx];
                const val = tuple[idx];
                const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
                if (!colSchema) continue;
                
                values.push({
                    keyID: colSchema.keyId,
                    itemID: newRowID,
                    value: packCellValue(colSchema.keyType, val)
                });
            }
        }
        
        tableSyncTimes.delete(avID);
        
        if (values.length > 0) {
            await post("/api/av/batchSetAttributeViewBlockAttrs", { avID, values });
        }
        return { success: true, insertedCount: insertedIds.length, insertedIds, message: `Successfully inserted ${insertedIds.length} rows` };
    }
    
    // ─── 4. DELETE Statement ───
    const deleteMatch = processedSql.match(/^\s*DELETE\s+FROM\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s+WHERE\s+(.+?)\s*$/is);
    if (deleteMatch) {
        const tableName = cleanIdentifier(deleteMatch[1]);
        const whereClause = deleteMatch[2];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        await instantiateAV(avID, true);
        
        const itemIDs: string[] = [];
        const dbTable = avIdToTableName(avID);
        const cleanWhere = whereClause.trim().replace(/;+$/, "");
        const querySql = `SELECT "_itemID" FROM "${dbTable}" WHERE ${cleanWhere};`;
        try {
            const res = db.exec(querySql);
            if (res.length > 0 && res[0].values.length > 0) {
                for (const row of res[0].values) {
                    itemIDs.push(String(row[0]));
                }
            }
        } catch (err: any) {
            throw new Error(`Failed to evaluate WHERE clause on in-memory table: ${err.message || err}`);
        }
        
        if (itemIDs.length > 0) {
            console.log(`[SQLiteManager] Deleting ${itemIDs.length} rows from AV ${avID} with itemIDs:`, itemIDs);
            await post("/api/av/removeAttributeViewBlocks", { avID, srcIDs: itemIDs });
        }
        
        tableSyncTimes.delete(avID);
        
        return { success: true, deletedRowsCount: itemIDs.length, message: `Successfully deleted ${itemIDs.length} rows` };
    }
    
    return null;
}
