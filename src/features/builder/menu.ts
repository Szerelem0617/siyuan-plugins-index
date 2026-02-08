import { client } from "../../shared/api-client";
import { ListProcessor } from "./builder";
import { createDatabaseWithBlocks } from "../data/action";

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
    let parent = blockElement.parentElement;
    let isOutermost = true;
    while (parent) {
        const pType = parent.getAttribute?.("data-type");
        // If parent is a List, ListItem, or Embed (iblock), then this is not outermost/valid
        if (pType === "NodeList" || pType === "NodeListItem" || pType === "NodeBlockQueryEmbed") {
            isOutermost = false;
            break;
        }
        if (parent.classList.contains("protyle-wysiwyg")) break;
        parent = parent.parentElement;
    }
    if (!isOutermost) return;

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

    menu.addItem({
        icon: "iconDatabase",
        label: "📅 创建数据库",
        click: () => createDatabaseWithBlocks([blockId], detail.protyle)
    });
}

async function syncManager(sourceBlockId: string, sourceType: string, actionType: string) {
    // Check for Index/Outline attributes to prevent conflict
    const attrsRes = await client.getBlockAttrs({ id: sourceBlockId });
    const attrs = attrsRes.data || {};

    if (attrs["custom-index-create"] || attrs["custom-outline-create"]) {
        // @ts-ignore
        client.pushErrMsg({
            msg: "当前不支持在大纲/目录的基础上执行文档构建器",
            timeout: 3000
        });
        return;
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
