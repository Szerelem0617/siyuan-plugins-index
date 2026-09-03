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
    SYSTEM_DOC_TITLE,
    SYSTEM_DOC_ATTR,
    DATA_DBS_CONFIG,
    COMMAND_DB_CONFIG, 
    TYPE_DB_CONFIG, 
    ColumnMeta,
    getSeedCommandRows,
    getSeedSupertagRows
} from "./indexos/seed-data";
import { DEFAULT_ENTRY_CONFIG, ENTRY_CONFIG_KEY } from "./entry-config";

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
 * 从 appendBlock 的返回响应中提取生成的 NodeAttributeView block ID
 */
function extractBlockIdFromAppendRes(res: any): string {
    try {
        const ops = res?.[0]?.doOperations || [];
        for (const op of ops) {
            if (op.data && op.data.includes("NodeAttributeView")) {
                const nodeMatch = op.data.match(/data-node-id=["']([^"']+)["']/);
                if (nodeMatch && nodeMatch[1]) return nodeMatch[1];
            }
        }
        for (const op of ops) {
            if (op.id) return op.id;
        }
    } catch (_) {}
    return "";
}

/**
 * 从指定块获取其 data-av-id
 */
async function getAvIdFromBlock(blockId: string): Promise<string> {
    if (!blockId) return "";
    try {
        const bRes = await client.getBlockDOM({ id: blockId });
        const html = bRes?.data?.dom || (bRes as any)?.dom || "";
        const match = html.match(/data-av-id="([^"]+)"/);
        if (match && match[1]) return match[1];
    } catch (_) {}
    return blockId;
}

/**
 * Helper to initialize an AV (clear default select col, rename table, call callback)
 */
async function setupAvTable(
    avId: string, 
    tableName: string, 
    expectedCol: string, 
    initColsCallback: (avId: string) => Promise<void>
) {
    await post("/api/av/renderAttributeView", { id: avId });
    await sleep(400);

    const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
    const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
    const isAlreadyInitialized = currentKeys.some((k: any) => k.name === expectedCol);

    if (!isAlreadyInitialized) {
        // 1. Remove default select column if present
        const defaultSelectKey = currentKeys.find((k: any) => k.type === "select");
        if (defaultSelectKey) {
            await post("/api/av/removeAttributeViewKey", {
                avID: avId,
                keyID: defaultSelectKey.id
            });
            await sleep(400);
        }

        // 2. Set database name
        await post("/api/transactions", {
            app: "plugin-index",
            reqId: Date.now() + 200,
            transactions: [{
                doOperations: [{
                    action: "setAttrViewName",
                    id: avId,
                    data: tableName
                }]
            }]
        });
        await sleep(400);

        // 3. Initialize columns & seed rows
        await initColsCallback(avId);
    }
}

/**
 * Initializes the Command & Type DB notebook and unified single page.
 */
export async function constructCommandStorage() {
    try {
        showMessage(`[IndexOS] 正在初始化系统存储库与实体页面...`, 2000);

        // 1. 查找或创建 IndexOS 笔记本
        const { notebooks } = await post("/api/notebook/lsNotebooks", {});
        let targetNotebookId = notebooks?.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed)?.id;

        if (!targetNotebookId) {
            const res = await post("/api/notebook/createNotebook", { name: NOTEBOOK_NAME });
            targetNotebookId = res.notebook.id;
            await sleep(500);
        }

        try {
            await post("/api/notebook/setNotebookIcon", { notebook: targetNotebookId, icon: NOTEBOOK_ICON });
        } catch (iconErr) {
            console.warn(`[IndexOS] Failed to set notebook icon:`, iconErr);
        }

        // 2. 严格新建或定位笔记本下的【独立实体子文档 (页面)】
        // 🚨 核心准则：严禁将数据写入顶层笔记本文档 (id === targetNotebookId)！必须且只能存放在独立的子页面中。
        let docId: string | null = null;
        
        // 优先在数据库中查找已存在的实体子文档（严格排除 id = targetNotebookId）
        const verifySql = `SELECT id FROM blocks WHERE box = '${targetNotebookId}' AND type = 'd' AND id != '${targetNotebookId}' AND (hpath = '/${SYSTEM_DOC_TITLE}' OR ial LIKE '%${SYSTEM_DOC_ATTR}%') LIMIT 1`;
        const verifyRes = await post("/api/query/sql", { stmt: verifySql });
        if (verifyRes && verifyRes.length > 0) {
            docId = verifyRes[0].id;
        }

        // 若尚无独立子页面，立即显式新建实体文档
        if (!docId) {
            console.log(`[IndexOS] 正在笔记本 ${targetNotebookId} 下新建固定实体页面 /${SYSTEM_DOC_TITLE}...`);
            const initialMd = `# ${SYSTEM_DOC_TITLE}\n\n> IndexOS 统一系统数据中心。包含命令管理、超级标签绑定与工作区数据表。\n`;
            const createRes = await post("/api/filetree/createDocWithMd", {
                notebook: targetNotebookId,
                path: `/${SYSTEM_DOC_TITLE}`,
                markdown: initialMd
            });
            const createdDocId = typeof createRes === "string" ? createRes : (createRes?.data || createRes?.id || "");
            if (createdDocId && createdDocId !== targetNotebookId) {
                docId = createdDocId;
            }
            await sleep(600);
        }

        // 二次防御：若依然未拿到有效子文档 ID，或误拿到了顶层笔记本文档 ID，强制报错拒绝写入
        if (!docId || docId === targetNotebookId) {
            throw new Error(`无法在 IndexOS 笔记本中创建独立的实体子页面 (拿到 ID: ${docId})，已拒绝写入顶层笔记本。`);
        }

        // 为该实体子页面挂载根属性标识
        await post("/api/attr/setBlockAttrs", {
            id: docId,
            attrs: {
                [SYSTEM_DOC_ATTR]: "true",
                [DATA_DBS_CONFIG.attrName]: "true"
            }
        });

        // 3. 在此独立子页面内定位或追加 command-db 与 supertag-db 两个数据表块
        let cmdBlockId = "";
        let typeBlockId = "";

        // 检查该实体子页面内是否已有 command-db 块
        const cmdAttrRes = await post("/api/query/sql", {
            stmt: `SELECT b.id FROM blocks b JOIN attributes a ON b.id = a.block_id WHERE a.name = '${COMMAND_DB_CONFIG.attrName}' AND b.root_id = '${docId}' LIMIT 1`
        });
        if (cmdAttrRes && cmdAttrRes.length > 0) {
            cmdBlockId = cmdAttrRes[0].id;
        }

        // 检查该实体子页面内是否已有 supertag-db 块
        const typeAttrRes = await post("/api/query/sql", {
            stmt: `SELECT b.id FROM blocks b JOIN attributes a ON b.id = a.block_id WHERE a.name = '${TYPE_DB_CONFIG.attrName}' AND b.root_id = '${docId}' LIMIT 1`
        });
        if (typeAttrRes && typeAttrRes.length > 0) {
            typeBlockId = typeAttrRes[0].id;
        }

        // 如果页面中尚无 command-db 块，依次向子页面追加标题与 AV 块
        if (!cmdBlockId) {
            await post("/api/block/appendBlock", {
                parentID: docId,
                dataType: "markdown",
                data: "## ⚡ 命令管理 (command-db)"
            });
            await sleep(200);

            const cmdAppendRes = await post("/api/block/appendBlock", {
                parentID: docId,
                dataType: "markdown",
                data: `<div data-type="NodeAttributeView" data-av-type="table"></div>`
            });
            cmdBlockId = extractBlockIdFromAppendRes(cmdAppendRes);
            await sleep(500);
        }

        // 如果页面中尚无 supertag-db 块，依次向子页面追加标题、AV 块及数据表汇总标题
        if (!typeBlockId) {
            await post("/api/block/appendBlock", {
                parentID: docId,
                dataType: "markdown",
                data: "## 🏷️ 超级标签 (supertag-db)"
            });
            await sleep(200);

            const typeAppendRes = await post("/api/block/appendBlock", {
                parentID: docId,
                dataType: "markdown",
                data: `<div data-type="NodeAttributeView" data-av-type="table"></div>`
            });
            typeBlockId = extractBlockIdFromAppendRes(typeAppendRes);
            await sleep(500);

            await post("/api/block/appendBlock", {
                parentID: docId,
                dataType: "markdown",
                data: "## 📦 数据表汇总 (data-dbs)"
            });
            await sleep(200);
        }

        // 提取精准的 avId
        const cmdAvId = await getAvIdFromBlock(cmdBlockId);
        const typeAvId = await getAvIdFromBlock(typeBlockId);

        // 为块注入唯一特征属性
        if (cmdBlockId) {
            await post("/api/attr/setBlockAttrs", {
                id: cmdBlockId,
                attrs: {
                    [COMMAND_DB_CONFIG.attrName]: "true",
                    "custom-av-name": "command-db",
                    [ENTRY_CONFIG_KEY]: JSON.stringify(DEFAULT_ENTRY_CONFIG)
                }
            });
        }
        if (typeBlockId) {
            await post("/api/attr/setBlockAttrs", {
                id: typeBlockId,
                attrs: {
                    [TYPE_DB_CONFIG.attrName]: "true",
                    "custom-av-name": "supertag-db"
                }
            });
        }

        // 4. 初始化 Command-DB 表结构与种子数据
        if (cmdAvId) {
            await setupAvTable(cmdAvId, "command-db", COMMAND_DB_CONFIG.expectedColName, async (avId) => {
                const keyMap = await createAvColumns(avId, COMMAND_DB_CONFIG.columns);
                const seedRows = getSeedCommandRows();
                const addRows = seedRows.map(row => ({
                    itemID: row.rowID,
                    id: "",
                    isDetached: true
                }));
                if (addRows.length > 0) {
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(400);
                }
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
            });
        }

        // 5. 初始化 Supertag-DB 表结构与种子数据
        if (typeAvId) {
            await setupAvTable(typeAvId, "supertag-db", TYPE_DB_CONFIG.expectedColName, async (avId) => {
                const keyMap = await createAvColumns(avId, TYPE_DB_CONFIG.columns);
                const { ensureSupertagDatabase } = await import("../unified-attributes/core/supertag-schema");
                const { supertagBinder } = await import("../unified-attributes/core/supertag-binder");
                const { supertagAVProjector } = await import("../unified-attributes/projection/supertag-av-projector");

                const seedRows = getSeedSupertagRows();
                const addRows = seedRows.map(row => ({
                    itemID: row.rowID,
                    id: "",
                    isDetached: true
                }));
                if (addRows.length > 0) {
                    await post("/api/av/addAttributeViewBlocks", { avID: avId, srcs: addRows });
                    await sleep(400);
                }
                const primaryKeyId = await getAvPrimaryKeyColId(avId);
                const populateOps: any[] = [];
                for (const row of seedRows) {
                    const cleanSupertag = String(row.supertag || "").replace(/^#/, "").trim().toLowerCase();
                    if (primaryKeyId) {
                        populateOps.push({
                            keyID: primaryKeyId,
                            itemID: row.rowID,
                            value: { type: "block", block: { content: cleanSupertag } }
                        });
                    }
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

                    // 为内置 Supertag 在当前实体子页面中创建专属数据表并关联
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
            });
        }

        // 6. 注册全局变量与 SQLite 内存视图
        if (cmdAvId && typeAvId) {
            setCommandAvId(cmdAvId);
            setTypeAvId(typeAvId);
            setCommandDocId(docId);
            setTypeDocId(docId);

            await instantiateAV(cmdAvId, true);
            await instantiateAV(typeAvId, true);

            if (cmdBlockId) {
                const { db } = await getSqliteEngine();
                await createCommandDbViews(cmdAvId, cmdBlockId, db);
            }
        }

        showMessage(`[IndexOS] 实体页面存储库初始化完成！`, 3000);
    } catch (e) {
        console.error("[IndexOS] Data construction failed:", e);
        showMessage(`初始化系统存储库失败: ${(e as Error).message}`, 4000, "error");
        throw e;
    }
}
