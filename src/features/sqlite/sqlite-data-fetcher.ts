import { client } from "../../shared/api-client";
import { getAttrFromIAL } from "../../shared/utils";

export async function fetchAllAVBlocks() {
    try {
        // 1. 获取所有物理 AV 块
        const sql = "SELECT id, ial FROM blocks WHERE type = 'av' LIMIT 100";
        const res = await client.sql({ stmt: sql });
        const blocks = res.data || [];

        const result = [];
        for (const block of blocks) {
            // 2. 尝试从 IAL 提取逻辑 AV ID
            let avId = getAttrFromIAL(block.ial, "custom-av-id");
            
            // 如果 IAL 没抓到，尝试从 DOM 抓取 (因为 data-av-id 存储在 DOM 中)
            if (!avId) {
                const domRes = await client.getBlockDOM({ id: block.id });
                if (domRes.data && domRes.data.dom) {
                    const match = domRes.data.dom.match(/data-av-id="([^"]+)"/);
                    if (match) avId = match[1];
                }
            }

            result.push({
                blockId: block.id,
                avId: avId || "Not Found",
                ial: block.ial
            });
        }
        return result;
    } catch (e) {
        console.error("Failed to fetch AV blocks", e);
        return [];
    }
}
