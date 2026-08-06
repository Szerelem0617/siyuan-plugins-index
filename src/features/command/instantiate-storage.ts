import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep } from "../../shared/utils";
import { setCommandAvId, setTypeAvId, setCommandDocId, setTypeDocId } from "./registration";
import { instantiateAV } from "../sqlite/sqlite-manager";
import {
    NOTEBOOK_NAME, 
    NOTEBOOK_ICON, 
    COMMAND_DB_CONFIG, 
    TYPE_DB_CONFIG, 
    DEFAULT_RELATION_BINDINGS,
    ColumnMeta,
    DbPageConfig,
    getSeedCommandRows,
    getSeedSupertagRows
} from "./indexos/seed-data";
import { DEFAULT_ENTRY_CONFIG, ENTRY_CONFIG_KEY } from "./entry-config";
import { getOrCreateDataDbsParentDoc, getOrStoreDataDbDoc } from "./data-db-management";
export { getOrStoreDataDbDoc };

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
            const res = await post("/api/notebook/createNotebook", { name: NOTEBOOK_NAME });
            targetNotebookId = res.notebook.id;
            await sleep(500);
        }

        // Set notebook icon to NOTEBOOK_ICON
        try {
            await post("/api/notebook/setNotebookIcon", { notebook: targetNotebookId, icon: NOTEBOOK_ICON });
        } catch (iconErr) {
            console.warn(`[IndexOS] Failed to set notebook icon:`, iconErr);
        }

        // 2. Init Command-DB
        const commandDb = await initDbDoc(
            targetNotebookId,
            COMMAND_DB_CONFIG,
            async (avId) => {
                const keyMap = await createAvColumns(avId, COMMAND_DB_CONFIG.columns);

                // 从种子常量读取 Layer 2 默认行（不再依赖 SQLite 种子表）
                const seedRows = getSeedCommandRows();

                // Insert seed items as detached rows
                const addRows = seedRows.map(row => ({
                    itemID: row.rowID,
                    id: "",
                    isDetached: true
                }));

                if (addRows.length > 0) {
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(500);
                }

                // Query primary key column to populate labels
                const primaryKeyId = await getAvPrimaryKeyColId(avId);

                const populateOps: any[] = [];
                for (const row of seedRows) {
                    if (primaryKeyId) {
                        populateOps.push({
                            keyID: primaryKeyId,
                            itemID: row.rowID,
                            value: { type: "block", block: { content: String(row.label || "") } }
                        });
                    }

                    populateOps.push({ keyID: keyMap["Command ID"], itemID: row.rowID, value: { type: "text", text: { content: String(row.commandID || "") } } });
                    populateOps.push({ keyID: keyMap["Param Mapping"], itemID: row.rowID, value: { type: "text", text: { content: String(row.paramMapping || "") } } });
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        // 入口配置随库实例化：默认配置写入 Command-DB 数据库块 custom attributes
        if (commandDb?.blockId) {
            await post("/api/attr/setBlockAttrs", {
                id: commandDb.blockId,
                attrs: { [ENTRY_CONFIG_KEY]: JSON.stringify(DEFAULT_ENTRY_CONFIG) }
            });
        }

        // 3. Init Type-DB
        const typeDb = await initDbDoc(
            targetNotebookId,
            TYPE_DB_CONFIG,
            async (avId) => {
                // 建立双向关联列 '绑定命令' <-> '绑定类'
                if (commandDb?.avId) {
                    await establishDbRelation(commandDb.avId, avId);
                }

                const keyMap = await createAvColumns(avId, TYPE_DB_CONFIG.columns);

                // 从种子常量读取 Layer 3 默认行（不再依赖 SQLite 种子表）
                const seedRows = getSeedSupertagRows();

                // Insert seed items as detached rows
                const addRows = seedRows.map(row => ({
                    itemID: row.rowID,
                    id: "",
                    isDetached: true
                }));

                if (addRows.length > 0) {
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(500);
                }

                // Query primary key column to populate labels
                const primaryKeyId = await getAvPrimaryKeyColId(avId);

                const populateOps: any[] = [];
                for (const row of seedRows) {
                    // 主键标签统一剥离 # 并且不转大写，全小写 (无 backwards capability)
                    const cleanSupertag = String(row.supertag || "").replace(/^#/, "").trim().toLowerCase();
                    
                    if (primaryKeyId) {
                        populateOps.push({
                            keyID: primaryKeyId,
                            itemID: row.rowID,
                            value: { type: "block", block: { content: cleanSupertag } }
                        });
                    }

                    // 自动清洗与纠错：将旧有中文指令名转换为绝对 Command ID
                    let cleanIconMenuVal = String(row.iconMenu || "").trim();
                    if (cleanIconMenuVal.includes("安全更新")) {
                        cleanIconMenuVal = "plugin-index.command.safeUpdateBlock";
                    }

                    populateOps.push({ keyID: keyMap["Icon menu & button"], itemID: row.rowID, value: { type: "text", text: { content: cleanIconMenuVal } } });
                    populateOps.push({ keyID: keyMap["Conditional"], itemID: row.rowID, value: { type: "text", text: { content: String(row.conditional || "") } } });
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        // 4. Init Parent Page data-dbs and initial Child Page (Databases 1)
        await getOrCreateDataDbsParentDoc(targetNotebookId);

        if (commandDb?.avId && typeDb?.avId) {
            await establishDbRelation(commandDb.avId, typeDb.avId);

            // Set global registration variables
            setCommandAvId(commandDb.avId);
            setTypeAvId(typeDb.avId);
            setCommandDocId(commandDb.docId);
            setTypeDocId(typeDb.docId);

            // Sync the newly created AVs into SQLite av_ tables
            await instantiateAV(commandDb.avId, true);
            await instantiateAV(typeDb.avId, true);
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
    }

    // 1. 默认隐藏 Command-DB 中的 Command ID 列，防止用户误改
    try {
        const cmdKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: commandAvId });
        const cmdKeys = Array.isArray(cmdKeysRes) ? cmdKeysRes : (cmdKeysRes.keys || []);
        const cmdIdKey = cmdKeys.find((k: any) => k.name === "Command ID" || k.name === "Command_ID");
        if (cmdIdKey) {
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{
                    doOperations: [{
                        action: "setAttrViewColHidden",
                        avID: commandAvId,
                        blockID: commandAvId,
                        id: cmdIdKey.id,
                        data: true
                    }]
                }]
            });
        }
    } catch (cmdHideErr) {
        console.warn("[IndexOS] Error hiding Command ID column:", cmdHideErr);
    }

    // 2. 将 Supertag-DB 中的 '绑定命令' 列排在主键（第一列）右侧，更符合逻辑流向
    try {
        const typeKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
        const typeKeys = Array.isArray(typeKeysRes) ? typeKeysRes : (typeKeysRes.keys || []);
        const primaryKeyCol = typeKeys.find((k: any) => k.type === "block" || k.name === "主键" || k.name === "Primary Key") || typeKeys[0];
        const typeRelKey = typeKeys.find((k: any) => k.name === "绑定命令" && k.type === "relation");

        if (primaryKeyCol && typeRelKey) {
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{
                    doOperations: [{
                        action: "updateAttrViewCol",
                        avID: typeAvId,
                        keyID: typeRelKey.id,
                        id: typeRelKey.id,
                        name: "绑定命令",
                        type: "relation",
                        previousKeyID: primaryKeyCol.id
                    }]
                }]
            });
        }
    } catch (orderErr) {
        console.warn("[IndexOS] Error reordering 绑定命令 column:", orderErr);
    }

    await bindDefaultRelation(commandAvId, typeAvId);
}

async function bindDefaultRelation(commandAvId: string, typeAvId: string) {
    
    const commandRender = await post("/api/av/renderAttributeView", { id: commandAvId });
    const commandRows = commandRender?.view?.rows || commandRender?.rows || [];

    const typeRender = await post("/api/av/renderAttributeView", { id: typeAvId });
    const typeRows = typeRender?.view?.rows || typeRender?.rows || [];

    // Map labels to row IDs
    // Map Command IDs to Command Row IDs or Command IDs directly
    const commandMap: Record<string, string> = {};
    const commandIdIdx = (commandRender?.view?.columns || commandRender?.columns || []).findIndex((c: any) => c.name === "Command ID" || c.name === "Command_ID");
    
    for (const row of commandRows) {
        let cmdId = "";
        if (commandIdIdx !== -1 && row.cells[commandIdIdx]) {
            cmdId = row.cells[commandIdIdx]?.value?.text?.content || row.cells[commandIdIdx]?.value?.mText?.content || "";
        }
        if (!cmdId) {
            const firstCell = row.cells[0];
            cmdId = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
        }
        if (cmdId) {
            commandMap[cmdId.trim()] = row.id;
        }
    }

    const primaryKeyId = await getAvPrimaryKeyColId(typeAvId);
    
    const SEED_ROW_ID_MAP: Record<string, string> = {
        "20260526204605-7hun58a": "project",
        "20260526204605-v11e2ta": "task",
        "20260721140000-pipeline": "pipeline",
        "20260721140000-permanent": "permanent"
    };

    // 1. 按照 supertag 名称将行进行分组
    const supertagRowGroups: Record<string, any[]> = {};
    for (const row of typeRows) {
        const firstCell = row.cells[0];
        const label = (firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "").trim();
        let cleanLabel = label.replace(/^#/, "").toLowerCase();
        if (!cleanLabel && SEED_ROW_ID_MAP[row.id]) {
            cleanLabel = SEED_ROW_ID_MAP[row.id];
        }
        if (cleanLabel === "person") cleanLabel = "task";

        if (cleanLabel) {
            if (!supertagRowGroups[cleanLabel]) supertagRowGroups[cleanLabel] = [];
            supertagRowGroups[cleanLabel].push(row);
        }
    }

    const typeMap: Record<string, string> = {};
    const duplicateRowIdsToRemove: string[] = [];

    // 2. 为每个 supertag 选择唯一的为主种子行，并标记多余重复行进行清理
    for (const [tag, rows] of Object.entries(supertagRowGroups)) {
        let primaryRow = rows.find(r => SEED_ROW_ID_MAP[r.id] === tag);
        if (!primaryRow) {
            primaryRow = rows.find(r => r.cells.some((c: any) => c?.value?.text?.content || c?.value?.mText?.content)) || rows[0];
        }

        typeMap[tag] = primaryRow.id;

        const primaryLabel = (primaryRow.cells[0]?.value?.block?.content || primaryRow.cells[0]?.value?.mText?.content || primaryRow.cells[0]?.value?.text?.content || "").trim();
        if (primaryLabel !== tag && primaryKeyId) {
            await post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID: typeAvId,
                values: [{
                    keyID: primaryKeyId,
                    itemID: primaryRow.id,
                    value: { type: "block", block: { content: tag } }
                }]
            });
        }

        for (const row of rows) {
            if (row.id !== primaryRow.id) {
                duplicateRowIdsToRemove.push(row.id);
            }
        }
    }

    if (duplicateRowIdsToRemove.length > 0) {
        await post("/api/av/removeAttributeViewBlocks", {
            avID: typeAvId,
            srcs: duplicateRowIdsToRemove.map(id => ({ itemID: id }))
        });
        await sleep(500);
    }

    const typeKeysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
    const typeKeys = Array.isArray(typeKeysRes) ? typeKeysRes : (typeKeysRes.keys || []);
    const iconMenuKey = typeKeys.find((k: any) => k.name === "Icon Menu" || k.name === "Icon menu & button" || k.name === "图标菜单");
    const typeRelKey = typeKeys.find((k: any) => k.name === "绑定命令" && k.type === "relation");

    const batchValues: any[] = [];

    for (const binding of DEFAULT_RELATION_BINDINGS) {
        const cleanBindingType = binding.typeLabel.replace(/^#/, "").toLowerCase();
        const typeRowId = typeMap[cleanBindingType];
        if (!typeRowId) {
            continue;
        }

        // 1. Populate Icon Menu text column with exact Command IDs (NOT friendly Chinese label)
        if (iconMenuKey) {
            const validCommandIds: string[] = [];
            for (const cmdId of binding.iconMenuCmdIds) {
                if (cmdId) validCommandIds.push(cmdId);
            }
            batchValues.push({
                keyID: iconMenuKey.id,
                itemID: typeRowId,
                value: {
                    type: "text",
                    text: {
                        content: validCommandIds.join(", ")
                    }
                }
            });
        }

        // 2. Populate 绑定命令 AV Relation column with relationCmdIds
        if (typeRelKey) {
            const commandRowIds: string[] = [];
            for (const cmdId of binding.relationCmdIds) {
                if (commandMap[cmdId]) {
                    commandRowIds.push(commandMap[cmdId]);
                }
            }
            if (commandRowIds.length > 0) {
                batchValues.push({
                    keyID: typeRelKey.id,
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
    }

    if (batchValues.length > 0) {
        await post("/api/av/batchSetAttributeViewBlockAttrs", {
            avID: typeAvId,
            values: batchValues
        });
        console.log("[IndexOS-Debug] Default relation bindings updated successfully!");
    }
}

async function initDbDoc(
    notebookId: string,
    config: DbPageConfig,
    initColsCallback: (avId: string) => Promise<void>
): Promise<{ docId: string; avId: string; blockId: string }> {
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
            const avBlockId = avRes[0].id;
            const domRes = await client.getBlockDOM({ id: avRes[0].id });
            const html = domRes.data?.dom || "";
            const match = html.match(/data-av-id="([^"]+)"/);
            avId = match ? match[1] : avBlockId;
            return { docId, avId, blockId: avBlockId };
        }
        return { docId, avId, blockId: "" };
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
            const avTagMatch = docHtml.match(/<div[^>]+data-type="NodeAttributeView"[^>]*>/);
            if (avTagMatch) {
                const avTag = avTagMatch[0];
                const matchAvId = avTag.match(/data-av-id="([^"]+)"/);
                const matchBlockId = avTag.match(/data-node-id="([^"]+)"/);
                if (matchAvId) avId = matchAvId[1];
                if (matchBlockId) avBlockId = matchBlockId[1];
            }
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
    return { docId: docId || "", avId, blockId: avBlockId || docId || "" };
}
