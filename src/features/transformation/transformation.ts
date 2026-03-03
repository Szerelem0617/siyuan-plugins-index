import { confirmDialog } from "../../shared/utils";
import { client } from "../../shared/api-client";
import { autoUpdateIndex } from "../index/action";
import { autoUpdateOutline } from "../outline/action";

export async function confirmTransformation(type: 'builder' | 'database'): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let msg = "该操作需要将目录/大纲重构为静态树（Tree），此后它将不再自动更新，作为最终的数据源。是否继续？";
        if (type === 'builder') {
            msg = "执行构建器前，" + msg;
        } else if (type === 'database') {
            msg = "创建数据库前，" + msg;
        }

        confirmDialog(
            "提示",
            msg,
            () => resolve(true),
            () => resolve(false)
        );
    });
}

export async function transformToTree(blockId: string): Promise<boolean> {
    try {
        const attrsRes = await client.getBlockAttrs({ id: blockId });
        const attrs = attrsRes.data || {};

        const indexAttr = attrs["custom-index-create"];
        const outlineAttr = attrs["custom-outline-create"];

        if (indexAttr) {
            let config: any = {};
            try {
                let val = indexAttr;
                if (val.includes("&quot;")) val = val.replace(/&quot;/g, '"');
                config = JSON.parse(val);
            } catch (e) { console.error("Parse config error", e); }

            // Override config to force builder tree format
            config.linkType = "tree";

            // Re-run generation with overridden logic (mocking existing block to skip sql search)
            const mockBlock = {
                id: blockId,
                ial: `custom-index-create="${JSON.stringify(config).replace(/"/g, "&quot;")}"`
            };

            const parentRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${blockId}'` });
            const rootId = parentRes.data[0]?.root_id;

            if (rootId) {
                // Determine notebook and path from root_id
                const pathRes = await fetch("/api/filetree/getPathByID", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: rootId })
                }).then(res => res.json());

                if (pathRes && pathRes.data) {
                    await autoUpdateIndex(pathRes.data.notebook, pathRes.data.path, rootId, mockBlock);
                    await bindTreeAttributes(blockId, "custom-index-subdoc-id");
                }
            }

            // Unlink index attribute and attach tree attribute
            const newTreeConfig = {
                treeType: "doc-tree",
                builderAutoUpdate: true
            };

            await client.setBlockAttrs({
                id: blockId,
                attrs: {
                    "custom-index-create": "",
                    "custom-tree-create": JSON.stringify(newTreeConfig)
                }
            });

            return true;
        }

        if (outlineAttr) {
            let config: any = {};
            try {
                let val = outlineAttr;
                if (val.includes("&quot;")) val = val.replace(/&quot;/g, '"');
                config = JSON.parse(val);
            } catch (e) { console.error("Parse config error", e); }

            // Override config to force builder tree format
            config.outlineType = "tree";

            const mockBlock = {
                id: blockId,
                ial: `custom-outline-create="${JSON.stringify(config).replace(/"/g, "&quot;")}"`,
                markdown: "" // outline uses markdown to read anchors, we ignore here to regen default icons
            };

            const parentRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${blockId}'` });
            const rootId = parentRes.data[0]?.root_id;

            if (rootId) {
                await autoUpdateOutline(rootId, mockBlock);
                await bindTreeAttributes(blockId, "custom-index-heading-id");
            }

            // Unlink outline attribute and attach tree attribute
            const newTreeConfig = {
                treeType: "heading-tree",
                builderAutoUpdate: true
            };

            await client.setBlockAttrs({
                id: blockId,
                attrs: {
                    "custom-outline-create": "",
                    "custom-tree-create": JSON.stringify(newTreeConfig)
                }
            });

            return true;
        }

        return false;
    } catch (e) {
        console.error("Transformation failed", e);
        return false;
    }
}

export async function bindTreeAttributes(rootListId: string, attrName: "custom-index-subdoc-id" | "custom-index-heading-id") {
    // Wait for SiYuan to index the new blocks (it can take a moment for large trees)
    await new Promise(r => setTimeout(r, 1000));

    const docIdRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${rootListId}' LIMIT 1` });
    const docId = docIdRes.data?.[0]?.root_id;
    if (!docId) return;

    const allBlocksRes = await client.sql({ stmt: `SELECT id, parent_id, type, markdown FROM blocks WHERE root_id = '${docId}'` });
    const allBlocks = allBlocksRes.data || [];

    const childrenMap = new Map<string, any[]>();
    for (const b of allBlocks) {
        if (!childrenMap.has(b.parent_id)) childrenMap.set(b.parent_id, []);
        childrenMap.get(b.parent_id).push(b);
    }

    const paragraphs: any[] = [];
    const queue = [rootListId];
    while (queue.length > 0) {
        const currentId = queue.shift();
        const children = childrenMap.get(currentId) || [];
        for (const c of children) {
            if (c.type === 'p') paragraphs.push(c);
            else queue.push(c.id);
        }
    }

    const promises = [];
    for (const p of paragraphs) {
        const match = p.markdown.match(/siyuan:\/\/blocks\/([a-zA-Z0-9-]+)/);
        if (match && match[1]) {
            const targetId = match[1];
            promises.push(client.setBlockAttrs({
                id: p.parent_id, // Target the parent NodeListItem ('i')
                attrs: { [attrName]: targetId }
            }));
        }
    }

    if (promises.length > 0) {
        await Promise.all(promises);
    }
}
