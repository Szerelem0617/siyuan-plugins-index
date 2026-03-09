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
    try {
        const domRes = await client.getBlockDOM({ id: rootListId });
        if (!domRes || !domRes.data || !domRes.data.dom) {
            console.error(`[bindTreeAttributes] Failed to get DOM for block ${rootListId}`);
            return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(domRes.data.dom, "text/html");

        const listItems = Array.from(doc.querySelectorAll('div[data-type="NodeListItem"]'));
        const promises = [];

        for (const li of listItems) {
            const liId = li.getAttribute("data-node-id");
            if (!liId) continue;

            const p = li.querySelector('div[data-type="NodeParagraph"]');
            if (p) {
                let targetBlockId = null;

                // 1. Try to find SiYuan block-ref
                const blockRef = p.querySelector('span[data-type="block-ref"]');
                if (blockRef) {
                    targetBlockId = blockRef.getAttribute("data-id");
                }
                // 2. Try to find standard hyperlink matching siyuan://blocks/
                else {
                    const aLink = p.querySelector('span[data-type="a"]');
                    if (aLink) {
                        const href = aLink.getAttribute("data-href");
                        if (href && href.startsWith("siyuan://blocks/")) {
                            targetBlockId = href.replace("siyuan://blocks/", "");
                        }
                    }
                }

                // Fallback for raw text links (just in case)
                if (!targetBlockId) {
                    const match = p.innerHTML.match(/siyuan:\/\/blocks\/([a-zA-Z0-9-]+)/);
                    if (match && match[1]) targetBlockId = match[1];
                }

                if (targetBlockId) {
                    promises.push(client.setBlockAttrs({
                        id: liId, // Target the parent NodeListItem
                        attrs: { [attrName]: targetBlockId }
                    }));
                }
            }
        }

        if (promises.length > 0) {
            // Batch process to avoid hitting any potential request limits
            const chunkSize = 50;
            for (let i = 0; i < promises.length; i += chunkSize) {
                const chunk = promises.slice(i, i + chunkSize);
                await Promise.all(chunk);
            }
        }
    } catch (e) {
        console.error("[bindTreeAttributes] Error during execution:", e);
    }
}
