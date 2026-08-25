import { post } from "../../shared/api-client/request";
import { NOTEBOOK_NAME, DATA_DBS_CONFIG } from "./indexos/seed-data";

/**
 * 检查用户是否已实例化 data-dbs 页面/笔记本
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
 * 获取或在 IndexOS 笔记本下创建 /data-dbs 父文档
 */
export async function getOrCreateDataDbsParentDoc(notebookId: string): Promise<string> {
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
