import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep } from "../../shared/utils";
import { setCommandAvId, setTypeAvId, setCommandDocId, setTypeDocId } from "./registration";
import { getSqliteEngine, runQuery, instantiateAV, saveDatabaseToDisk } from "../sqlite/sqlite-manager";

const NOTEBOOK_NAME = "IndexOS";

/**
 * Initializes the Command & Type DB notebook and internal pages.
 * 1. Creates a Notebook called "IndexOS" (with dolphin icon 🐬) if it doesn't exist.
 * 2. Creates a Page called "命令管理" with a pure Attribute View.
 * 3. Creates a Page called "超级标签管理" with a pure Attribute View.
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

        // Set notebook icon to Dolphin 🐬 (hex: 1f42c)
        try {
            await post("/api/notebook/setNotebookIcon", { notebook: targetNotebookId, icon: "1f42c" });
            console.log(`[IndexOS] Set notebook icon for ${NOTEBOOK_NAME} to Dolphin 🐬`);
        } catch (iconErr) {
            console.warn(`[IndexOS] Failed to set notebook icon:`, iconErr);
        }

        // 2. Init Command-DB (命令管理)
        const commandDb = await initDbDoc(
            targetNotebookId,
            "命令管理",
            "custom-index-command-db",
            `# 命令管理\n\n该页面由 IndexOS 自动生成。这里是系统的 Layer 2，用于编排复合指令和参数流转。\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>\n`,
            "Command ID",
            async (avId) => {
                const addCol = async (name: string, type: string, icon: string, prevKey: string) => {
                    // @ts-ignore
                    const newID = window.Lute.NewNodeID();
                    await post("/api/av/addAttributeViewKey", {
                        avID: avId, keyID: newID, keyName: name, keyType: type, keyIcon: icon, previousKeyID: prevKey
                    });
                    await sleep(200);
                    return newID;
                };

                const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
                const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
                let lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";

                const commandIdKey = await addCol("Command ID", "text", "iconCode", lastKeyID);
                const paramMappingKey = await addCol("Param Mapping", "text", "iconList", commandIdKey);
                const topBarKey = await addCol("Top Bar", "checkbox", "iconLayout", paramMappingKey);
                const buttonKey = await addCol("Inline Button", "checkbox", "iconPlay", topBarKey);
                const paletteKey = await addCol("Command Palette", "checkbox", "iconSearch", buttonKey);

                // Fetch seed data from SQLite sys_command_db
                const seedRes = await runQuery(`SELECT rowID, label, Command_ID, Param_Mapping, Top_Bar, Inline_Button, Command_Palette FROM sys_command_db`);

                // Insert seed items as detached rows
                const addRows: any[] = [];
                for (const match of seedRes.values) {
                    const [rowID] = match;
                    addRows.push({
                        itemID: rowID,
                        id: "",
                        isDetached: true
                    });
                }

                if (addRows.length > 0) {
                    console.log(`[IndexOS] Adding ${addRows.length} detached rows to Command-DB AV ${avId}...`);
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(500);
                }

                // Query primary key column to populate labels
                const checkKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
                const checkKeys = Array.isArray(checkKeysRes) ? checkKeysRes : (checkKeysRes.keys || []);
                const primaryKeyCol = checkKeys.find((k: any) => k.type === "block" || k.name === "主键" || k.name === "Primary Key");
                const primaryKeyId = primaryKeyCol?.id || checkKeys[0]?.id;

                const populateOps: any[] = [];
                for (const match of seedRes.values) {
                    const [rowID, labelVal, commandID, paramMapping, topBar, inlineButton, commandPalette] = match;
                    
                    if (primaryKeyId) {
                        populateOps.push({
                            keyID: primaryKeyId,
                            itemID: rowID,
                            value: { type: "block", block: { content: String(labelVal || "") } }
                        });
                    }

                    populateOps.push({ keyID: commandIdKey, itemID: rowID, value: { type: "text", text: { content: String(commandID || "") } } });
                    populateOps.push({ keyID: paramMappingKey, itemID: rowID, value: { type: "text", text: { content: String(paramMapping || "") } } });
                    populateOps.push({ keyID: topBarKey, itemID: rowID, value: { type: "checkbox", checkbox: { checked: Number(topBar) === 1 } } });
                    populateOps.push({ keyID: buttonKey, itemID: rowID, value: { type: "checkbox", checkbox: { checked: Number(inlineButton) === 1 } } });
                    populateOps.push({ keyID: paletteKey, itemID: rowID, value: { type: "checkbox", checkbox: { checked: Number(commandPalette) === 1 } } });
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        // 3. Init Type-DB (超级标签管理)
        const typeDb = await initDbDoc(
            targetNotebookId,
            "超级标签管理",
            "custom-index-type-db",
            `# 超级标签管理\n\n该页面由 IndexOS 自动生成。这里是系统的 Layer 3，用于将逻辑工厂中的复合命令绑定到特定的 Supertag 上，并配置参数映射。**主键（第一列）即为需要绑定的 Supertag 名称（如 #Project 或 任何类名）。**\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>\n`,
            "Block Icon Menu",
            async (avId) => {
                const addCol = async (name: string, type: string, icon: string, prevKey: string) => {
                    // @ts-ignore
                    const newID = window.Lute.NewNodeID();
                    await post("/api/av/addAttributeViewKey", {
                        avID: avId, keyID: newID, keyName: name, keyType: type, keyIcon: icon, previousKeyID: prevKey
                    });
                    await sleep(200);
                    return newID;
                };

                const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
                const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
                let lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";

                const blockMenuKey = await addCol("Block Icon Menu", "text", "iconMenu", lastKeyID);
                const pageMenuKey = await addCol("Current Page Menu", "text", "iconFile", blockMenuKey);
                const onCreateKey = await addCol("On Create", "text", "iconPlay", pageMenuKey);

                // Fetch seed data from SQLite sys_type_db
                const seedRes = await runQuery(`SELECT rowID, supertag, Block_Icon_Menu, Current_Page_Menu, On_Create FROM sys_type_db`);

                // Insert seed items as detached rows
                const addRows: any[] = [];
                for (const match of seedRes.values) {
                    const [rowID] = match;
                    addRows.push({
                        itemID: rowID,
                        id: "",
                        isDetached: true
                    });
                }

                if (addRows.length > 0) {
                    console.log(`[IndexOS] Adding ${addRows.length} detached rows to Type-DB AV ${avId}...`);
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(500);
                }

                // Query primary key column to populate labels
                const checkKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
                const checkKeys = Array.isArray(checkKeysRes) ? checkKeysRes : (checkKeysRes.keys || []);
                const primaryKeyCol = checkKeys.find((k: any) => k.type === "block" || k.name === "主键" || k.name === "Primary Key");
                const primaryKeyId = primaryKeyCol?.id || checkKeys[0]?.id;

                const populateOps: any[] = [];
                for (const match of seedRes.values) {
                    const [rowID, supertag, blockMenu, pageMenu, onCreate] = match;
                    
                    if (primaryKeyId) {
                        populateOps.push({
                            keyID: primaryKeyId,
                            itemID: rowID,
                            value: { type: "block", block: { content: String(supertag || "") } }
                        });
                    }

                    populateOps.push({ keyID: blockMenuKey, itemID: rowID, value: { type: "text", text: { content: String(blockMenu || "") } } });
                    populateOps.push({ keyID: pageMenuKey, itemID: rowID, value: { type: "text", text: { content: String(pageMenu || "") } } });
                    populateOps.push({ keyID: onCreateKey, itemID: rowID, value: { type: "text", text: { content: String(onCreate || "") } } });
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
        const addKeyRes = await post("/api/av/addAttributeViewKey", {
            avID: commandAvId,
            keyID: commandRelKeyId,
            keyName: "绑定类",
            keyType: "relation",
            keyIcon: "iconLink",
            previousKeyID: lastKeyID
        });
        console.log("[IndexOS-Debug] addAttributeViewKey response:", addKeyRes);
        await sleep(1500); // Sleep longer to ensure file write completes
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
            
            console.log(`[IndexOS-Debug] Sending transaction payload (attempt ${attempt}):`, JSON.stringify(txPayload));
            const txRes = await post("/api/transactions", txPayload);
            console.log(`[IndexOS-Debug] transactions response (attempt ${attempt}):`, txRes);
            
            // Poll to verify relation in Command-DB
            for (let i = 0; i < 20; i++) { // Poll for up to 4 seconds (20 * 200ms)
                await sleep(200);
                const checkKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: commandAvId });
                const checkKeys = Array.isArray(checkKeysRes) ? checkKeysRes : (checkKeysRes.keys || []);
                const checkRelKey = checkKeys.find((k: any) => k.name === "绑定类" && k.type === "relation");
                
                if (checkRelKey?.relation?.avID === typeAvId && checkRelKey?.relation?.isTwoWay) {
                    console.log(`[IndexOS] Bidirectional relation successfully established and verified on attempt ${attempt} in ${i * 200}ms!`);
                    isLinkedAfterTx = true;
                    break;
                }
            }
            
            if (isLinkedAfterTx) {
                break;
            } else {
                console.warn(`[IndexOS] Attempt ${attempt} failed to establish/verify relation. Waiting 1.5s before retry...`);
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
    console.log("[IndexOS] Binding default relation values...");
    
    const commandRender = await post("/api/av/renderAttributeView", { id: commandAvId });
    const commandRows = commandRender?.view?.rows || commandRender?.rows || [];

    const typeRender = await post("/api/av/renderAttributeView", { id: typeAvId });
    const typeRows = typeRender?.view?.rows || typeRender?.rows || [];

    console.log(`[IndexOS-Debug] bindDefaultRelation commandRows: ${commandRows.length}, typeRows: ${typeRows.length}`);

    let graphViewRowId = "";
    let fireworksRowId = "";
    let showMessageRowId = "";
    let projectRowId = "";
    let personRowId = "";

    for (const row of commandRows) {
        const firstCell = row.cells[0];
        const label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
        console.log(`[IndexOS-Debug] Command Row ID: ${row.id}, Label: "${label}"`);
        if (label.includes("全局关系图")) {
            graphViewRowId = row.id;
        } else if (label.includes("烟花")) {
            fireworksRowId = row.id;
        } else if (label.includes("消息提示")) {
            showMessageRowId = row.id;
        }
    }

    for (const row of typeRows) {
        const firstCell = row.cells[0];
        const label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
        console.log(`[IndexOS-Debug] Type Row ID: ${row.id}, Label: "${label}"`);
        if (label.toLowerCase().includes("#project")) {
            projectRowId = row.id;
        } else if (label.toLowerCase().includes("#person")) {
            personRowId = row.id;
        }
    }

    console.log(`[IndexOS-Debug] Resolved IDs:
      - graphViewRowId: ${graphViewRowId}
      - fireworksRowId: ${fireworksRowId}
      - showMessageRowId: ${showMessageRowId}
      - projectRowId: ${projectRowId}
      - personRowId: ${personRowId}`);

    const typeKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
    const typeKeys = Array.isArray(typeKeysRes) ? typeKeysRes : (typeKeysRes.keys || []);
    const typeRelKey = typeKeys.find((k: any) => k.name === "绑定命令" && k.type === "relation");

    if (!typeRelKey) {
        console.warn("[IndexOS] Relation key '绑定命令' not found in Type-DB keys.");
        return;
    }

    const typeRelKeyId = typeRelKey.id;
    const batchValues: any[] = [];

    if (projectRowId && graphViewRowId) {
        console.log(`[IndexOS] Binding Project (${projectRowId}) to Graph View (${graphViewRowId})...`);
        batchValues.push({
            keyID: typeRelKeyId,
            itemID: projectRowId,
            value: {
                type: "relation",
                relation: {
                    blockIDs: [graphViewRowId]
                }
            }
        });
    } else {
        console.warn(`[IndexOS] Cannot bind Project: projectRowId or graphViewRowId is missing.`);
    }

    if (personRowId && fireworksRowId && showMessageRowId) {
        console.log(`[IndexOS] Binding Person (${personRowId}) to [Fireworks (${fireworksRowId}), ShowMessage (${showMessageRowId})]...`);
        batchValues.push({
            keyID: typeRelKeyId,
            itemID: personRowId,
            value: {
                type: "relation",
                relation: {
                    blockIDs: [fireworksRowId, showMessageRowId]
                }
            }
        });
    } else {
        console.warn(`[IndexOS] Cannot bind Person: personRowId, fireworksRowId, or showMessageRowId is missing.`);
    }

    if (batchValues.length > 0) {
        const batchRes = await post("/api/av/batchSetAttributeViewBlockAttrs", {
            avID: typeAvId,
            values: batchValues
        });
        console.log("[IndexOS-Debug] batchSetAttributeViewBlockAttrs response:", batchRes);
        console.log("[IndexOS] Default relation bindings updated successfully!");
    } else {
        console.warn("[IndexOS] No relation bindings to update.");
    }
}

async function initDbDoc(
    notebookId: string,
    docName: string,
    attrName: string,
    initMarkdown: string,
    expectedColName: string,
    initColsCallback: (avId: string) => Promise<void>
): Promise<{ docId: string; avId: string }> {
    // 0. Check via attributes first
    const sql = `SELECT root_id FROM attributes WHERE name = '${attrName}' LIMIT 1`;
    const existingDocs = await post("/api/query/sql", { stmt: sql });
    if (existingDocs && existingDocs.length > 0) {
        const docId = existingDocs[0].root_id;
        console.log(`[IndexOS] Found existing system db [${docName}] via attr: doc=${docId}`);
        
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
    const hPath = `/${docName}`;
    const docPath = `${hPath}.sy`;
    let docId = null;

    try {
        const checkRes = await post("/api/filetree/getIDsByHPath", { path: hPath, notebook: notebookId });
        if (checkRes && checkRes.length > 0) {
            docId = checkRes[0];
        }
    } catch (e) {
        console.warn(`[IndexOS] Error checking hpath for ${docName}:`, e);
    }

    if (!docId) {
        console.log(`[IndexOS] ${docName} doc not found, creating new...`);
        try {
            // Attempt to insert markdown
            const createRes = await post("/api/filetree/createDocWithMd", {
                notebook: notebookId,
                path: docPath,
                markdown: initMarkdown
            });
            docId = createRes;
        } catch (e) {
            console.error(`[IndexOS] createDocWithMd failed for ${docName}`, e);
        }
    } else {
        console.log(`[IndexOS] Doc already exists (but attr was missing): ${docId}`);
    }

    let avId = "";

    // 2. Mark the document with the special attribute
    if (docId) {
        await post("/api/attr/setBlockAttrs", {
            id: docId,
            attrs: {
                [attrName]: "true"
            }
        });

        // 3. Locate the Attribute View block directly
        console.log(`[IndexOS] Waiting for indexing on ${docId} for ${docName}...`);
        await sleep(2000);
        
        const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
        const avRes = await post("/api/query/sql", { stmt: avSql });

        if (avRes && avRes.length > 0) {
            const avBlockId = avRes[0].id;
            const domRes = await client.getBlockDOM({ id: avBlockId });
            const html = domRes.data?.dom || "";
            const match = html.match(/data-av-id="([^"]+)"/);
            avId = match ? match[1] : avBlockId;

            if (avId) {
                // Pre-render to force Siyuan to instantiate the default view in its database engine
                console.log(`[IndexOS] Pre-rendering AV ${avId} to initialize view...`);
                await post("/api/av/renderAttributeView", { id: avId });
                await sleep(500);

                // Check if it is already initialized by checking if the expected custom column exists
                const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
                const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
                const isAlreadyInitialized = currentKeys.some((k: any) => k.name === expectedColName);

                if (!isAlreadyInitialized) {
                    await initColsCallback(avId);
                    console.log(`[IndexOS] DB columns and detached rows initialized for ${docName}.`);
                }
            }
        } else {
            console.warn(`[IndexOS] Failed to find the AV block in ${docName}.`);
        }
    }

    return { docId: docId || "", avId };
}
