import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep } from "../../shared/utils";
import { setCommandAvId, setTypeAvId, setCommandDocId, setTypeDocId } from "./registration";
import { getSqliteEngine, runQuery, instantiateAV, saveDatabaseToDisk } from "../sqlite/sqlite-manager";
import { 
    NOTEBOOK_NAME, 
    NOTEBOOK_ICON, 
    COMMAND_DB_CONFIG, 
    TYPE_DB_CONFIG, 
    DEFAULT_RELATION_BINDINGS,
    ColumnMeta,
    DbPageConfig
} from "./indexos/seed-data";

/**
 * Helper to add columns to an Attribute View (AV)
 */
async function createAvColumns(avId: string, columns: ColumnMeta[]): Promise<Record<string, string>> {
    const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
    const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
    let lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";

    const keyMap: Record<string, string> = {};
    for (const col of columns) {
        // @ts-ignore
        const newID = window.Lute.NewNodeID();
        await post("/api/av/addAttributeViewKey", {
            avID: avId,
            keyID: newID,
            keyName: col.name,
            keyType: col.type,
            keyIcon: col.icon,
            previousKeyID: lastKeyID
        });
        await sleep(200);
        keyMap[col.name] = newID;
        lastKeyID = newID;
    }
    return keyMap;
}

/**
 * Helper to get the primary key column ID of an Attribute View
 */
async function getAvPrimaryKeyColId(avId: string): Promise<string> {
    const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
    const keys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
    const primaryKeyCol = keys.find((k: any) => k.type === "block" || k.name === "主键" || k.name === "Primary Key");
    return primaryKeyCol?.id || keys[0]?.id || "";
}

/**
 * Initializes the Command & Type DB notebook and internal pages.
 */
export async function constructCommandStorage() {
    try {
        showMessage(`[IndexOS] 正在以纯数据表模式初始化系统存储库...`, 2000);

        // 1. Get or Create Notebook
        const { notebooks } = await post("/api/notebook/lsNotebooks", {});
        let targetNotebookId = notebooks.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed)?.id;

        if (!targetNotebookId) {
            console.log(`[IndexOS] Notebook not found, creating new: ${NOTEBOOK_NAME}`);
            const res = await post("/api/notebook/createNotebook", { name: NOTEBOOK_NAME });
            targetNotebookId = res.notebook.id;
            await sleep(500);
        }

        // Set notebook icon to NOTEBOOK_ICON
        try {
            await post("/api/notebook/setNotebookIcon", { notebook: targetNotebookId, icon: NOTEBOOK_ICON });
            console.log(`[IndexOS] Set notebook icon for ${NOTEBOOK_NAME} to Dolphin`);
        } catch (iconErr) {
            console.warn(`[IndexOS] Failed to set notebook icon:`, iconErr);
        }

        // 2. Init Command-DB
        const commandDb = await initDbDoc(
            targetNotebookId,
            COMMAND_DB_CONFIG,
            async (avId) => {
                const keyMap = await createAvColumns(avId, COMMAND_DB_CONFIG.columns);

                // Fetch seed data from SQLite sys_command_db
                const seedRes = await runQuery(`SELECT rowID, label, Command_ID, Param_Mapping, UI_Entries FROM sys_command_db`);

                // Insert seed items as detached rows
                const addRows = seedRes.values.map(match => ({
                    itemID: match[0],
                    id: "",
                    isDetached: true
                }));

                if (addRows.length > 0) {
                    console.log(`[IndexOS] Adding ${addRows.length} detached rows to Command-DB AV ${avId}...`);
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(500);
                }

                // Query primary key column to populate labels
                const primaryKeyId = await getAvPrimaryKeyColId(avId);

                const populateOps: any[] = [];
                for (const match of seedRes.values) {
                    const [rowID, labelVal, commandID, paramMapping, uiEntries] = match;
                    
                    if (primaryKeyId) {
                        populateOps.push({
                            keyID: primaryKeyId,
                            itemID: rowID,
                            value: { type: "block", block: { content: String(labelVal || "") } }
                        });
                    }

                    populateOps.push({ keyID: keyMap["Command ID"], itemID: rowID, value: { type: "text", text: { content: String(commandID || "") } } });
                    populateOps.push({ keyID: keyMap["Param Mapping"], itemID: rowID, value: { type: "text", text: { content: String(paramMapping || "") } } });
                    populateOps.push({ keyID: keyMap["UI 入口"], itemID: rowID, value: { type: "text", text: { content: String(uiEntries || "") } } });
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        // 3. Init Type-DB
        const typeDb = await initDbDoc(
            targetNotebookId,
            TYPE_DB_CONFIG,
            async (avId) => {
                const keyMap = await createAvColumns(avId, TYPE_DB_CONFIG.columns);

                // Fetch seed data from SQLite sys_type_db
                const checkCols = await runQuery(`PRAGMA table_info(sys_type_db)`);
                const colNames = checkCols?.values?.map((c: any) => c[1]) || [];
                const querySql = colNames.includes("Icon_Menu") 
                    ? `SELECT rowID, supertag, Icon_Menu, Conditional FROM sys_type_db`
                    : `SELECT rowID, supertag, Block_Icon_Menu, Conditional FROM sys_type_db`;
                
                const seedRes = await runQuery(querySql);

                // Insert seed items as detached rows
                const addRows = seedRes.values.map(match => ({
                    itemID: match[0],
                    id: "",
                    isDetached: true
                }));

                if (addRows.length > 0) {
                    console.log(`[IndexOS] Adding ${addRows.length} detached rows to Type-DB AV ${avId}...`);
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(500);
                }

                // Query primary key column to populate labels
                const primaryKeyId = await getAvPrimaryKeyColId(avId);

                const populateOps: any[] = [];
                for (const match of seedRes.values) {
                    const [rowID, supertag, iconMenuVal, conditional] = match;
                    
                    if (primaryKeyId) {
                        populateOps.push({
                            keyID: primaryKeyId,
                            itemID: rowID,
                            value: { type: "block", block: { content: String(supertag || "") } }
                        });
                    }

                    populateOps.push({ keyID: keyMap["Icon Menu"], itemID: rowID, value: { type: "text", text: { content: String(iconMenuVal || "") } } });
                    populateOps.push({ keyID: keyMap["Conditional"], itemID: rowID, value: { type: "text", text: { content: String(conditional || "") } } });
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        if (commandDb?.avId && typeDb?.avId) {
            await establishDbRelation(commandDb.avId, typeDb.avId);

            // Set global registration variables
            setCommandAvId(commandDb.avId);
            setTypeAvId(typeDb.avId);
            setCommandDocId(commandDb.docId);
            setTypeDocId(typeDb.docId);

            // Sync the newly created AVs into SQLite av_ tables
            console.log("[IndexOS] Syncing newly initialized Command-DB and Type-DB to SQLite...");
            await instantiateAV(commandDb.avId, true);
            await instantiateAV(typeDb.avId, true);

            // Clean up the seed tables in SQLite to avoid duplicate data
            const { db } = await getSqliteEngine();
            db.run(`DROP TABLE IF EXISTS sys_command_db;`);
            db.run(`DROP TABLE IF EXISTS sys_type_db;`);
            await saveDatabaseToDisk();
            console.log("[IndexOS] Dropped sys_command_db and sys_type_db tables.");
        }

        showMessage(`[IndexOS] 系统存储库初始化完成！`, 3000);

    } catch (e) {
        console.error("[IndexOS] Data construction failed:", e);
        showMessage(`初始化系统存储库失败: ${(e as Error).message}`, 4000, "error");
        throw e;
    }
}

async function establishDbRelation(commandAvId: string, typeAvId: string) {
    console.log(`[IndexOS] Checking database relation between Command-DB (${commandAvId}) and Type-DB (${typeAvId})...`);
    
    // 1. Fetch current keys for Command-DB
    let keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: commandAvId });
    let currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
    
    // Clean up "绑定类" if it exists but has wrong type
    const existingKeyOfAnyType = currentKeys.find((k: any) => k.name === "绑定类");
    if (existingKeyOfAnyType && existingKeyOfAnyType.type !== "relation") {
        console.warn(`[IndexOS] Found key '绑定类' with wrong type '${existingKeyOfAnyType.type}'. Removing it...`);
        await post("/api/av/removeAttributeViewKey", {
            avID: commandAvId,
            keyID: existingKeyOfAnyType.id
        });
        await sleep(1000);
        // Refresh keys
        keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: commandAvId });
        currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
    }

    // Clean up "绑定命令" in Type-DB if it exists but has wrong type
    const typeKeysResBefore = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
    const typeKeysBefore = Array.isArray(typeKeysResBefore) ? typeKeysResBefore : (typeKeysResBefore.keys || []);
    const existingTypeKeyOfAnyType = typeKeysBefore.find((k: any) => k.name === "绑定命令");
    if (existingTypeKeyOfAnyType && existingTypeKeyOfAnyType.type !== "relation") {
        console.warn(`[IndexOS] Found key '绑定命令' in Type-DB with wrong type '${existingTypeKeyOfAnyType.type}'. Removing it...`);
        await post("/api/av/removeAttributeViewKey", {
            avID: typeAvId,
            keyID: existingTypeKeyOfAnyType.id
        });
        await sleep(1000);
    }

    const relationKey = currentKeys.find((k: any) => k.name === "绑定类" && k.type === "relation");
    let commandRelKeyId = relationKey?.id;
    const isLinked = relationKey?.relation?.avID === typeAvId && relationKey?.relation?.isTwoWay;

    if (!commandRelKeyId) {
        console.log("[IndexOS] Relation column '绑定类' not found. Creating key first...");
        const lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";
        
        // @ts-ignore
        commandRelKeyId = window.Lute.NewNodeID();
        await post("/api/av/addAttributeViewKey", {
            avID: commandAvId,
            keyID: commandRelKeyId,
            keyName: "绑定类",
            keyType: "relation",
            keyIcon: "iconLink",
            previousKeyID: lastKeyID
        });
        await sleep(1500);
    }

    if (!isLinked) {
        console.log("[IndexOS] Relation link is missing or incomplete. Establishing bidirectional relation...");
        
        let isLinkedAfterTx = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`[IndexOS] Sending relation transaction (attempt ${attempt})...`);
            
            // Re-fetch type keys to check if "绑定命令" already exists
            const typeKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
            const typeKeys = Array.isArray(typeKeysRes) ? typeKeysRes : (typeKeysRes.keys || []);
            const typeRelKey = typeKeys.find((k: any) => k.name === "绑定命令" && k.type === "relation");
            
            // @ts-ignore
            const typeRelKeyId = typeRelKey?.id || relationKey?.relation?.backKeyID || window.Lute.NewNodeID();
            
            const txPayload = {
                reqId: Date.now(),
                app: "plugin-index",
                transactions: [
                    {
                        doOperations: [
                            {
                                action: "updateAttrViewColRelation",
                                avID: commandAvId,
                                id: typeAvId,
                                keyID: commandRelKeyId,
                                isTwoWay: true,
                                backRelationKeyID: typeRelKeyId,
                                name: "绑定命令",
                                format: "绑定类"
                            }
                        ]
                    }
                ]
            };
            
            await post("/api/transactions", txPayload);
            
            // Poll to verify relation in Command-DB
            for (let i = 0; i < 20; i++) {
                await sleep(200);
                const checkKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: commandAvId });
                const checkKeys = Array.isArray(checkKeysRes) ? checkKeysRes : (checkKeysRes.keys || []);
                const checkRelKey = checkKeys.find((k: any) => k.name === "绑定类" && k.type === "relation");
                
                if (checkRelKey?.relation?.avID === typeAvId && checkRelKey?.relation?.isTwoWay) {
                    console.log(`[IndexOS] Bidirectional relation successfully established and verified on attempt ${attempt}!`);
                    isLinkedAfterTx = true;
                    break;
                }
            }
            
            if (isLinkedAfterTx) {
                break;
            } else {
                console.warn(`[IndexOS] Attempt ${attempt} failed. Retrying...`);
                await sleep(1500);
            }
        }
        
        if (!isLinkedAfterTx) {
            throw new Error("Failed to establish bidirectional relation between Command-DB and Type-DB after 3 attempts.");
        }
    } else {
        console.log("[IndexOS] Bidirectional relation '绑定类' <-> '绑定命令' is already set up and linked.");
    }

    await bindDefaultRelation(commandAvId, typeAvId);
}

async function bindDefaultRelation(commandAvId: string, typeAvId: string) {
    console.log("[IndexOS] Binding default relation values dynamically...");
    
    const commandRender = await post("/api/av/renderAttributeView", { id: commandAvId });
    const commandRows = commandRender?.view?.rows || commandRender?.rows || [];

    const typeRender = await post("/api/av/renderAttributeView", { id: typeAvId });
    const typeRows = typeRender?.view?.rows || typeRender?.rows || [];

    // Map labels to row IDs
    const commandMap: Record<string, string> = {};
    for (const row of commandRows) {
        const firstCell = row.cells[0];
        const label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
        commandMap[label.trim()] = row.id;
    }

    const typeMap: Record<string, string> = {};
    for (const row of typeRows) {
        const firstCell = row.cells[0];
        const label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
        typeMap[label.trim()] = row.id;
    }

    const typeKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
    const typeKeys = Array.isArray(typeKeysRes) ? typeKeysRes : (typeKeysRes.keys || []);
    const typeRelKey = typeKeys.find((k: any) => k.name === "绑定命令" && k.type === "relation");

    if (!typeRelKey) {
        console.warn("[IndexOS] Relation key '绑定命令' not found in Type-DB keys.");
        return;
    }

    const typeRelKeyId = typeRelKey.id;
    const batchValues: any[] = [];

    // Populate relation batch values from rules
    for (const binding of DEFAULT_RELATION_BINDINGS) {
        const typeRowId = typeMap[binding.typeLabel];
        if (!typeRowId) {
            console.warn(`[IndexOS] Could not find row ID for Supertag: ${binding.typeLabel}`);
            continue;
        }

        const commandRowIds: string[] = [];
        for (const cmdLabel of binding.commandLabels) {
            // Find command ID whose label matches (partial match supported)
            const matchedKey = Object.keys(commandMap).find(k => k.includes(cmdLabel));
            if (matchedKey && commandMap[matchedKey]) {
                commandRowIds.push(commandMap[matchedKey]);
            }
        }

        if (commandRowIds.length > 0) {
            console.log(`[IndexOS] Binding ${binding.typeLabel} to Commands: ${binding.commandLabels.join(", ")}`);
            batchValues.push({
                keyID: typeRelKeyId,
                itemID: typeRowId,
                value: {
                    type: "relation",
                    relation: {
                        blockIDs: commandRowIds
                    }
                }
            });
        }
    }

    if (batchValues.length > 0) {
        await post("/api/av/batchSetAttributeViewBlockAttrs", {
            avID: typeAvId,
            values: batchValues
        });
        console.log("[IndexOS] Default relation bindings updated successfully!");
    }
}

async function initDbDoc(
    notebookId: string,
    config: DbPageConfig,
    initColsCallback: (avId: string) => Promise<void>
): Promise<{ docId: string; avId: string }> {
    // 0. Check via attributes first
    const sql = `SELECT root_id FROM attributes WHERE name = '${config.attrName}' LIMIT 1`;
    const existingDocs = await post("/api/query/sql", { stmt: sql });
    if (existingDocs && existingDocs.length > 0) {
        const docId = existingDocs[0].root_id;
        console.log(`[IndexOS] Found existing system db [${config.title}] via attr: doc=${docId}`);
        
        let avId = "";
        const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
        const avRes = await post("/api/query/sql", { stmt: avSql });
        if (avRes && avRes.length > 0) {
            const domRes = await client.getBlockDOM({ id: avRes[0].id });
            const html = domRes.data?.dom || "";
            const match = html.match(/data-av-id="([^"]+)"/);
            avId = match ? match[1] : avRes[0].id;
        }
        return { docId, avId };
    }

    // 1. Get or Create Document
    const hPath = `/${config.title}`;
    const docPath = `${hPath}.sy`;
    let docId = null;

    try {
        const checkRes = await post("/api/filetree/getIDsByHPath", { path: hPath, notebook: notebookId });
        if (checkRes && checkRes.length > 0) {
            docId = checkRes[0];
        }
    } catch (e) {
        console.warn(`[IndexOS] Error checking hpath for ${config.title}:`, e);
    }

    if (!docId) {
        console.log(`[IndexOS] ${config.title} doc not found, creating new...`);
        try {
            const createRes = await post("/api/filetree/createDocWithMd", {
                notebook: notebookId,
                path: docPath,
                markdown: config.markdown
            });
            docId = createRes;
        } catch (e) {
            console.error(`[IndexOS] createDocWithMd failed for ${config.title}`, e);
        }
    }

    let avId = "";
    let avBlockId = "";

    if (docId) {
        // 1. Locate the Attribute View block ID and AV ID
        try {
            const docDomRes = await client.getBlockDOM({ id: docId });
            const docHtml = docDomRes.data?.dom || "";
            const matchAvId = docHtml.match(/data-av-id="([^"]+)"/);
            const matchBlockId = docHtml.match(/data-node-id="([^"]+)"[^>]*data-type="NodeAttributeView"/);
            if (matchAvId) avId = matchAvId[1];
            if (matchBlockId) avBlockId = matchBlockId[1];
        } catch (domErr) {
            console.warn(`[IndexOS] Direct DOM parsing failed, falling back to SQL:`, domErr);
        }

        if (!avId || !avBlockId) {
            console.log(`[IndexOS] Waiting for indexing on ${docId}...`);
            await sleep(2000);
            
            const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
            const avRes = await post("/api/query/sql", { stmt: avSql });

            if (avRes && avRes.length > 0) {
                avBlockId = avRes[0].id;
                const domRes = await client.getBlockDOM({ id: avBlockId });
                const html = domRes.data?.dom || "";
                const match = html.match(/data-av-id="([^"]+)"/);
                avId = match ? match[1] : avBlockId;
            }
        }

        const targetId = avBlockId || docId;
        console.log(`[IndexOS] Setting database identifying attribute ${config.attrName} on block ${targetId}`);
        await post("/api/attr/setBlockAttrs", {
            id: targetId,
            attrs: { [config.attrName]: "true" }
        });     
        if (avId) {
            console.log(`[IndexOS] Pre-rendering AV ${avId} to initialize view...`);
            await post("/api/av/renderAttributeView", { id: avId });
            await sleep(500);

            const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
            const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
            const isAlreadyInitialized = currentKeys.some((k: any) => k.name === config.expectedColName);

            if (!isAlreadyInitialized) {
                // 1. Remove default select column
                const defaultSelectKey = currentKeys.find((k: any) => k.type === "select");
                if (defaultSelectKey) {
                    await post("/api/av/removeAttributeViewKey", {
                        avID: avId,
                        keyID: defaultSelectKey.id
                    });
                    await sleep(500);
                }

                // 2. Set database name
                const dbTitle = config.attrName === "custom-index-command-db" ? "command-db" : "supertag-db";
                await post("/api/transactions", {
                    app: "plugin-index",
                    reqId: Date.now() + 200,
                    transactions: [{
                        doOperations: [{
                            action: "setAttrViewName",
                            id: avId,
                            data: dbTitle
                        }]
                    }]
                });
                await sleep(500);

                // 3. Initialize columns and seed rows
                await initColsCallback(avId);
            }
        }
    }
    return { docId: docId || "", avId };
}
