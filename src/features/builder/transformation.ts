import { client } from "../../shared/api-client";
import { autoUpdateIndex } from "../insert-toc/index/action";
import { autoUpdateOutline } from "../insert-toc/outline/action";
import { bindTreeAttributes } from "../../shared/utils/transformation-utils";

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
