import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { sleep } from "../../shared/utils";
import { NOTEBOOK_NAME, DATA_DBS_CONFIG } from "./indexos/seed-data";
import { getColIDMap } from "../../shared/utils/av-utils";
import { registerColumnMeta, supertagAVProjector } from "../unified-attributes/projection/supertag-av-projector";
import { supertagBinder } from "../unified-attributes/core/supertag-binder";
import { executeDDL } from "../sqlite/run-query/ddl";
import { getSqliteEngine, resolveTableAvId, avIdToBlockIdMap } from "../sqlite/sqlite-manager";

/**
 * Check if the user has instantiated the data-dbs page/notebook.
 */
export async function isDataDbsInstantiated(): Promise<boolean> {
    try {
        const sql = `SELECT root_id FROM attributes WHERE name = '${DATA_DBS_CONFIG.attrName}' LIMIT 1`;
        const existingDocs = await post("/api/query/sql", { stmt: sql });
        if (existingDocs && existingDocs.length > 0) {
            return true;
        }

        const { notebooks } = await post("/api/notebook/lsNotebooks", {});
        const targetNotebookId = notebooks?.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed)?.id;
        if (!targetNotebookId) return false;

        const checkRes = await post("/api/filetree/getIDsByHPath", { path: `/${DATA_DBS_CONFIG.title}`, notebook: targetNotebookId });
        return Boolean(checkRes && checkRes.length > 0);
    } catch (e) {
        return false;
    }
}

/**
 * Gets or creates the parent doc `/data-dbs` under IndexOS notebook.
 */
export async function getOrCreateDataDbsParentDoc(notebookId: string): Promise<string> {
    // 1. Query by attr first
    const sql = `SELECT root_id FROM attributes WHERE name = '${DATA_DBS_CONFIG.attrName}' LIMIT 1`;
    const existingDocs = await post("/api/query/sql", { stmt: sql });
    if (existingDocs && existingDocs.length > 0) {
        return existingDocs[0].root_id;
    }

    const hPath = `/${DATA_DBS_CONFIG.title}`;
    let docId = null;

    try {
        const checkRes = await post("/api/filetree/getIDsByHPath", { path: hPath, notebook: notebookId });
        if (checkRes && checkRes.length > 0) docId = checkRes[0];
    } catch (e) { }

    if (!docId) {
        // Create doc at root of notebook using createDocWithMd (.sy path)
        const createRes = await post("/api/filetree/createDocWithMd", {
            notebook: notebookId,
            path: `/${DATA_DBS_CONFIG.title}.sy`,
            markdown: `# ${DATA_DBS_CONFIG.title}\n\nIndexOS 存储库的数据组件汇总（Layer 4）。\n`
        });
        docId = createRes;
    }

    if (docId) {
        await post("/api/attr/setBlockAttrs", {
            id: docId,
            attrs: { [DATA_DBS_CONFIG.attrName]: "true" }
        });
    }

    return docId || "";
}

/**
 * Gets or creates a child doc under data-dbs and creates a new AV database table inside it.
 */
export async function getOrStoreDataDbDoc(dbTitleName: string): Promise<{ docId: string; avId: string; blockId: string }> {
    try {
        const { notebooks } = await post("/api/notebook/lsNotebooks", {});
        let targetNotebookId = notebooks?.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed)?.id;

        if (!targetNotebookId) {
            const res = await post("/api/notebook/createNotebook", { name: NOTEBOOK_NAME });
            targetNotebookId = res.notebook.id;
            await sleep(500);
        }

        // 1. Get or Create parent data-dbs doc directly
        const dataDbsDocId = await getOrCreateDataDbsParentDoc(targetNotebookId);
        const targetSubDocId = dataDbsDocId;

        // 2. Check if an AV block with this name already exists in targetSubDocId
        const existingAvSql = `SELECT b.id, b.ial FROM blocks b WHERE b.root_id = '${targetSubDocId}' AND b.type = 'av' AND (b.ial LIKE '%${dbTitleName}%' OR b.markdown LIKE '%${dbTitleName}%') LIMIT 1`;
        const existingAvRes = await post("/api/query/sql", { stmt: existingAvSql });
        if (existingAvRes && existingAvRes.length > 0) {
            const existingBlockId = existingAvRes[0].id;
            const domRes = await client.getBlockDOM({ id: existingBlockId });
            const html = domRes.data?.dom || "";
            const match = html.match(/data-av-id="([^"]+)"/);
            const foundAvId = match ? match[1] : existingBlockId;
            return { docId: targetSubDocId, avId: foundAvId, blockId: existingBlockId };
        }

        // 3. Append a new Attribute View (AV) block into targetSubDocId for dbTitleName
        const avMarkdown = `<div data-type="NodeAttributeView" data-av-type="table"></div>\n`;
        const appendRes = await post("/api/block/appendBlock", {
            data: avMarkdown,
            dataType: "markdown",
            parentID: targetSubDocId
        });
        await sleep(1000);

        // Locate the created AV block & avId
        let newAvId = "";
        let avBlockId = "";
        if (appendRes && appendRes.length > 0) {
            const addedBlocks = appendRes[0].doOperations || [];
            for (const op of addedBlocks) {
                if (op.action === "insert") {
                    avBlockId = op.id;
                    const domRes = await client.getBlockDOM({ id: avBlockId });
                    const html = domRes.data?.dom || "";
                    const match = html.match(/data-av-id="([^"]+)"/);
                    if (match) newAvId = match[1];
                }
            }
        }

        if (!newAvId) {
            const avSql = `SELECT id FROM blocks WHERE root_id = '${targetSubDocId}' AND type = 'av' ORDER BY updated DESC LIMIT 1`;
            const avRes = await post("/api/query/sql", { stmt: avSql });
            if (avRes && avRes.length > 0) {
                avBlockId = avRes[0].id;
                const domRes = await client.getBlockDOM({ id: avBlockId });
                const html = domRes.data?.dom || "";
                const match = html.match(/data-av-id="([^"]+)"/);
                newAvId = match ? match[1] : avBlockId;
            }
        }

        if (newAvId) {
            // Pre-render first so kernel registers the AV structure
            await post("/api/av/renderAttributeView", { id: newAvId });
            await sleep(300);

            // Set attribute view name
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now() + 300,
                transactions: [{
                    doOperations: [{
                        action: "setAttrViewName",
                        id: newAvId,
                        data: dbTitleName
                    }]
                }]
            });
            await sleep(500);

            // Set custom-index-db-config attribute on the AV block
            const targetAttrBlock = avBlockId || targetSubDocId;
            const dbConfigPayload = {
                avId: newAvId,
                typeMappings: [],
                inheritanceRules: []
            };
            await post("/api/attr/setBlockAttrs", {
                id: targetAttrBlock,
                attrs: {
                    "name": dbTitleName,
                    "custom-av-name": dbTitleName,
                    "custom-index-db-config": JSON.stringify(dbConfigPayload)
                }
            });

            await post("/api/av/renderAttributeView", { id: newAvId });
        }

        return { docId: targetSubDocId, avId: newAvId, blockId: avBlockId };
    } catch (e) {
        console.error(`[IndexOS] Failed to getOrStoreDataDbDoc for ${dbTitleName}:`, e);
        throw e;
    }
}

/**
 * 为指定 Supertag 在 /data-dbs 页面中创建纯净专属投影数据库 (supertag-${rootTag})
 * 使用 DDL 引擎 executeDDL 标准构建数据库与列结构，并自动注册元数据与建立虚拟投影绑定。
 */
export async function createSupertagProjectionDatabase(
    tagName: string,
    sourceTemplateAvId?: string
): Promise<{ docId: string; avId: string; blockId: string; dbName: string }> {
    const cleanTag = tagName.replace(/^#/, "").trim();
    const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();
    const dbTitleName = `supertag-${rootTag}`;

    console.log(`[SupertagCloner] 正在为 #${rootTag} 构建纯净专属投影数据库: "${dbTitleName}"...`);

    // 1. 获取 IndexOS 笔记本与 /data-dbs 页面
    const { notebooks } = await post("/api/notebook/lsNotebooks", {});
    let targetNotebookId = notebooks?.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed)?.id;
    if (!targetNotebookId) {
        const res = await post("/api/notebook/createNotebook", { name: NOTEBOOK_NAME });
        targetNotebookId = res.notebook.id;
        await sleep(500);
    }
    const dataDbsDocId = await getOrCreateDataDbsParentDoc(targetNotebookId);
    if (!dataDbsDocId) {
        throw new Error(`获取 /data-dbs 页面失败`);
    }

    // 2. 检查是否已存在同名表
    let avId = resolveTableAvId(dbTitleName) || "";
    let blockId = "";

    if (!avId) {
        // 3. 构建 CREATE TABLE 语句
        const colSqlDefs: string[] = ["标题 block"];
        if (sourceTemplateAvId) {
            try {
                const colInfo = await getColIDMap(sourceTemplateAvId);
                const keyValues = colInfo?.keyValues || [];
                for (const kv of keyValues) {
                    const key = kv.key;
                    if (!key) continue;
                    if (key.type === "block" || key.name === "标题" || key.name === "Block") continue;
                    if (key.type === "rollup" || key.type === "created" || key.type === "updated") continue;

                    const rawType = (key.type || "text").toLowerCase();
                    let colType = rawType;
                    if (rawType === "mselect") colType = "mselect";
                    else if (rawType === "masset") colType = "masset";
                    else if (rawType === "linenumber") colType = "linenumber";

                    if (rawType === "select" || rawType === "mselect") {
                        const optNames = (key.options || []).map((o: any) => typeof o === "string" ? o : (o.name || "")).filter(Boolean);
                        if (optNames.length > 0) {
                            colSqlDefs.push(`"${key.name}" ${colType}('${optNames.join("','")}')`);
                        } else {
                            colSqlDefs.push(`"${key.name}" ${colType}`);
                        }
                    } else {
                        colSqlDefs.push(`"${key.name}" ${colType}`);
                    }
                }
            } catch (err) {
                console.warn("[SupertagCloner] 解析模板列失败，使用默认列:", err);
            }
        }

        const createSql = `CREATE TABLE "${dbTitleName}" (${colSqlDefs.join(", ")});`;
        console.log(`[SupertagCloner] 执行 DDL 创建数据库:`, createSql);
        const { db } = await getSqliteEngine();
        const ddlRes = await executeDDL(createSql, db, { targetDocId: dataDbsDocId });
        avId = ddlRes?.avId || resolveTableAvId(dbTitleName) || "";
        blockId = ddlRes?.blockId || avId;
    } else {
        blockId = avIdToBlockIdMap.get(avId) || avId;
    }

    if (!avId) {
        throw new Error(`创建数据库 ${dbTitleName} 失败：未能获取到 AV ID`);
    }

    // 4. 补充设置 AV 块属性与配置
    const targetAttrBlock = blockId || avId;
    const dbConfigPayload = {
        avId,
        typeMappings: [],
        inheritanceRules: []
    };
    await post("/api/attr/setBlockAttrs", {
        id: targetAttrBlock,
        attrs: {
            "name": dbTitleName,
            "custom-av-name": dbTitleName,
            "custom-index-db-config": JSON.stringify(dbConfigPayload)
        }
    });

    // 5. 注册列元数据
    if (sourceTemplateAvId) {
        try {
            const colInfo = await getColIDMap(sourceTemplateAvId);
            for (const kv of colInfo?.keyValues || []) {
                const key = kv.key;
                if (!key || key.type === "block" || key.name === "标题") continue;
                const isPureAscii = /^[a-zA-Z0-9_\-]+$/.test(key.name);
                const colSlug = isPureAscii
                    ? key.name.toLowerCase().replace(/_/g, "-")
                    : `k-${key.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
                registerColumnMeta(rootTag, colSlug, {
                    id: key.id,
                    name: key.name,
                    type: key.type || "text",
                    options: key.options || []
                });
            }
        } catch (_) {}
    }

    // 6. 自动将该 Supertag 绑定为此 AV 并激活虚拟投影
    await supertagBinder.setPref(rootTag, avId);
    await supertagAVProjector.projectSupertagToAV(rootTag, avId, blockId);

    console.log(`✅ [SupertagCloner] 专属投影数据库 ${dbTitleName} (AV: ${avId}) 初始化与绑定成功！`);
    return { docId: dataDbsDocId, avId, blockId, dbName: dbTitleName };
}
