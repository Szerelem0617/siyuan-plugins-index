import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep } from "../../shared/utils";
import { setCommandAvId, setTypeAvId, setCommandDocId, setTypeDocId } from "./registration";
import { instantiateAV, getSqliteEngine } from "../sqlite/sqlite-manager";
import { createCommandDbViews } from "../sqlite/run-query/view";
import {
    NOTEBOOK_NAME, 
    NOTEBOOK_ICON, 
    COMMAND_DB_CONFIG, 
    TYPE_DB_CONFIG, 
    ColumnMeta,
    DbPageConfig,
    getSeedCommandRows,
    getSeedSupertagRows
} from "./indexos/seed-data";
import { DEFAULT_ENTRY_CONFIG, ENTRY_CONFIG_KEY } from "./entry-config";
import { getOrCreateDataDbsParentDoc } from "./data-db-management";

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
                    if (keyMap["Input"]) populateOps.push({ keyID: keyMap["Input"], itemID: row.rowID, value: { type: "text", text: { content: row.inputMapping || "" } } });
                    if (keyMap["Output"]) populateOps.push({ keyID: keyMap["Output"], itemID: row.rowID, value: { type: "text", text: { content: row.outputMapping || "" } } });
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

        // 3. Init Type-DB (supertag-db)
        const typeDb = await initDbDoc(
            targetNotebookId,
            TYPE_DB_CONFIG,
            async (avId) => {
                const keyMap = await createAvColumns(avId, TYPE_DB_CONFIG.columns);

                // 确保 /data-dbs 父页面已就绪
                await getOrCreateDataDbsParentDoc(targetNotebookId);
                const { ensureSupertagDatabase } = await import("../unified-attributes/core/supertag-schema");
                const { supertagBinder } = await import("../unified-attributes/core/supertag-binder");
                const { supertagAVProjector } = await import("../unified-attributes/projection/supertag-av-projector");

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

                    // 写入 Manual 与 Auto 列
                    const cleanManualVal = String(row.manual || "").trim();
                    const cleanAutoVal = String(row.auto || "").trim();

                    const manualKey = keyMap["Manual"];
                    const autoKey = keyMap["Auto"];
                    const relatedAvKey = keyMap["Related av"];

                    if (manualKey) {
                        populateOps.push({ keyID: manualKey, itemID: row.rowID, value: { type: "text", text: { content: cleanManualVal } } });
                    }
                    if (autoKey) {
                        populateOps.push({ keyID: autoKey, itemID: row.rowID, value: { type: "text", text: { content: cleanAutoVal } } });
                    }

                    // 🌟 为内置 Supertag 自动建库并填充 Related av 列
                    if (relatedAvKey && cleanSupertag) {
                        try {
                            const subAvId = await ensureSupertagDatabase(cleanSupertag);
                            if (subAvId) {
                                populateOps.push({ keyID: relatedAvKey, itemID: row.rowID, value: { type: "text", text: { content: subAvId } } });
                                await supertagBinder.setPref(cleanSupertag, subAvId);
                                supertagAVProjector.bindTagToAV(cleanSupertag, subAvId);
                            }
                        } catch (subErr) {
                            console.warn(`[IndexOS] 为内置 Supertag #${cleanSupertag} 自动建库异常:`, subErr);
                        }
                    }
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        // 4. Init Parent Page data-dbs and initial Child Page (Databases 1)
        await getOrCreateDataDbsParentDoc(targetNotebookId);

        if (commandDb?.avId && typeDb?.avId) {
            // Set global registration variables
            setCommandAvId(commandDb.avId);
            setTypeAvId(typeDb.avId);
            setCommandDocId(commandDb.docId);
            setTypeDocId(typeDb.docId);

            // Sync the newly created AVs into SQLite av_ tables
            await instantiateAV(commandDb.avId, true);
            await instantiateAV(typeDb.avId, true);

            let avBlockId = commandDb.blockId;
            if (!avBlockId && commandDb.docId) {
                const resFind = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE root_id = '${commandDb.docId}' AND type = 'av' LIMIT 1`
                });
                if (resFind && resFind.length > 0) {
                    avBlockId = resFind[0].id;
                }
            }

            if (avBlockId) {
                const { db } = await getSqliteEngine();
                await createCommandDbViews(commandDb.avId, avBlockId, db);
            }
        }

        showMessage(`[IndexOS] 系统存储库初始化完成！`, 3000);

    } catch (e) {
        console.error("[IndexOS] Data construction failed:", e);
        showMessage(`初始化系统存储库失败: ${(e as Error).message}`, 4000, "error");
        throw e;
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
