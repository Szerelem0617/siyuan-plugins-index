import { post } from "../../shared/api-client/request";
import { NOTEBOOK_NAME, DATA_DBS_CONFIG } from "./indexos/seed-data";

/**
 * 检查用户是否已实例化 data-dbs 页面/笔记本
 */
export async function isDataDbsInstantiated(): Promise<boolean> {
    try {
        const { notebooks } = await post("/api/notebook/lsNotebooks", {});
        const targetNotebookId = notebooks?.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed)?.id;
        if (!targetNotebookId) return false;

        const sql = `SELECT id FROM blocks WHERE box = '${targetNotebookId}' AND type = 'd' AND id != '${targetNotebookId}' AND (hpath = '/${DATA_DBS_CONFIG.title}' OR ial LIKE '%${DATA_DBS_CONFIG.attrName}%') LIMIT 1`;
        const existingDocs = await post("/api/query/sql", { stmt: sql });
        return Boolean(existingDocs && existingDocs.length > 0);
    } catch (e) {
        return false;
    }
}

/**
 * 获取或在 IndexOS 笔记本下固定创建独立的实体子页面 (/IndexOS)，严禁使用顶层笔记本文档
 */
export async function getOrCreateDataDbsParentDoc(notebookId: string): Promise<string> {
    // 1. 查询该笔记本下的真实实体子文档（严格过滤 id != notebookId，避开顶层笔记本文档）
    const sql = `SELECT id FROM blocks WHERE box = '${notebookId}' AND type = 'd' AND id != '${notebookId}' AND (hpath = '/${DATA_DBS_CONFIG.title}' OR ial LIKE '%${DATA_DBS_CONFIG.attrName}%') LIMIT 1`;
    const existingDocs = await post("/api/query/sql", { stmt: sql });
    if (existingDocs && existingDocs.length > 0) {
        return existingDocs[0].id;
    }

    // 2. 不存在则固定新建该页面（注意：path 不带 .sy 后缀）
    const createRes = await post("/api/filetree/createDocWithMd", {
        notebook: notebookId,
        path: `/${DATA_DBS_CONFIG.title}`,
        markdown: `# ${DATA_DBS_CONFIG.title}\n\nIndexOS 统一系统存储与数据管理中心。\n`
    });
    const docId = typeof createRes === "string" ? createRes : (createRes?.data || createRes?.id || "");

    if (docId && docId !== notebookId) {
        await post("/api/attr/setBlockAttrs", {
            id: docId,
            attrs: { [DATA_DBS_CONFIG.attrName]: "true" }
        });
    }

    return docId || "";
}
