import { confirmDialog } from "./index";
import { client } from "../api-client";

export async function confirmTransformation(type: 'builder' | 'database'): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let action = type === 'builder' ? "执行构建器" : "创建数据库";
        let msg = `${action}会将此列表设置为“真理源”。此后请直接在此列表内修改内容及层级来同步至文档树。是否继续？`;

        confirmDialog(
            "提示",
            msg,
            () => resolve(true),
            () => resolve(false)
        );
    });
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
