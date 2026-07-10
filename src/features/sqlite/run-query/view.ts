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

export async function executeCreateView(processedSql: string, db: any, options?: any): Promise<any> {
    // Pattern: CREATE [KANBAN|GALLERY|TABLE] VIEW [viewName] AS SELECT ... FROM [tableName] ...
    const viewMatch = processedSql.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(KANBAN|GALLERY|TABLE)\s+)?VIEW\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+AS\s+SELECT\s+.*?\s+FROM\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))(?:\s*.*)?$/is);
    if (!viewMatch) {
        return null;
    }

    const requestedLayout = viewMatch[1]; // KANBAN, GALLERY, TABLE or undefined
    const viewName = (viewMatch[2] || viewMatch[3] || "").trim();
    const tableName = (viewMatch[4] || viewMatch[5] || "").trim();

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

    // 3. Post Siyuan transaction to create the view and rename it
    const txRes = await post("/api/transactions", {
        reqId: Date.now(),
        app: "plugin-index",
        transactions: [{
            doOperations: [
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
                }
            ]
        }]
    });

    if (txRes && txRes.code && txRes.code !== 0) {
        throw new Error(`Failed to create view in Siyuan: ${txRes.msg || "Unknown error"}`);
    }

    // 4. Invalidate cache and trigger re-render
    tableSyncTimes.delete(avID);
    await instantiateAV(avID, true);
    await triggerAvBlockRender(avID);

    return { 
        success: true, 
        message: `View '${viewName}' (${layoutType} layout) created successfully on table '${tableName}'.` 
    };
}
