import { focusDatabaseView, createDatabaseWithBlocks } from "./action";
import { ATTR_LINKED_AV } from "../../../shared/constants";
import { getOutermostList, getBlockAttribute } from "../../../shared/utils/dom-utils";
import { openDbConfigDialog } from "../av-setting/db-config";

/**
 * Data 功能的块菜单回调 (针对列表块)
 */
export function addDataMenuItems({ detail }: any) {
    const { menu, blockElements, protyle } = detail;
    if (!blockElements || blockElements.length === 0) return;

    const blockElement = blockElements[0];
    const blockType = blockElement.getAttribute("data-type");
    const blockId = blockElement.getAttribute("data-node-id");

    // 针对数据库块 (NodeAttributeView)
    if (blockType === "NodeAttributeView") {
        const avId = blockElement.getAttribute("data-av-id") || blockElement.querySelector(".av")?.getAttribute("data-av-id");
        if (avId) {
            menu.addItem({
                icon: "iconSettings",
                label: "数据库高级设置 (Advanced Settings)",
                click: () => openDbConfigDialog(avId, blockId)
            });
        }
        return;
    }

    // 只有列表或列表项才继续
    if (blockType !== "NodeList" && blockType !== "NodeListItem") return;

    const outermostList = getOutermostList(blockElement);
    const outermostId = outermostList?.getAttribute("data-node-id");

    if (!outermostList || !outermostId) return;

    // 1. 创建数据库 (仅当点击的就是最外层列表块时显示)
    if (blockType === "NodeList" && blockId === outermostId) {
        menu.addItem({
            icon: "iconDatabase",
            label: "📊 创建数据库",
            click: () => createDatabaseWithBlocks([blockId], protyle)
        });
    }

    // 2. 聚焦层级 (只要最外层列表绑定了数据库，则在所有子项/子列表上显示)
    // 注意：必须同步检查 DOM 属性，异步 await 会导致菜单已打开而无法添加项
    const linkedAv = getBlockAttribute(outermostList, ATTR_LINKED_AV);

    // 调试：打印最外层块的所有属性
    const attrNames = outermostList.getAttributeNames();
    const attrMap: any = {};
    attrNames.forEach(name => attrMap[name] = outermostList.getAttribute(name));
    console.log(`[Data] Sync Menu Check - Outermost [${outermostId}] attrs:`, attrMap);
    console.log(`[Data] Sync Menu Check - linkedAv:`, linkedAv);

    if (linkedAv) {
        menu.addItem({
            icon: "iconFilter",
            label: "🔍 数据库聚焦",
            submenu: [
                {
                    icon: "iconSort",
                    label: "同级",
                    click: () => focusDatabaseView(blockId, protyle, "level")
                },
                {
                    icon: "iconLink",
                    label: "兄弟",
                    click: () => focusDatabaseView(blockId, protyle, "siblings")
                },
                {
                    icon: "iconDown",
                    label: "后代",
                    click: () => focusDatabaseView(blockId, protyle, "descendants")
                }
            ]
        });
    }
}
