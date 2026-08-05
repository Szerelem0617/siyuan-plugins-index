import { post } from "../../../shared/api-client/request";
import { resolveTableAvId, instantiateAV, tableSyncTimes } from "../sqlite-manager";
import { triggerAvBlockRender } from "./ddl";

function generateNodeId(): string {
    if ((window as any).Lute?.NewNodeID) {
        return (window as any).Lute.NewNodeID();
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const rand = Math.random().toString(36).substring(2, 8).padEnd(6, '0');
    return `${yyyy}${mm}${dd}${hh}${min}${ss}-${rand}`;
}

export async function executeCreateView(processedSql: string, db: any, _options?: any): Promise<any> {
    // Pattern: CREATE [KANBAN|GALLERY|TABLE] VIEW [viewName] AS SELECT ... FROM [tableName] [WHERE ...]
    const viewMatch = processedSql.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(KANBAN|GALLERY|TABLE)\s+)?VIEW\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+AS\s+SELECT\s+.*?\s+FROM\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))(?:\s+WHERE\s+(.+))?\s*;?\s*$/is);
    if (!viewMatch) {
        return null;
    }

    const requestedLayout = viewMatch[1]; // KANBAN, GALLERY, TABLE or undefined
    const viewName = (viewMatch[2] || viewMatch[3] || "").trim();
    const tableName = (viewMatch[4] || viewMatch[5] || "").trim();
    const whereClause = (viewMatch[6] || "").trim();

    // Map KANBAN/GALLERY/TABLE to Siyuan's layout type (lowercase)
    let layoutType = "table";
    if (requestedLayout) {
        layoutType = requestedLayout.toLowerCase();
    }

    // 1. Resolve avID for the table
    const avID = resolveTableAvId(tableName);
    if (!avID) {
        throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
    }

    // 2. Locate Siyuan AV Block ID
    const sqlFindBlock = `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avID}%' OR ial LIKE '%${avID}%')`;
    const resFind = await post("/api/query/sql", { stmt: sqlFindBlock });
    if (!resFind || resFind.length === 0) {
        throw new Error(`No Attribute View block found in Siyuan documents for table '${tableName}'.`);
    }
    if (resFind.length > 1) {
        console.log(`[SQLiteManager] Multiple AV blocks (${resFind.length}) found for table '${tableName}', using the first block ID '${resFind[0].id}' to create the view.`);
    }

    const avBlockID = resFind[0].id;
    const newViewID = generateNodeId();

    console.log(`[SQLiteManager] Creating view '${viewName}' (Type: ${layoutType}, ID: ${newViewID}) on table '${tableName}' (avID: ${avID}, BlockID: ${avBlockID})`);

    // Parse simple filter condition: ColumnName = 'Value' or similar
    let filtersData: any[] = [];
    if (whereClause) {
        const condMatch = whereClause.match(/^\s*["`']?([a-zA-Z0-9_\-\u4e00-\u9fa5\s]+)["`']?\s*(=|!=|LIKE|Contains)\s*['"`]?([^\n\r'"`]+)['"`]?\s*$/i);
        if (condMatch) {
            const colName = condMatch[1].trim();
            const operatorRaw = condMatch[2].trim().toUpperCase();
            const filterValue = condMatch[3].trim();

            const schemaCols = db.exec(`SELECT key_id, key_type FROM _av_schema WHERE av_id = ? AND (col_name = ? OR key_name = ?)`, [avID, colName, colName]);
            if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
                const keyID = String(schemaCols[0].values[0][0]);
                const keyType = String(schemaCols[0].values[0][1]);

                let operator = "=";
                if (operatorRaw === "!=") operator = "!=";
                else if (operatorRaw === "LIKE" || operatorRaw === "CONTAINS") operator = "Contains";

                let cellValue: any = null;
                if (keyType === "checkbox") {
                    cellValue = { type: "checkbox", checkbox: { checked: filterValue === "true" || filterValue === "1" } };
                } else if (keyType === "number") {
                    cellValue = { type: "number", number: { content: filterValue, isNotEmpty: true } };
                } else {
                    cellValue = { type: "text", text: { content: filterValue } };
                }

                filtersData = [
                    {
                        combination: "and",
                        filters: [
                            {
                                column: keyID,
                                operator: operator,
                                value: cellValue
                            }
                        ]
                    }
                ];
                console.log(`[SQLiteManager] Parsed filter conditions for view:`, JSON.stringify(filtersData));
            } else {
                console.warn(`[SQLiteManager] Column '${colName}' not found in _av_schema for table '${tableName}'. Filter will not be applied.`);
            }
        } else {
            console.warn(`[SQLiteManager] WHERE clause '${whereClause}' is too complex or not supported. Filter will not be applied.`);
        }
    }

    // 3. Post Siyuan transactions:
    // Transaction 1: Add the view, rename the view, and set it as active on the block
    const doOperations: any[] = [
        {
            action: "addAttrViewView",
            avID: avID,
            id: newViewID,
            blockID: avBlockID,
            layout: layoutType
        },
        {
            action: "setAttrViewViewName",
            avID: avID,
            id: newViewID,
            blockID: avBlockID,
            data: viewName
        },
        {
            action: "setAttrViewBlockView",
            avID: avID,
            id: newViewID,
            blockID: avBlockID
        }
    ];

    const txRes1 = await post("/api/transactions", {
        reqId: Date.now(),
        app: "plugin-index",
        transactions: [{ doOperations }]
    });

    if (txRes1 && txRes1.code && txRes1.code !== 0) {
        throw new Error(`Failed to create view in Siyuan: ${txRes1.msg || "Unknown error"}`);
    }

    // Transaction 2: Set the filters for the active view (with a tiny timeout to ensure DB flush)
    if (filtersData.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const txRes2 = await post("/api/transactions", {
            reqId: Date.now(),
            app: "plugin-index",
            transactions: [{
                doOperations: [{
                    action: "setAttrViewFilters",
                    avID: avID,
                    data: filtersData,
                    blockID: avBlockID
                }]
            }]
        });
        if (txRes2 && txRes2.code && txRes2.code !== 0) {
            console.error("[SQLiteManager] Failed to apply filters to view:", txRes2.msg);
        }
    }

    // 4. Invalidate cache and trigger re-render
    tableSyncTimes.delete(avID);
    await instantiateAV(avID, true);
    await triggerAvBlockRender(avID);

    return { 
        success: true, 
        viewId: newViewID,
        message: `View '${viewName}' (${layoutType} layout) created successfully on table '${tableName}'${filtersData.length > 0 ? " with filters applied" : ""}.` 
    };
}

export async function executeAlterView(processedSql: string, db: any, options?: any): Promise<any> {
    // Pattern: ALTER VIEW [viewName] ON [tableName] SET COLUMN [colName] HIDDEN [0|1|true|false]
    const alterMatch = processedSql.match(/^\s*ALTER\s+VIEW\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+ON\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+SET\s+COLUMN\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+HIDDEN\s+([0-1]|true|false)\s*;?\s*$/is);
    if (!alterMatch) {
        return null;
    }

    const viewName = (alterMatch[1] || alterMatch[2] || "").trim();
    const tableName = (alterMatch[3] || alterMatch[4] || "").trim();
    const colName = (alterMatch[5] || alterMatch[6] || "").trim();
    const hiddenRaw = alterMatch[7].trim().toLowerCase();
    const isHidden = hiddenRaw === "1" || hiddenRaw === "true";

    console.log(`[SQLiteManager] executeAlterView: Setting column '${colName}' in view '${viewName}' of table '${tableName}' to hidden=${isHidden}`);

    // 1. Resolve avID for the table
    const avID = resolveTableAvId(tableName);
    if (!avID) {
        throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);
    }

    // Ensure the table schema is fully instantiated in SQLite _av_schema
    await instantiateAV(avID, true);

    // 2. Locate Siyuan AV Block ID
    const sqlFindBlock = `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avID}%' OR ial LIKE '%${avID}%')`;
    const resFind = await post("/api/query/sql", { stmt: sqlFindBlock });
    if (!resFind || resFind.length === 0) {
        throw new Error(`No Attribute View block found in Siyuan documents for table '${tableName}'.`);
    }
    const avBlockID = resFind[0].id;

    // 3. Fetch live AV views to find the view ID by name
    const avData = await post("/api/av/renderAttributeView", { id: avID });
    const viewsList = avData.views || avData.view?.views || [];
    const targetView = viewsList.find((v: any) => v.name === viewName || v.id === viewName);
    if (!targetView) {
        throw new Error(`View '${viewName}' not found in table '${tableName}'.`);
    }
    const viewID = targetView.id;

    // 4. Find the column key ID by column name
    const schemaCols = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (col_name = ? OR key_name = ?)`, [avID, colName, colName]);
    if (schemaCols.length === 0 || schemaCols[0].values.length === 0) {
        throw new Error(`Column '${colName}' not found in table '${tableName}'.`);
    }
    const colKeyId = String(schemaCols[0].values[0][0]);

    // 5. Post Siyuan transaction to:
    //    a) Set the block's active view to viewID
    //    b) Hide/show the column in this active view
    const txRes = await post("/api/transactions", {
        reqId: Date.now(),
        app: "plugin-index",
        transactions: [{
            doOperations: [
                {
                    action: "setAttrViewBlockView",
                    avID: avID,
                    id: viewID,
                    blockID: avBlockID
                },
                {
                    action: "setAttrViewColHidden",
                    id: colKeyId,
                    avID: avID,
                    data: isHidden,
                    blockID: avBlockID
                }
            ]
        }]
    });

    if (txRes && txRes.code && txRes.code !== 0) {
        throw new Error(`Failed to alter column hidden status in Siyuan: ${txRes.msg || "Unknown error"}`);
    }

    // 6. Invalidate cache and trigger re-render
    tableSyncTimes.delete(avID);
    await instantiateAV(avID, true);
    if (!options?.skipRender) {
        await triggerAvBlockRender(avID);
    }

    return { 
        success: true, 
        message: `Column '${colName}' in view '${viewName}' updated successfully to hidden=${isHidden}.` 
    };
}
