import { client } from "../../shared/api-client";
import { post } from "../../shared/api-client/request";
import { getAttrFromIAL } from "../../shared/utils";

export async function fetchAllAVBlocks() {
    try {
        const sql = "SELECT id, ial FROM blocks WHERE type = 'av' LIMIT 100";
        const res = await client.sql({ stmt: sql });
        const blocks = res.data || [];

        const fetchPromises = blocks.map(async (block) => {
            let avId = getAttrFromIAL(block.ial, "custom-av-id");
            if (!avId) {
                const domRes = await client.getBlockDOM({ id: block.id });
                if (domRes.data && domRes.data.dom) {
                    const match = domRes.data.dom.match(/data-av-id="([^"]+)"/);
                    if (match) avId = match[1];
                }
            }

            let realName = "Unnamed Database";
            if (avId) {
                try {
                    const avConfig = await post("/api/av/getAttributeView", { id: avId });
                    realName = avConfig?.name || (avConfig?.av ? avConfig.av.name : "Unnamed");
                } catch { /* Error fallback to Unnamed */ }
            }

            return {
                blockId: block.id,
                avId: avId || "Not Found",
                name: realName,
                ial: block.ial
            };
        });

        return await Promise.all(fetchPromises);
    } catch (e) {
        console.error("[AV-Fetcher] Failed", e);
        return [];
    }
}
