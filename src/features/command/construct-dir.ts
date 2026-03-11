import { post } from "../../shared/api-client/request";
import { client } from "../../shared/api-client";
import { showMessage } from "siyuan";
import { sleep } from "../../shared/utils";
import { createDatabaseWithBlocks } from "../data/list/create-db";

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
            const docContent = `# ${whitelistDocName}

该页面由 IndexOS 自动生成。请勿轻易删除此页面。您可以在此组织和配置在节点上可用的快捷动作库。

* 📌 转为待办任务
* 🗃️ 添加到数据库
* ⬇️ 下方插入同级块
* 📑 复制当前块
* 🖇️ 复制块引用
* 🔍 在右侧分屏打开
`;

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

            // 4. Ensure the list is turned into a Database with command columns
            // Get the TOP-LEVEL list block ID
            console.log(`[IndexOS] Waiting for indexing on ${whitelistDocId}...`);
            await sleep(2000); // 增加等待时间到 2 秒，思源的索引有时非常缓慢
            const listSql = `SELECT id FROM blocks WHERE root_id = '${whitelistDocId}' AND type = 'l' ORDER BY created ASC LIMIT 1`;
            const listRes = await post("/api/query/sql", { stmt: listSql });

            if (listRes && listRes.length > 0) {
                const listId = listRes[0].id;

                // Check if it already has an AV bound
                const listAttrsRes = await client.getBlockAttrs({ id: listId });
                const listAttrs = listAttrsRes.data || {};

                if (!listAttrs["custom-index-linked-av"]) {
                    console.log(`[IndexOS] Converting list ${listId} to Command DB...`);
                    await createDatabaseWithBlocks([listId], true);
                    await sleep(500);

                    // Fetch attrs again to get the brand new avID
                    const newAttrsRes = await client.getBlockAttrs({ id: listId });
                    const newAttrs = newAttrsRes.data || {};
                    const avId = newAttrs["custom-index-linked-av"];

                    if (avId) {
                        console.log(`[IndexOS] Command DB created with avID: ${avId}, injecting columns...`);
                        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
                        const currentKeys = Array.isArray(keysRes) ? keysRes : (keysRes.keys || []);
                        let lastKeyID = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1].id : "";

                        const addCol = async (name: string, type: string, icon: string) => {
                            // @ts-ignore
                            const newID = window.Lute.NewNodeID();
                            await post("/api/av/addAttributeViewKey", {
                                avID: avId,
                                keyID: newID,
                                keyName: name,
                                keyType: type,
                                keyIcon: icon,
                                previousKeyID: lastKeyID
                            });
                            lastKeyID = newID;
                            await sleep(200);
                        };

                        await addCol("Command ID", "text", "iconCode");
                        await addCol("Command Type", "select", "iconTags");
                        await addCol("Target Scope", "select", "iconFocus");
                        await addCol("Enable", "checkbox", "iconCheck");

                        showMessage(`[IndexOS] 命令大盘数据库初始化完毕！`, 3000);
                    }
                } else {
                    console.log(`[IndexOS] Command DB already exists and linked.`);
                }
            } else {
                console.warn(`[IndexOS] Failed to find the list block in the whitelist doc for DB conversion.`);
            }
        }

        return { notebookId: targetNotebookId, whitelistDocId };

    } catch (e) {
        console.error("[IndexOS] Data construction failed:", e);
        showMessage(`初始化系统存储库失败: ${e.message}`, 4000, "error");
        throw e;
    }
}
