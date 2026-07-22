import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { sleep } from "../../shared/utils";
import { NOTEBOOK_NAME, DATA_DBS_CONFIG } from "./indexos/seed-data";

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
 * Gets or creates a child doc under data-dbs (capped at 20 DBs per child doc) and creates a new AV database table inside it.
 */
export async function getOrStoreDataDbDoc(dbTitleName: string): Promise<{ docId: string; avId: string }> {
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

            // Set custom-index-db-config attribute on the AV block so getGlobalTypeConfigs and persistOutputVariablesToLayer4 recognize it immediately
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

        return { docId: targetSubDocId, avId: newAvId };
    } catch (e) {
        console.error(`[IndexOS] Failed to getOrStoreDataDbDoc for ${dbTitleName}:`, e);
        throw e;
    }
}
