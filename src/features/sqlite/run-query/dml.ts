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
        const numVal = (val === null || val === undefined || val === "") ? 0 : Number(val);
        const isNotEmpty = val !== null && val !== undefined && val !== "";
        return { type: "number", number: { content: isNaN(numVal) ? 0 : numVal, isNotEmpty } };
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
        // 思源 Value 结构体中 select 和 mSelect 都使用 mSelect 字段
        const content = val === null || val === undefined ? "" : String(val);
        return { type: "select", mSelect: content ? [{ content, color: "" }] : [] };
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
    } else if (kt === "mAsset") {
        let assets: any[] = [];
        if (typeof val === "string" && val.startsWith("[")) {
            try { assets = JSON.parse(val); } catch { assets = [{ type: "file", name: val, content: val }]; }
        } else if (Array.isArray(val)) {
            assets = val.map(a => typeof a === "string" ? { type: "file", name: a, content: a } : a);
        } else if (val) {
            assets = [{ type: "file", name: String(val), content: String(val) }];
        }
        return { type: "mAsset", mAsset: assets };
    } else if (kt === "block") {
        const valStr = val === null || val === undefined ? "" : String(val).trim();
        const isBlockId = /^\d{14}-[a-z0-9]{7}$/i.test(valStr);
        return {
            type: "block",
            block: {
                content: isBlockId ? "" : valStr,
                id: isBlockId ? valStr : ""
            },
            isDetached: !isBlockId
        };
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

        // Find primary key/ID column index in INSERT columns
        const idColIndex = colNames.findIndex(c => c.toLowerCase() === "id" || c.toLowerCase() === "rowid" || c.toLowerCase() === "_itemid");

        let insertedCount = 0;
        let updatedCount = 0;
        const allUpdates: any[] = [];

        for (const tuple of tuples) {
            if (tuple.length !== colNames.length) {
                throw new Error(`列与值数量不匹配：SQL 中指定的列数量为 ${colNames.length} 个 (${colNames.join(", ")}), 但 VALUES 括号内传入了 ${tuple.length} 个值 [${tuple.join(", ")}]。请确保每组 VALUES (...) 的参数个数与列数量一致。`);
            }

            let existingItemID: string | null = null;
            if (idColIndex !== -1) {
                // 有指定 id/rowID 列
                const targetId = String(tuple[idColIndex]);
                try {
                    const res = db.exec(`SELECT "_itemID" FROM "${dbTable}" WHERE rowID = ? OR "_itemID" = ?`, [targetId, targetId]);
                    if (res.length > 0 && res[0].values.length > 0) {
                        existingItemID = String(res[0].values[0][0]);
                    }
                } catch {}
            } else {
                // 没有指定 id/rowID 列，使用传入的第一列（通常是主键列，例如 "主键"）作为匹配依据
                const firstColName = colNames[0];
                const firstColVal = tuple[0];
                const colSchema = schema.find(c => c.colName === firstColName || c.keyName === firstColName);
                if (colSchema) {
                    try {
                        const res = db.exec(`SELECT "_itemID" FROM "${dbTable}" WHERE "${colSchema.colName}" = ?`, [firstColVal]);
                        if (res.length > 0 && res[0].values.length > 0) {
                            if (res[0].values.length > 1) {
                                throw new Error(`UPSERT 无法确定更新目标：在列 "${firstColName}" 中找到了 ${res[0].values.length} 条值为 "${firstColVal}" 的重复行。在存在重名行时，请显式指定 id 或 rowID 列进行精确更新。`);
                            }
                            existingItemID = String(res[0].values[0][0]);
                        }
                    } catch (e: any) {
                        if (e.message?.includes("UPSERT 无法确定更新目标")) throw e;
                    }
                }
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
                    if (colSchema.keyType === "block") {
                        allUpdates.push({
                            keyID: colSchema.keyId,
                            itemID: existingItemID,
                            value: { type: "block", block: { content: String(val || "") } }
                        });
                        continue;
                    }

                    if (!colSchema.writable) continue;

                    allUpdates.push({
                        keyID: colSchema.keyId,
                        itemID: existingItemID,
                        value: packCellValue(colSchema.keyType, val)
                    });
                }
            } else {
                // INSERT new row (check if user provided explicit Block ID)
                insertedCount++;
                let explicitBlockId: string | null = null;
                if (idColIndex !== -1) {
                    const candidate = String(tuple[idColIndex]).trim();
                    if (/^\d{14}-[a-z0-9]{7}$/i.test(candidate)) explicitBlockId = candidate;
                } else if (colNames.length > 0) {
                    const candidate = String(tuple[0]).trim();
                    if (/^\d{14}-[a-z0-9]{7}$/i.test(candidate)) explicitBlockId = candidate;
                }

                // @ts-ignore
                const newRowID = explicitBlockId || window.Lute?.NewNodeID?.() || `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 9)}`;
                
                if (explicitBlockId) {
                    console.log(`[SQLiteManager] UPSERT inserting native block ${explicitBlockId} to AV ${avID}`);
                    await post("/api/av/addAttributeViewBlocks", {
                        avID: avID,
                        srcs: [{ itemID: newRowID, id: explicitBlockId, isDetached: false }]
                    });
                } else {
                    console.log(`[SQLiteManager] UPSERT inserting detached row ${newRowID} to AV ${avID}`);
                    await post("/api/av/addAttributeViewBlocks", {
                        avID: avID,
                        srcs: [{ itemID: newRowID, id: "", isDetached: true }]
                    });
                }

                for (let i = 0; i < colNames.length; i++) {
                    if (i === idColIndex) continue; // 跳过 id/rowID 伪列
                    const colName = colNames[i];
                    const val = tuple[i];
                    const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
                    if (!colSchema) {
                        console.warn(`[DML-UPSERT] Column "${colName}" not found in AV schema. Available columns: [${schema.map(c => `${c.colName}(${c.keyType})`).join(", ")}]`);
                        continue;
                    }
                    if (colSchema.keyType === "block") {
                        allUpdates.push({
                            keyID: colSchema.keyId,
                            itemID: newRowID,
                            value: { type: "block", block: { content: String(val || "") } }
                        });
                        continue;
                    }

                    if (!colSchema.writable) continue;

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
            if (!colSchema.writable && colSchema.keyType !== "block") {
                throw new Error(`无法更新只读列 "${colName}" (类型: ${colSchema.keyType})。创建时间、更新时间、汇总(rollup)、模板列等不可被修改。`);
            }
            
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

        // Check primary column or ID column for block ID
        const idColIndex = colNames.findIndex(c => c.toLowerCase() === "id" || c.toLowerCase() === "rowid" || c.toLowerCase() === "_itemid");

        for (const tuple of tuples) {
            if (colNames.length !== tuple.length) {
                throw new Error(`列与值数量不匹配：SQL 中指定的列数量为 ${colNames.length} 个 (${colNames.join(", ")}), 但 VALUES 括号内传入了 ${tuple.length} 个值 [${tuple.join(", ")}]。请确保每组 VALUES (...) 的参数个数与列数量一致。`);
            }

            // Check if user provided an explicit Siyuan Block ID (14 digits format: YYYYMMDDHHMMSS-xxxxxxx)
            let explicitBlockId: string | null = null;
            let primaryColVal: any = null;

            if (idColIndex !== -1) {
                const candidate = String(tuple[idColIndex]).trim();
                if (/^\d{14}-[a-z0-9]{7}$/i.test(candidate)) {
                    explicitBlockId = candidate;
                }
            } else if (colNames.length > 0) {
                primaryColVal = String(tuple[0]).trim();
                if (/^\d{14}-[a-z0-9]{7}$/i.test(primaryColVal)) {
                    explicitBlockId = primaryColVal;
                }
            }

            // Generate or use provided Block ID
            // @ts-ignore
            const newRowID = explicitBlockId || window.Lute?.NewNodeID?.() || `row_${Date.now()}`;
            insertedIds.push(newRowID);
            
            if (explicitBlockId) {
                console.log(`[SQLiteManager] Inserting native block ${explicitBlockId} to AV ${avID}`);
                await post("/api/av/addAttributeViewBlocks", {
                    avID: avID,
                    srcs: [{ itemID: newRowID, id: explicitBlockId, isDetached: false }]
                });
            } else {
                console.log(`[SQLiteManager] Inserting new detached row ${newRowID} to AV ${avID}`);
                await post("/api/av/addAttributeViewBlocks", {
                    avID: avID,
                    srcs: [{ itemID: newRowID, id: "", isDetached: true }]
                });
            }

            for (let idx = 0; idx < colNames.length; idx++) {
                const colName = colNames[idx];
                const val = tuple[idx];
                const colSchema = schema.find(c => c.colName === colName || c.keyName === colName);
                if (!colSchema) {
                    console.warn(`[DML-INSERT] Column "${colName}" not found in AV schema. Available columns: [${schema.map(c => `${c.colName}(${c.keyType})`).join(", ")}]`);
                    continue;
                }

                // If primary column is type block (read-only primary key), Siyuan auto-binds block title, skip manual setting
                if (colSchema.keyType === "block" || !colSchema.writable) {
                    continue;
                }
                
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
