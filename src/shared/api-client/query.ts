import { client } from "./index";

export async function requestGetDocOutline(blockId: string) {
    let response = await client.getDocOutline({
        id: blockId
    });
    let result = response.data;
    if (result == null) return [];
    return result;
}

export function collectOutlineIds(outlineData: any[], ids: string[] = []) {
    for (const item of outlineData) {
        ids.push(item.id);
        if (item.blocks) collectOutlineIds(item.blocks, ids);
        if (item.children) collectOutlineIds(item.children, ids);
    }
    return ids;
}

export async function getBlocksData(ids: string[]) {
    if (ids.length === 0) return {};
    const chunkSize = 100;
    const result: Record<string, { ial: string, markdown: string, content: string }> = {};
    
    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const idList = chunk.map(id => `'${id}'`).join(',');
        const response = await client.sql({
            stmt: `SELECT id, ial, markdown, content FROM blocks WHERE id IN (${idList})`
        });
        if (response.data) {
            for (const row of response.data) {
                result[row.id] = { ial: row.ial, markdown: row.markdown, content: row.content };
            }
        }
    }
    return result;
}
