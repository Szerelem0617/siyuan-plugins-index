import { client } from "../../shared/api-client";
import { bindTreeAttributes } from "../../shared/utils/transformation-utils";
import { buildSubdocTreeMarkdown, buildOutlineTreeMarkdown } from "../../shared/render/reverse-build";
import { requestGetDocOutline, collectOutlineIds, getBlocksData } from "../../shared/api-client/query";

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
                    const newMd = await buildSubdocTreeMarkdown(pathRes.data.notebook, pathRes.data.path, 0, config.listType === "ordered");
                    await client.updateBlock({ id: blockId, dataType: "markdown", data: newMd });
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



            const parentRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${blockId}'` });
            const rootId = parentRes.data[0]?.root_id;

            if (rootId) {
                const outlineData = await requestGetDocOutline(rootId);
                const outlineIds = collectOutlineIds(outlineData);
                const extraData = await getBlocksData(outlineIds);
                const newMd = await buildOutlineTreeMarkdown(outlineData, 0, 0, extraData, config.listTypeOutline === "ordered");
                await client.updateBlock({ id: blockId, dataType: "markdown", data: newMd });
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
