import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep } from "../../shared/utils";
import { createDatabaseWithBlocks } from "../data/list/create-db";

const NOTEBOOK_NAME = "类与命令管理";

/**
 * Initializes the Command & Type DB notebook and internal pages.
 * 1. Creates a Notebook called "类与命令管理" if it doesn't exist.
 * 2. Creates a Page called "逻辑工厂 (Command-DB)" if it doesn't exist.
 * 3. Creates a Page called "类型绑定 (Type-DB)" if it doesn't exist.
 */
export async function constructCommandStorage() {
    try {
        showMessage(`[IndexOS] 正在初始化 4 层结构系统存储库...`, 2000);

        // 1. Get or Create Notebook
        const { notebooks } = await post("/api/notebook/lsNotebooks", {});
        let targetNotebookId = notebooks.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed)?.id;

        if (!targetNotebookId) {
            console.log(`[IndexOS] Notebook not found, creating new: ${NOTEBOOK_NAME}`);
            const res = await post("/api/notebook/createNotebook", { name: NOTEBOOK_NAME });
            targetNotebookId = res.notebook.id;
            await sleep(500);
        } else {
            console.log(`[IndexOS] Existing notebook found: ${targetNotebookId}`);
        }

        // 2. Init Command-DB (逻辑工厂)
        const commandDb = await initDbDoc(
            targetNotebookId,
            "逻辑工厂 (Command-DB)",
            "custom-index-command-db",
            `# 逻辑工厂 (Command-DB)\n\n该页面由 IndexOS 自动生成。这里是系统的 Layer 2，用于编排复合指令和参数流转。\n\n* 🌐 全局关系图 (无上下文测试)\n* 📥 收集箱 (无上下文测试)\n* ⬇️ 下方插入同级块\n* 📑 复制当前块\n* 🖇️ 复制块引用\n* 🔍 在右侧分屏打开\n`,
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
                const commandTypeKey = await addCol("Command Type", "text", "iconTags", paramMappingKey);
                const targetScopeKey = await addCol("Target Scope", "text", "iconFocus", commandTypeKey);
                const enableKey = await addCol("Enable", "checkbox", "iconCheck", targetScopeKey);
                const topBarKey = await addCol("Top Bar", "checkbox", "iconLayout", enableKey);
                const buttonKey = await addCol("Inline Button", "checkbox", "iconPlay", topBarKey);
                const paletteKey = await addCol("Command Palette", "checkbox", "iconSearch", buttonKey);

                // Fetch seed data from SQLite sys_command_db
                const { runQuery } = await import("../sqlite/sqlite-manager");
                const seedRes = await runQuery(`SELECT rowID, label, Command_ID, Param_Mapping, Command_Type, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette FROM sys_command_db`);

                await sleep(1000);
                const renderRes = await post("/api/av/renderAttributeView", { id: avId });
                const rows = renderRes.view?.rows || renderRes.rows || [];
                const populateOps: any[] = [];

                for (const row of rows) {
                    const firstCell = row.cells[0];
                    let label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";

                    const match = seedRes.values.find((r: any) => label.includes(String(r[1]).trim()));
                    if (match) {
                        const [rowID, labelVal, commandID, paramMapping, commandType, targetScope, enable, topBar, inlineButton, commandPalette] = match;
                        populateOps.push({ keyID: commandIdKey, itemID: row.id, value: { type: "text", text: { content: String(commandID || "") } } });
                        populateOps.push({ keyID: paramMappingKey, itemID: row.id, value: { type: "text", text: { content: String(paramMapping || "") } } });
                        populateOps.push({ keyID: commandTypeKey, itemID: row.id, value: { type: "text", text: { content: String(commandType || "") } } });
                        populateOps.push({ keyID: targetScopeKey, itemID: row.id, value: { type: "text", text: { content: String(targetScope || "") } } });
                        populateOps.push({ keyID: enableKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: Number(enable) === 1 } } });
                        populateOps.push({ keyID: topBarKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: Number(topBar) === 1 } } });
                        populateOps.push({ keyID: buttonKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: Number(inlineButton) === 1 } } });
                        populateOps.push({ keyID: paletteKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: Number(commandPalette) === 1 } } });
                    }
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        // 3. Init Type-DB (类型绑定)
        const typeDb = await initDbDoc(
            targetNotebookId,
            "类型绑定 (Type-DB)",
            "custom-index-type-db",
            `# 类型绑定 (Type-DB)\n\n该页面由 IndexOS 自动生成。这里是系统的 Layer 3，用于将逻辑工厂中的复合命令绑定到特定的 Supertag 上，并配置参数映射。**主键（第一列）即为需要绑定的 Supertag 名称（如 #Project 或 任何类名）。**\n\n* #Project\n* #Person\n`,
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
                const enableKey = await addCol("Enable", "checkbox", "iconCheck", pageMenuKey);

                // Fetch seed data from SQLite sys_type_db
                const { runQuery } = await import("../sqlite/sqlite-manager");
                const seedRes = await runQuery(`SELECT rowID, supertag, Block_Icon_Menu, Current_Page_Menu, Enable FROM sys_type_db`);

                await sleep(1000);
                const renderRes = await post("/api/av/renderAttributeView", { id: avId });
                const rows = renderRes.view?.rows || renderRes.rows || [];
                const populateOps: any[] = [];

                for (const row of rows) {
                    const firstCell = row.cells[0];
                    let label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";

                    const match = seedRes.values.find((r: any) => label.includes(String(r[1]).trim()));
                    if (match) {
                        const [rowID, supertag, blockMenu, pageMenu, enable] = match;
                        populateOps.push({ keyID: blockMenuKey, itemID: row.id, value: { type: "text", text: { content: String(blockMenu || "") } } });
                        populateOps.push({ keyID: pageMenuKey, itemID: row.id, value: { type: "text", text: { content: String(pageMenu || "") } } });
                        populateOps.push({ keyID: enableKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: Number(enable) === 1 } } });
                    }
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        if (commandDb?.avId && typeDb?.avId) {
            await establishDbRelation(commandDb.avId, typeDb.avId);

            // Set global registration variables
            const reg = await import("./registration");
            reg.commandAvId = commandDb.avId;
            reg.typeAvId = typeDb.avId;

            // Sync the newly created AVs into SQLite av_ tables
            const { instantiateAV, getSqliteEngine, saveDatabaseToDisk } = await import("../sqlite/sqlite-manager");
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

    let splitLRRowId = "";
    let graphViewRowId = "";
    let projectRowId = "";

    for (const row of commandRows) {
        const firstCell = row.cells[0];
        const label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
        if (label.includes("在右侧分屏打开")) {
            splitLRRowId = row.id;
        } else if (label.includes("全局关系图")) {
            graphViewRowId = row.id;
        }
    }

    for (const row of typeRows) {
        const firstCell = row.cells[0];
        const label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
        if (label.includes("#Project")) {
            projectRowId = row.id;
        }
    }

    if (!projectRowId || !splitLRRowId || !graphViewRowId) {
        console.warn("[IndexOS] Default rows not found. CommandRows:", commandRows.length, "TypeRows:", typeRows.length);
        return;
    }

    const typeKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
    const typeKeys = Array.isArray(typeKeysRes) ? typeKeysRes : (typeKeysRes.keys || []);
    const typeRelKey = typeKeys.find((k: any) => k.name === "绑定命令" && k.type === "relation");

    if (typeRelKey) {
        const typeRelKeyId = typeRelKey.id;
        console.log(`[IndexOS] Found type relation key: ${typeRelKeyId}. Binding row ${projectRowId} to [${splitLRRowId}, ${graphViewRowId}]...`);
        
        await post("/api/av/batchSetAttributeViewBlockAttrs", {
            avID: typeAvId,
            values: [
                {
                    keyID: typeRelKeyId,
                    itemID: projectRowId,
                    value: {
                        type: "relation",
                        relation: {
                            blockIDs: [splitLRRowId, graphViewRowId]
                        }
                    }
                }
            ]
        });
        console.log("[IndexOS] Default relation binding completed successfully!");
    } else {
        console.warn("[IndexOS] Relation key '绑定命令' not found in Type-DB keys.");
    }
}

async function initDbDoc(
    notebookId: string,
    docName: string,
    attrName: string,
    initMarkdown: string,
    initColsCallback: (avId: string) => Promise<void>
): Promise<{ docId: string; avId: string }> {
    // 0. Check via attributes first
    const sql = `SELECT root_id FROM attributes WHERE name = '${attrName}' LIMIT 1`;
    const existingDocs = await post("/api/query/sql", { stmt: sql });
    if (existingDocs && existingDocs.length > 0) {
        const docId = existingDocs[0].root_id;
        console.log(`[IndexOS] Found existing system db [${docName}] via attr: doc=${docId}`);
        
        let avId = "";
        const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' ORDER BY created ASC LIMIT 1`;
        const listRes = await post("/api/query/sql", { stmt: listSql });
        if (listRes && listRes.length > 0) {
            const listAttrsRes = await client.getBlockAttrs({ id: listRes[0].id });
            avId = listAttrsRes.data?.["custom-index-linked-av"] || "";
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
            console.log(`[IndexOS] Created doc ${docId} for ${docName}.`);
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

        // 3. Ensure the list is turned into a Database
        console.log(`[IndexOS] Waiting for indexing on ${docId} for ${docName}...`);
        await sleep(2000);
        const listSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'l' ORDER BY created ASC LIMIT 1`;
        const listRes = await post("/api/query/sql", { stmt: listSql });

        if (listRes && listRes.length > 0) {
            const listId = listRes[0].id;
            const listAttrsRes = await client.getBlockAttrs({ id: listId });
            const listAttrs = listAttrsRes.data || {};
            avId = listAttrs["custom-index-linked-av"] || "";

            if (!avId) {
                console.log(`[IndexOS] Converting list ${listId} to DB for ${docName}...`);
                await createDatabaseWithBlocks([listId], true, true);
                await sleep(1000);

                const newAttrsRes = await client.getBlockAttrs({ id: listId });
                const newAttrs = newAttrsRes.data || {};
                avId = newAttrs["custom-index-linked-av"] || "";

                if (avId) {
                    console.log(`[IndexOS] DB created with avID: ${avId}, injecting columns...`);
                    await initColsCallback(avId);
                    console.log(`[IndexOS] DB columns initialized for ${docName}.`);
                }
            } else {
                console.log(`[IndexOS] DB already exists and linked for ${docName}.`);
            }
        } else {
            console.warn(`[IndexOS] Failed to find the list block in ${docName} for DB conversion.`);
        }
    }

    return { docId: docId || "", avId };
}
