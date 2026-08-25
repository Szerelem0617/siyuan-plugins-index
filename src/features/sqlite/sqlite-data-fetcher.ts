import { client } from "../../shared/api-client";
import { post } from "../../shared/api-client/request";
import { getAttrFromIAL } from "../../shared/utils";
import { registerFriendlyTableName } from "./sqlite-manager";

export async function fetchAllAVBlocks() {
    try {
        const sql = "SELECT id, root_id, ial, name FROM blocks WHERE type = 'av' LIMIT 500";
        const res = await client.sql({ stmt: sql });
        const blocks = res.data || [];

        // 收集所有 root_id 批量查询所属文档标题（作为数据库名备选）
        const rootIds = Array.from(new Set(blocks.map((b: any) => b.root_id).filter(Boolean)));
        const docTitleMap = new Map<string, string>();
        if (rootIds.length > 0) {
            try {
                const rootSql = `SELECT id, content FROM blocks WHERE id IN ('${rootIds.join("','")}')`;
                const rootRes = await client.sql({ stmt: rootSql });
                (rootRes.data || []).forEach((r: any) => {
                    if (r.id && r.content) {
                        docTitleMap.set(r.id, r.content.trim());
                    }
                });
            } catch (_) {}
        }

        const fetchPromises = blocks.map(async (block) => {
            let avId = getAttrFromIAL(block.ial, "custom-av-id");
            if (!avId) {
                const domRes = await client.getBlockDOM({ id: block.id });
                if (domRes.data && domRes.data.dom) {
                    const match = domRes.data.dom.match(/data-av-id="([^"]+)"/);
                    if (match) avId = match[1];
                }
            }
            if (!avId) {
                avId = block.id;
            }

            const isIdLike = (str: string) => !str || /^av_\d{14}/i.test(str) || /^\d{14}-[a-z0-9]{7}$/i.test(str);

            // 1. 优先从 /api/av/getAttributeView 获取原生数据库名称
            if (avId) {
                try {
                    const avConfig = await post("/api/av/getAttributeView", { id: avId });
                    const cand = avConfig?.name || (avConfig?.av ? avConfig.av.name : "");
                    if (cand && !isIdLike(cand) && cand !== "Unnamed Database" && cand !== "Unnamed") {
                        realName = cand.trim();
                    }
                } catch { /* Error fallback */ }
            }

            // 2. 其次尝试从 IAL 属性 custom-av-name 或 name 读取
            if (!realName) {
                const ialName = getAttrFromIAL(block.ial, "custom-av-name") || getAttrFromIAL(block.ial, "name") || block.name;
                if (ialName && !isIdLike(ialName) && ialName !== "Unnamed Database" && ialName !== "Unnamed") {
                    realName = ialName.trim();
                }
            }

            // 3. 再次尝试从所属文档标题读取
            if (!realName) {
                const docTitle = docTitleMap.get(block.root_id);
                if (docTitle && !isIdLike(docTitle) && docTitle !== "Unnamed Database" && docTitle !== "Unnamed") {
                    realName = docTitle.trim();
                }
            }

            if (!realName) {
                realName = "Unnamed Database";
            }

            if (realName && realName !== "Unnamed Database" && realName !== "Unnamed") {
                registerFriendlyTableName(realName, avId);
            }

            return {
                blockId: block.id,
                rootId: block.root_id,
                avId: avId || block.id,
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
