import { post } from "../../../shared/api-client/request";
import { 
    resolveTableAvId, 
    instantiateAV, 
    getAVSchema, 
    tableSyncTimes, 
    avIdToTableName 
} from "../sqlite-manager";

export async function executeDML(processedSql: string, db: any): Promise<any> {
    // ─── 1. UPDATE Statement ───
    const updateMatch = processedSql.match(/^\s*UPDATE\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s+SET\s+(.+?)\s+WHERE\s+(.+?)\s*$/is);
    if (updateMatch) {
        const tableName = updateMatch[1];
        const setClause = updateMatch[2];
        const whereClause = updateMatch[3];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        // Parse WHERE condition to get target row IDs
        const rowIDs: string[] = [];
        const singleIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s*=\s*['"`]([a-zA-Z0-9_\-]+)['"`]\s*$/i);
        const inIdMatch = whereClause.match(/^\s*(?:rowID|id|_itemID)\s+IN\s*\((.+?)\)\s*$/i);
        
        if (singleIdMatch) {
            rowIDs.push(singleIdMatch[1]);
        } else if (inIdMatch) {
            const rawIds = inIdMatch[1].split(",");
            for (const rawId of rawIds) {
                rowIDs.push(rawId.trim().replace(/^['"`]|['"`]$/g, ""));
            }
        } else {
            // Complex/arbitrary WHERE condition: query in-memory table
            console.log(`[SQLiteManager] Complex WHERE clause detected: "${whereClause}". Running in-memory filter query...`);
            
            // 1. Ensure the memory table is instantiated and fully up-to-date with Siyuan.
            await instantiateAV(avID, true);
            
            // 2. Query matching rowIDs from memory DB
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
        
        const assignments = parseSetClause(setClause);
        let schema = await getAVSchema(avID);
        if (schema.length === 0) {
            await instantiateAV(avID, true);
            schema = await getAVSchema(avID);
        }
        
        // Clear TTL cache for this AV
        tableSyncTimes.delete(avID);
        
        const values: any[] = [];
        const dbTable = avIdToTableName(avID);
        for (const [colName, val] of Object.entries(assignments)) {
            const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
            if (!colSchema) throw new Error(`Column '${colName}' not found in table schema.`);
            
            for (const rowID of rowIDs) {
                let itemID = rowID;
                try {
                    const itemIDRes = db.exec(`SELECT "_itemID" FROM ${dbTable} WHERE rowID = ?`, [rowID]);
                    if (itemIDRes.length > 0 && itemIDRes[0].values.length > 0) {
                        itemID = String(itemIDRes[0].values[0][0]);
                    }
                } catch (e) {
                    // fallback to rowID
                }
                
                let cellValue: any = null;
                const kt = colSchema.keyType;
                if (kt === "checkbox") {
                    cellValue = { type: "checkbox", checkbox: { checked: Boolean(val) } };
                } else if (kt === "number") {
                    cellValue = { type: "number", number: { content: val === null ? "" : String(val), isNotEmpty: val !== null } };
                } else if (kt === "relation") {
                    let blockIDs: string[] = [];
                    if (typeof val === "string" && val.startsWith("[")) {
                        try { blockIDs = JSON.parse(val); } catch { blockIDs = [val]; }
                    } else if (Array.isArray(val)) {
                        blockIDs = val;
                    } else if (val) {
                        blockIDs = [val];
                    }
                    cellValue = { type: "relation", relation: { blockIDs } };
                } else if (kt === "select") {
                    cellValue = { type: "select", select: { content: val === null ? "" : String(val) } };
                } else if (kt === "mSelect") {
                    let contents: string[] = [];
                    if (typeof val === "string" && val.startsWith("[")) {
                        try { contents = JSON.parse(val); } catch { contents = [val]; }
                    } else if (Array.isArray(val)) {
                        contents = val;
                    } else if (val) {
                        contents = [val];
                    }
                    cellValue = { type: "mSelect", mSelect: contents.map(c => ({ content: c, color: "" })) };
                } else {
                    cellValue = { type: kt, [kt]: { content: val === null ? "" : String(val) } };
                }
                
                values.push({
                    keyID: colSchema.keyId,
                    itemID: itemID,
                    value: cellValue
                });
            }
        }
        
        if (values.length > 0) {
            console.log(`[SQLiteManager] Executing Siyuan batch UPDATE on AV ${avID} with ${values.length} cell updates.`);
            const res = await post("/api/av/batchSetAttributeViewBlockAttrs", { avID, values });
            return { success: true, updatedRows: rowIDs.length, message: `Successfully updated ${rowIDs.length} rows` };
        }
        return { success: true, updatedRows: 0, message: "No rows updated" };
    }
    
    // ─── 2. INSERT Statement ───
    const insertMatch = processedSql.match(/^\s*INSERT\s+INTO\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s*\((.+?)\)\s*VALUES\s*\((.+?)\)/is);
    if (insertMatch) {
        const tableName = insertMatch[1];
        const colsClause = insertMatch[2];
        const valsClause = insertMatch[3];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        const colNames = colsClause.split(",").map(c => c.trim().replace(/["'\`]/g, ""));
        const rawVals = parseValuesClause(valsClause);
        if (colNames.length !== rawVals.length) {
            throw new Error(`Column count (${colNames.length}) does not match value count (${rawVals.length}).`);
        }
        
        let schema = await getAVSchema(avID);
        if (schema.length === 0) {
            await instantiateAV(avID, true);
            schema = await getAVSchema(avID);
        }
        
        // Generate new Siyuan block ID
        // @ts-ignore
        const newRowID = window.Lute?.NewNodeID?.() || `row_${Date.now()}`;
        
        console.log(`[SQLiteManager] Inserting new detached row ${newRowID} to AV ${avID}`);
        await post("/api/av/addAttributeViewBlocks", {
            avID: avID,
            srcs: [{ itemID: newRowID, id: "", isDetached: true }]
        });
        
        // Clear TTL cache
        tableSyncTimes.delete(avID);
        
        const values: any[] = [];
        for (let idx = 0; idx < colNames.length; idx++) {
            const colName = colNames[idx];
            const val = rawVals[idx];
            const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
            if (!colSchema) continue;
            
            let cellValue: any = null;
            const kt = colSchema.keyType;
            if (kt === "checkbox") {
                cellValue = { type: "checkbox", checkbox: { checked: Boolean(val) } };
            } else if (kt === "number") {
                cellValue = { type: "number", number: { content: val === null ? "" : String(val), isNotEmpty: val !== null } };
            } else if (kt === "relation") {
                let blockIDs: string[] = [];
                if (typeof val === "string" && val.startsWith("[")) {
                    try { blockIDs = JSON.parse(val); } catch { blockIDs = [val]; }
                } else if (Array.isArray(val)) {
                    blockIDs = val;
                } else if (val) {
                    blockIDs = [val];
                }
                cellValue = { type: "relation", relation: { blockIDs } };
            } else if (kt === "select") {
                cellValue = { type: "select", select: { content: val === null ? "" : String(val) } };
            } else if (kt === "mSelect") {
                let contents: string[] = [];
                if (typeof val === "string" && val.startsWith("[")) {
                    try { contents = JSON.parse(val); } catch { contents = [val]; }
                } else if (Array.isArray(val)) {
                    contents = val;
                } else if (val) {
                    contents = [val];
                }
                cellValue = { type: "mSelect", mSelect: contents.map(c => ({ content: c, color: "" })) };
            } else {
                cellValue = { type: kt, [kt]: { content: val === null ? "" : String(val) } };
            }
            
            values.push({
                keyID: colSchema.keyId,
                itemID: newRowID,
                value: cellValue
            });
        }
        
        if (values.length > 0) {
            await post("/api/av/batchSetAttributeViewBlockAttrs", { avID, values });
        }
        return { success: true, insertedId: newRowID, message: newRowID };
    }
    
    // ─── 3. DELETE Statement ───
    const deleteMatch = processedSql.match(/^\s*DELETE\s+FROM\s+["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5]+)["`']?\s+WHERE\s+(.+?)\s*$/is);
    if (deleteMatch) {
        const tableName = deleteMatch[1];
        const whereClause = deleteMatch[2];
        
        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
        
        // Ensure the memory table is instantiated and fully up-to-date with Siyuan.
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
        
        // Clear TTL cache
        tableSyncTimes.delete(avID);
        
        return { success: true, deletedRowsCount: itemIDs.length, message: `Successfully deleted ${itemIDs.length} rows` };
    }
    
    return null;
}

function parseSetClause(setStr: string): Record<string, any> {
    const result: Record<string, any> = {};
    let i = 0;
    let currentKey = "";
    let currentValue = "";
    let inQuote = false;
    let quoteChar = "";
    let isValueMode = false;

    while (i < setStr.length) {
        const char = setStr[i];
        if (inQuote) {
            if (char === quoteChar) {
                inQuote = false;
            } else {
                currentValue += char;
            }
        } else {
            if (char === "'" || char === '"' || char === "`") {
                inQuote = true;
                quoteChar = char;
            } else if (char === "=" && !isValueMode) {
                isValueMode = true;
            } else if (char === "," && isValueMode) {
                result[currentKey.trim()] = parsePrimitiveValue(currentValue.trim());
                currentKey = "";
                currentValue = "";
                isValueMode = false;
            } else {
                if (isValueMode) {
                    currentValue += char;
                } else {
                    currentKey += char;
                }
            }
        }
        i++;
    }
    if (currentKey.trim()) {
        result[currentKey.trim()] = parsePrimitiveValue(currentValue.trim());
    }
    return result;
}

function parseValuesClause(valStr: string): any[] {
    const result: any[] = [];
    let i = 0;
    let currentValue = "";
    let inQuote = false;
    let quoteChar = "";
    
    while (i < valStr.length) {
        const char = valStr[i];
        if (inQuote) {
            if (char === quoteChar) {
                inQuote = false;
            } else {
                currentValue += char;
            }
        } else {
            if (char === "'" || char === '"' || char === "`") {
                inQuote = true;
                quoteChar = char;
            } else if (char === ",") {
                result.push(parsePrimitiveValue(currentValue.trim()));
                currentValue = "";
            } else {
                currentValue += char;
            }
        }
        i++;
    }
    if (currentValue.trim()) {
        result.push(parsePrimitiveValue(currentValue.trim()));
    }
    return result;
}

function parsePrimitiveValue(valStr: string): any {
    if (valStr.toLowerCase() === "true") return true;
    if (valStr.toLowerCase() === "false") return false;
    if (valStr.toLowerCase() === "null") return null;
    if (!isNaN(Number(valStr)) && valStr !== "") return Number(valStr);
    return valStr.replace(/^['"`]|['"`]$/g, "");
}
