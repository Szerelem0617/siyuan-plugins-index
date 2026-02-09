import { focusDatabaseView, createDatabaseWithBlocks } from "./action";
import { ATTR_LINKED_AV } from "../../../shared/constants";
import { client } from "../../../shared/api-client";

/**
 * 寻找并返回最外层列表块及其 ID
 */
function getOutermostList(element: HTMLElement) {
    let current = element;
    let outermostList = null;

    // 向上寻找，直到到达 protyle-wysiwyg 或不再有父级
    while (current) {
        const type = current.getAttribute?.("data-type");
        if (type === "NodeList") {
            outermostList = current;
        }
        
        const parent = current.parentElement;
        if (!parent || parent.classList.contains("protyle-wysiwyg")) break;
        
        // 如果父级是 Embed，则停止，当前找到的即为该 Embed 内的最外层
        if (parent.getAttribute?.("data-type") === "NodeBlockQueryEmbed") break;
        
        current = parent;
    }
    return outermostList;
}

/**
 * Data 功能的块菜单回调 (针对列表块)
 */
export function addDataMenuItems({ detail }: any) {
    const { menu, blockElements, protyle } = detail;
    if (!blockElements || blockElements.length === 0) return;

    const blockElement = blockElements[0];
    const blockType = blockElement.getAttribute("data-type");
    const blockId = blockElement.getAttribute("data-node-id");

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
    const linkedAv = outermostList.getAttribute(ATTR_LINKED_AV) || 
                     outermostList.getAttribute(`data-${ATTR_LINKED_AV}`);
    
    // 调试：打印最外层块的所有属性
    const attrNames = outermostList.getAttributeNames();
    const attrMap: any = {};
    attrNames.forEach(name => attrMap[name] = outermostList.getAttribute(name));
    console.log(`[Data] Sync Menu Check - Outermost [${outermostId}] attrs:`, attrMap);
    console.log(`[Data] Sync Menu Check - linkedAv:`, linkedAv);

    if (linkedAv) {
        menu.addItem({
            icon: "iconFilter",
            label: "🔍 聚焦此层级 (更新视图)",
            click: () => focusDatabaseView(blockId, protyle)
        });
    }
}
