import { client } from "../../shared/api-client";
import { focusDatabaseView, createDatabaseWithBlocks } from "./action";

/**
 * Data 功能的块菜单回调
 */
export function addDataMenuItems({ detail }: any) {
    const { menu, blockElements, protyle } = detail;
    if (!blockElements || blockElements.length === 0) return;

    const types = Array.from(blockElements).map((el: any) => el.getAttribute("data-type"));
    const selectedIds = Array.from(blockElements).map((el: any) => el.getAttribute("data-node-id"));

    // 1. 列表转数据库 (仅限全选列表)
    const isAllList = types.every(t => t === "NodeList");
    if (isAllList) {
        menu.addItem({
            icon: "iconDatabase",
            label: "📊 创建数据库",
            click: () => createDatabaseWithBlocks(selectedIds, protyle)
        });
    }

    // 2. 聚焦层级 (支持列表或列表项)
    const hasListOrItem = types.some(t => t === "NodeList" || t === "NodeListItem");
    if (hasListOrItem) {
        menu.addItem({
            icon: "iconFilter",
            label: "🔍 聚焦此层级 (更新视图)",
            click: () => focusDatabaseView(selectedIds[0], protyle)
        });
    }
}
