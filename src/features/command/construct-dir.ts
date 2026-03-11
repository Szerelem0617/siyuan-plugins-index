import { post } from "../../shared/api-client/request";
import { showMessage } from "siyuan";
import { sleep } from "../../shared/utils";

/**
 * Initializes the Command & Type DB notebook and internal pages.
 * 1. Creates a Notebook called "类与命令管理" if it doesn't exist.
 * 2. Creates a Page called "白名单命令树" if it doesn't exist.
 */
export async function constructCommandStorage() {
    const notebookName = "类与命令管理";
    const whitelistDocName = "白名单命令树";

    try {
        showMessage(`[IndexOS] 正在初始化系统存储库...`, 2000);

        // 0. Check via attributes first (robust against renaming)
        const sql = `SELECT root_id, box FROM attributes WHERE name = 'custom-index-command-whitelist' LIMIT 1`;
        const existingDocs = await post("/api/query/sql", { stmt: sql });
        if (existingDocs && existingDocs.length > 0) {
            const whitelistDocId = existingDocs[0].root_id;
            const targetNotebookId = existingDocs[0].box;
            console.log(`[IndexOS] Found existing system db via attr: doc=${whitelistDocId}, box=${targetNotebookId}`);
            showMessage(`[IndexOS] 系统大盘已存在并已关联，无需重建。`, 3000);
            return { notebookId: targetNotebookId, whitelistDocId };
        }

        // 1. Get or Create Notebook
        const { notebooks } = await post("/api/notebook/lsNotebooks", {});
        let targetNotebookId = notebooks.find((n: any) => n.name === notebookName && !n.closed)?.id;

        if (!targetNotebookId) {
            console.log(`[IndexOS] Notebook not found, creating new: ${notebookName}`);
            const res = await post("/api/notebook/createNotebook", { name: notebookName });
            targetNotebookId = res.notebook.id;
        } else {
            console.log(`[IndexOS] Existing notebook found: ${targetNotebookId}`);
        }

        // Wait a bit to ensure the DB indexing stabilizes after a new notebook
        await sleep(500);

        // 2. Get or Create Document "白名单命令树"
        const hPath = `/${whitelistDocName}`;
        const docPath = `${hPath}.sy`;
        let whitelistDocId = null;

        try {
            console.log(`[IndexOS] Checking if doc exists at HPath: ${hPath}`);
            const checkRes = await post("/api/filetree/getIDsByHPath", {
                path: hPath,
                notebook: targetNotebookId
            });
            if (checkRes && checkRes.length > 0) {
                whitelistDocId = checkRes[0];
            }
        } catch (e) {
            console.warn("[IndexOS] Error checking hpath, might not exist yet:", e);
        }

        if (!whitelistDocId) {
            console.log(`[IndexOS] Whitelist doc not found, creating new...`);
            // We use createDocWithMd with path matching the doc name
            // The path must start with `/`
            const docContent = `# ${whitelistDocName}\n\n该页面由 IndexOS 自动生成。请勿轻易删除此页面。\n\n`;

            whitelistDocId = await post("/api/filetree/createDocWithMd", {
                notebook: targetNotebookId,
                path: docPath,
                markdown: docContent
            });
            showMessage(`[IndexOS] "白名单命令树" 创建成功！`, 3000);
        } else {
            console.log(`[IndexOS] Whitelist doc already exists (but attr was missing): ${whitelistDocId}`);
            showMessage(`[IndexOS] 系统存储库关联已修复。`, 3000);
        }

        // 3. Mark the document with the special attribute
        if (whitelistDocId) {
            await post("/api/attr/setBlockAttrs", {
                id: whitelistDocId,
                attrs: {
                    "custom-index-command-whitelist": "true"
                }
            });
            console.log(`[IndexOS] Marked doc ${whitelistDocId} with custom-index-command-whitelist attribute.`);
        }

        return { notebookId: targetNotebookId, whitelistDocId };

    } catch (e) {
        console.error("[IndexOS] Data construction failed:", e);
        showMessage(`初始化系统存储库失败: ${e.message}`, 4000, "error");
        throw e;
    }
}
