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
            // console.log(`[IndexOS] Existing notebook found: ${targetNotebookId}`);
        }

        // 2. Init Command-DB (逻辑工厂)
        await initDbDoc(
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

                // Populate default data
                const configData: Record<string, { id: string, type: string, scope: string, param?: string }> = {
                    "全局关系图": { id: "general.graphView", type: "Native", scope: "Global" },
                    "收集箱": { id: "general.inbox", type: "Native", scope: "Global" },
                    "在右侧分屏打开": { id: "general.splitLR", type: "Native", scope: "Global" },
                    "下方插入同级块": { id: "editor.general.insertAfter", type: "Native", scope: "Sibling" },
                    "复制当前块": { id: "editor.general.duplicate", type: "Native", scope: "Sibling" },
                    "复制块引用": { id: "editor.general.copyBlockRef", type: "Native", scope: "Global" }
                };

                await sleep(1000);
                const renderRes = await post("/api/av/renderAttributeView", { id: avId });
                const rows = renderRes.view?.rows || renderRes.rows || [];
                const populateOps: any[] = [];

                for (const row of rows) {
                    const firstCell = row.cells[0];
                    let label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";

                    for (const [key, config] of Object.entries(configData)) {
                        if (label.includes(key)) {
                            populateOps.push({ keyID: commandIdKey, itemID: row.id, value: { type: "text", text: { content: config.id } } });
                            if (config.param !== undefined) {
                                populateOps.push({ keyID: paramMappingKey, itemID: row.id, value: { type: "text", text: { content: config.param } } });
                            }
                            populateOps.push({ keyID: commandTypeKey, itemID: row.id, value: { type: "text", text: { content: config.type } } });
                            populateOps.push({ keyID: targetScopeKey, itemID: row.id, value: { type: "text", text: { content: config.scope } } });
                            populateOps.push({ keyID: enableKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: true } } });
                            // If it's the global graph view, tick Top Bar, Inline Button, and Command Palette by default as a demo
                            if (key === "全局关系图") {
                                populateOps.push({ keyID: topBarKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: true } } });
                                populateOps.push({ keyID: buttonKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: true } } });
                                populateOps.push({ keyID: paletteKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: true } } });
                            }
                            break;
                        }
                    }
                }

                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        // 3. Init Type-DB (类型绑定)
        await initDbDoc(
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

                await sleep(1000);
                const renderRes = await post("/api/av/renderAttributeView", { id: avId });
                const rows = renderRes.view?.rows || renderRes.rows || [];
                const populateOps: any[] = [];

                let projectCount = 0;
                for (const row of rows) {
                    const firstCell = row.cells[0];
                    let label = firstCell?.value?.block?.content || firstCell?.value?.mText?.content || firstCell?.value?.text?.content || "";
                    if (label.includes("#Project")) {
                        projectCount++;
                        if (projectCount === 1) {
                            // 第一个 Project：给块标菜单绑定命令（使用 Layer 2 的主键名称，支持逗号分隔多个）
                            populateOps.push({ keyID: blockMenuKey, itemID: row.id, value: { type: "text", text: { content: "在右侧分屏打开, 全局关系图" } } });
                            populateOps.push({ keyID: enableKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: true } } });
                        } else if (projectCount === 2) {
                            populateOps.push({ keyID: pageMenuKey, itemID: row.id, value: { type: "text", text: { content: "全局关系图" } } });
                            populateOps.push({ keyID: enableKey, itemID: row.id, value: { type: "checkbox", checkbox: { checked: true } } });
                        }
                    }
                }
                if (populateOps.length > 0) {
                    await post("/api/av/batchSetAttributeViewBlockAttrs", { avID: avId, values: populateOps });
                }
            }
        );

        showMessage(`[IndexOS] 系统存储库初始化完成！`, 3000);

    } catch (e) {
        console.error("[IndexOS] Data construction failed:", e);
        showMessage(`初始化系统存储库失败: ${(e as Error).message}`, 4000, "error");
        throw e;
    }
}

async function initDbDoc(
    notebookId: string,
    docName: string,
    attrName: string,
    initMarkdown: string,
    initColsCallback: (avId: string) => Promise<void>
) {
    // 0. Check via attributes first
    const sql = `SELECT root_id FROM attributes WHERE name = '${attrName}' LIMIT 1`;
    const existingDocs = await post("/api/query/sql", { stmt: sql });
    if (existingDocs && existingDocs.length > 0) {
        console.log(`[IndexOS] Found existing system db [${docName}] via attr: doc=${existingDocs[0].root_id}`);
        return existingDocs[0].root_id;
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
            // console.log(`[IndexOS] Created doc ${docId} for ${docName}.`);
        } catch (e) {
            console.error(`[IndexOS] createDocWithMd failed for ${docName}`, e);
        }
    } else {
        console.log(`[IndexOS] Doc already exists (but attr was missing): ${docId}`);
    }

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

            if (!listAttrs["custom-index-linked-av"]) {
                console.log(`[IndexOS] Converting list ${listId} to DB for ${docName}...`);
                await createDatabaseWithBlocks([listId], true, true);
                await sleep(1000);

                const newAttrsRes = await client.getBlockAttrs({ id: listId });
                const newAttrs = newAttrsRes.data || {};
                const avId = newAttrs["custom-index-linked-av"];

                if (avId) {
                    // console.log(`[IndexOS] DB created with avID: ${avId}, injecting columns...`);
                    await initColsCallback(avId);
                    console.log(`[IndexOS] DB columns initialized for ${docName}.`);
                }
            } else {
                // console.log(`[IndexOS] DB already exists and linked for ${docName}.`);
            }
        } else {
            console.warn(`[IndexOS] Failed to find the list block in ${docName} for DB conversion.`);
        }
    }

    return docId;
}
