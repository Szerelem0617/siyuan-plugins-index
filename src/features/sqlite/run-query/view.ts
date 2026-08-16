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
    // Pattern 1: ALTER VIEW [viewName] ON [tableName] SET COLUMN [colName] HIDDEN [0|1|true|false]
    const alterColMatch = processedSql.match(/^\s*ALTER\s+VIEW\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+ON\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+SET\s+COLUMN\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+HIDDEN\s+([0-1]|true|false)\s*;?\s*$/is);

    // Pattern 2 (Siyuan 3.8.0): ALTER VIEW [viewName] ON [tableName] SET VISIBLE [0|1|true|false]
    const alterVisibleMatch = processedSql.match(/^\s*ALTER\s+VIEW\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+ON\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+SET\s+VISIBLE\s+([0-1]|true|false)\s*;?\s*$/is);

    // Pattern 3 (Siyuan 3.8.0): ALTER VIEW [viewName] ON [tableName] SET ICON ['icon_or_emoji']
    const alterIconMatch = processedSql.match(/^\s*ALTER\s+VIEW\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+ON\s+(?:["'`]([^\n\r"'`]+)["'`]|([a-zA-Z0-9_\-\u4e00-\u9fa5]+))\s+SET\s+ICON\s+['"`]?([^\n\r'"`]+)['"`]?\s*;?\s*$/is);

    if (!alterColMatch && !alterVisibleMatch && !alterIconMatch) {
        return null;
    }

    // --- 处理 Pattern 2: SET VISIBLE ---
    if (alterVisibleMatch) {
        const viewName = (alterVisibleMatch[1] || alterVisibleMatch[2] || "").trim();
        const tableName = (alterVisibleMatch[3] || alterVisibleMatch[4] || "").trim();
        const visibleRaw = alterVisibleMatch[5].trim().toLowerCase();
        const isVisible = visibleRaw === "1" || visibleRaw === "true";

        console.log(`[SQLiteManager] executeAlterView: Setting view '${viewName}' of table '${tableName}' visible=${isVisible}`);

        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved to an Attribute View.`);

        await instantiateAV(avID, true);

        const sqlFindBlock = `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avID}%' OR ial LIKE '%${avID}%')`;
        const resFind = await post("/api/query/sql", { stmt: sqlFindBlock });
        if (!resFind || resFind.length === 0) throw new Error(`No Attribute View block found in Siyuan documents for table '${tableName}'.`);
        const avBlockID = resFind[0].id;

        const avData = await post("/api/av/renderAttributeView", { id: avID });
        const viewsList: any[] = avData.views || avData.view?.views || [];
        const targetView = viewsList.find((v: any) => v.name === viewName || v.id === viewName);
        if (!targetView) throw new Error(`View '${viewName}' not found in table '${tableName}'.`);

        const currentVisibleIDs: string[] = avData.view?.visibleViews || viewsList.map((v: any) => v.id);
        let newVisibleIDs: string[];
        if (isVisible) {
            if (!currentVisibleIDs.includes(targetView.id)) {
                newVisibleIDs = [...currentVisibleIDs, targetView.id];
            } else {
                newVisibleIDs = currentVisibleIDs;
            }
        } else {
            newVisibleIDs = currentVisibleIDs.filter(id => id !== targetView.id);
            if (newVisibleIDs.length === 0) {
                throw new Error(`无法隐匿视图 '${viewName}'：思源至少需要保留一个可见视图。`);
            }
        }

        const txRes = await post("/api/transactions", {
            reqId: Date.now(),
            app: "plugin-index",
            transactions: [{
                doOperations: [{
                    action: "setAttrViewBlockVisibleViews",
                    avID,
                    blockID: avBlockID,
                    viewIDs: newVisibleIDs
                }]
            }]
        });

        if (txRes && txRes.code && txRes.code !== 0) {
            throw new Error(`Failed to set view visible status in Siyuan: ${txRes.msg || "Unknown error"}`);
        }

        tableSyncTimes.delete(avID);
        await instantiateAV(avID, true);
        if (!options?.skipRender) await triggerAvBlockRender(avID);

        return {
            success: true,
            message: `View '${viewName}' in table '${tableName}' updated to visible=${isVisible}.`
        };
    }

    // --- 处理 Pattern 3: SET ICON ---
    if (alterIconMatch) {
        const viewName = (alterIconMatch[1] || alterIconMatch[2] || "").trim();
        const tableName = (alterIconMatch[3] || alterIconMatch[4] || "").trim();
        const iconVal = alterIconMatch[5].trim();

        console.log(`[SQLiteManager] executeAlterView: Setting view '${viewName}' icon in table '${tableName}' to '${iconVal}'`);

        const avID = resolveTableAvId(tableName);
        if (!avID) throw new Error(`Table '${tableName}' not found or cannot be resolved.`);

        await instantiateAV(avID, true);

        const sqlFindBlock = `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avID}%' OR ial LIKE '%${avID}%')`;
        const resFind = await post("/api/query/sql", { stmt: sqlFindBlock });
        if (!resFind || resFind.length === 0) throw new Error(`No AV block found for table '${tableName}'.`);
        const avBlockID = resFind[0].id;

        const avData = await post("/api/av/renderAttributeView", { id: avID });
        const viewsList = avData.views || avData.view?.views || [];
        const targetView = viewsList.find((v: any) => v.name === viewName || v.id === viewName);
        if (!targetView) throw new Error(`View '${viewName}' not found in table '${tableName}'.`);

        const txRes = await post("/api/transactions", {
            reqId: Date.now(),
            app: "plugin-index",
            transactions: [{
                doOperations: [{
                    action: "setAttrViewViewIcon",
                    avID,
                    id: targetView.id,
                    blockID: avBlockID,
                    data: iconVal
                }]
            }]
        });

        if (txRes && txRes.code && txRes.code !== 0) {
            throw new Error(`Failed to set view icon: ${txRes.msg || "Unknown error"}`);
        }

        tableSyncTimes.delete(avID);
        await instantiateAV(avID, true);
        if (!options?.skipRender) await triggerAvBlockRender(avID);

        return {
            success: true,
            message: `View '${viewName}' icon in table '${tableName}' updated to '${iconVal}'.`
        };
    }

    // --- 处理 Pattern 1: SET COLUMN HIDDEN ---
    const viewName = (alterColMatch![1] || alterColMatch![2] || "").trim();
    const tableName = (alterColMatch![3] || alterColMatch![4] || "").trim();
    const colName = (alterColMatch![5] || alterColMatch![6] || "").trim();
    const hiddenRaw = alterColMatch![7].trim().toLowerCase();
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

/**
 * 为 Command-DB 自动创建两个专有视图：
 * 1. "普通命令" 视图：仅显示非 Pipeline 的常规命令，隐藏 Pipeline_定义 列；
 * 2. "复合命令" 视图：仅显示配置了 Pipeline_定义 的复合命令，展开显示 Pipeline_定义 列。
 */
export async function createCommandDbViews(avID: string, avBlockID: string, db: any): Promise<void> {
    try {
        console.log(`[ViewManager] 正在为 Command-DB (avID: ${avID}) 自动构建普通命令与复合命令视图...`);

        // 1. 获取思源生成的默认初始视图
        const avData = await post("/api/av/renderAttributeView", { id: avID });
        const viewsList = avData.views || avData.view?.views || [];
        const defaultView = viewsList.length > 0 ? viewsList[0] : null;
        const defaultViewID = defaultView ? defaultView.id : generateNodeId();

        // 2. 查找 复合命令定义 / Pipeline_定义 列的 keyID
        const pipelineColRes = db.exec(`SELECT key_id, key_type FROM _av_schema WHERE av_id = ? AND (col_name LIKE '%Pipeline%' OR key_name LIKE '%Pipeline%' OR col_name LIKE '%复合%' OR key_name LIKE '%复合%')`, [avID]);
        let pipelineColKeyId = "";
        if (pipelineColRes.length > 0 && pipelineColRes[0].values.length > 0) {
            pipelineColKeyId = String(pipelineColRes[0].values[0][0]);
        }

        // 过滤器定义（使用思源标准操作符 "Is empty" 和 "Is not empty"）
        const filterNormal = pipelineColKeyId ? [
            {
                combination: "and",
                filters: [
                    {
                        column: pipelineColKeyId,
                        operator: "Is empty",
                        value: { type: "text", text: { content: "" } }
                    }
                ]
            }
        ] : [];

        const filterPipeline = pipelineColKeyId ? [
            {
                combination: "and",
                filters: [
                    {
                        column: pipelineColKeyId,
                        operator: "Is not empty",
                        value: { type: "text", text: { content: "" } }
                    }
                ]
            }
        ] : [];

        // ---------------------------------------------------------------------
        // 步骤 A: 直接将默认视图重命名为 "普通命令"，并施加 Is empty 过滤与隐藏 Pipeline 列
        // ---------------------------------------------------------------------
        const opsNormal: any[] = [];
        if (!defaultView) {
            opsNormal.push({ action: "addAttrViewView", avID, id: defaultViewID, blockID: avBlockID, layout: "table" });
        }
        opsNormal.push(
            { action: "setAttrViewViewName", avID, id: defaultViewID, blockID: avBlockID, data: "普通命令" },
            { action: "setAttrViewBlockView", avID, id: defaultViewID, blockID: avBlockID }
        );
        if (filterNormal.length > 0) {
            opsNormal.push({ action: "setAttrViewFilters", avID, data: filterNormal, blockID: avBlockID });
        }
        if (pipelineColKeyId) {
            opsNormal.push({ action: "setAttrViewColHidden", id: pipelineColKeyId, avID, data: true, blockID: avBlockID });
        }

        await post("/api/transactions", {
            reqId: Date.now(),
            app: "plugin-index",
            transactions: [{ doOperations: opsNormal }]
        });

        // ---------------------------------------------------------------------
        // 步骤 B: 创建第二个视图 "复合命令"，并施加 Is not empty 过滤与展开 Pipeline 列
        // ---------------------------------------------------------------------
        const viewPipelineID = generateNodeId();
        const opsPipeline: any[] = [
            { action: "addAttrViewView", avID, id: viewPipelineID, blockID: avBlockID, layout: "table" },
            { action: "setAttrViewViewName", avID, id: viewPipelineID, blockID: avBlockID, data: "复合命令" }
        ];
        if (filterPipeline.length > 0) {
            opsPipeline.push({ action: "setAttrViewFilters", avID, data: filterPipeline, blockID: avBlockID });
        }
        let cmdIdColKeyId = "";
        try {
            const cmdIdColRes = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (col_name LIKE '%Command ID%' OR col_name LIKE '%Command_ID%' OR key_name LIKE '%Command ID%' OR key_name LIKE '%Command_ID%')`, [avID]);
            if (cmdIdColRes.length > 0 && cmdIdColRes[0].values.length > 0) {
                cmdIdColKeyId = String(cmdIdColRes[0].values[0][0]);
            }
        } catch { /* ignore */ }

        if (pipelineColKeyId) {
            opsPipeline.push({ action: "setAttrViewColHidden", id: pipelineColKeyId, avID, data: false, blockID: avBlockID });
        }
        if (cmdIdColKeyId) {
            opsPipeline.push({ action: "setAttrViewColHidden", id: cmdIdColKeyId, avID, data: true, blockID: avBlockID });
        }

        await post("/api/transactions", {
            reqId: Date.now(),
            app: "plugin-index",
            transactions: [{ doOperations: opsPipeline }]
        });

        // 默认激活 "普通命令" 视图
        await post("/api/transactions", {
            reqId: Date.now(),
            app: "plugin-index",
            transactions: [{
                doOperations: [
                    { action: "setAttrViewBlockView", avID, id: defaultViewID, blockID: avBlockID }
                ]
            }]
        });

        console.log(`[ViewManager] Command-DB 视图重构完成：仅保留 "普通命令" 与 "复合命令" 双视图！`);
    } catch (err: any) {
        console.error(`[ViewManager] 构建 Command-DB 双视图失败:`, err);
    }
}
