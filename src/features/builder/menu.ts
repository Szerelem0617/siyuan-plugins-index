import { client } from "../../shared/api-client";
import { ListProcessor } from "./builder";
import { createDatabaseWithBlocks } from "../data/action";
import { getOutermostList } from "../../shared/utils/dom-utils";
import { confirmTransformation, transformToTree } from "../transformation/transformation";

/**
 * 块标菜单回调
 * @param detail 事件细节
 * @returns void
 */
export function buildDoc({ detail }: any) {
    const { menu, blockElements } = detail;
    if (!blockElements || blockElements.length === 0) return;

    const blockElement = blockElements[0];
    const blockId = blockElement.getAttribute("data-node-id");
    const blockType = blockElement.getAttribute("data-type");

    // 1. Only show for NodeList (the container), not individual items
    if (blockType !== "NodeList") return;

    // 2. Check if it is the outermost list (and not inside an embed)
    const outermostList = getOutermostList(blockElement);
    if (outermostList !== blockElement) return;

    // Add Smart Selector menu items
    menu.addSeparator();

    menu.addItem({
        icon: "iconLeft",
        label: "👈 构建子文档",
        click: () => syncManager(blockId, blockType, "PUSH_TO_DOC")
    });

    menu.addItem({
        icon: "iconDown",
        label: "👇 构建标题行",
        click: () => syncManager(blockId, blockType, "PUSH_TO_BOTTOM")
    });
}

async function syncManager(sourceBlockId: string, sourceType: string, actionType: string) {
    // Check for Index/Outline attributes to intercept and transform
    const attrsRes = await client.getBlockAttrs({ id: sourceBlockId });
    let attrs = attrsRes.data || {};

    if (attrs["custom-index-create"] || attrs["custom-outline-create"]) {
        const confirmed = await confirmTransformation('builder');
        if (!confirmed) return;

        const success = await transformToTree(sourceBlockId);
        if (!success) {
            // @ts-ignore
            client.pushErrMsg({ msg: "转换失败", timeout: 3000 });
            return;
        }

        // Refresh attributes after transformation
        const refreshedAttrs = await client.getBlockAttrs({ id: sourceBlockId });
        attrs = refreshedAttrs.data || {};
    }

    // Update tree-create logic
    const treeAttr = attrs["custom-tree-create"];
    let currentData: any = {};
    if (treeAttr) {
        try {
            // Need robust decoding here too? Usually getBlockAttrs returns decoded JSON if it's stored as such? 
            // Or string. "custom-tree-create" is a string containing JSON.
            // Siyuan returns it as string. It might have &quot;.
            // Let's use simple parse for now, assuming standard behavior, or the same robust method if needed.
            // But menu.ts runs in browser context too? Yes.
            let val = treeAttr;
            if (val.includes("&quot;")) val = val.replace(/&quot;/g, '"');
            currentData = JSON.parse(val);
        } catch (e) {
            console.error("Failed to parse custom-tree-create", e);
        }
    }

    let currentType = currentData.treeType;

    let newType = currentType;
    if (!currentType) {
        if (actionType === "PUSH_TO_DOC") newType = "doc-tree";
        else if (actionType === "PUSH_TO_BOTTOM") newType = "heading-tree";
    } else {
        if (currentType === "doc-tree" && actionType === "PUSH_TO_BOTTOM") newType = "composite-tree";
        else if (currentType === "heading-tree" && actionType === "PUSH_TO_DOC") newType = "composite-tree";
    }

    if (newType && newType !== currentType) {
        currentData.treeType = newType;
        if (currentData.builderAutoUpdate === undefined) {
            currentData.builderAutoUpdate = true;
        }
        await client.setBlockAttrs({
            id: sourceBlockId,
            attrs: { "custom-tree-create": JSON.stringify(currentData) }
        });
    }

    try {
        const processor = new ListProcessor();
        await processor.processRecursive(sourceBlockId, sourceType, actionType);

        if (processor.ibp.errors.length > 0) { // Access via ibp
            // @ts-ignore
            client.pushMsg({
                msg: `⚠️ 部分条目因格式复杂未更新文本 (x${processor.ibp.errors.length})，仅更新了图标`,
                timeout: 5000
            });
        } else {
            // @ts-ignore
            client.pushMsg({
                msg: "✅ 同步完成",
                timeout: 3000
            });
        }
    } catch (e) {
        console.error(e);
        // @ts-ignore
        client.pushErrMsg({
            msg: `同步失败: ${e.message}`,
            timeout: 5000
        });
    }
}
