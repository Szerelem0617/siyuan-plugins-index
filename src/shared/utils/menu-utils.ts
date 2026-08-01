/**
 * 辅助工具：向思源 Menu 添加带本插件专属样式（左侧茵蒂克丝蓝标识线）的菜单项
 * 遵循思源 MenuItem 源码规范，设置 data-id 属性与 iconClass 供 CSS 强力渲染
 * 自动递归处理 submenu 列表，确保深层级子菜单项也能带上指示小标
 */
export function addPluginMenuItem(menu: any, options: {
    icon?: string;
    label: string;
    click?: (element: HTMLElement, event: MouseEvent) => void;
    id?: string;
    submenu?: any[];
    type?: "separator" | "readonly";
    current?: boolean;
    iconClass?: string;
}) {
    if (!menu || typeof menu.addItem !== "function") return null;

    const customId = options.id ? (options.id.startsWith("indexos-") ? options.id : `indexos-${options.id}`) : `indexos-item-${Math.random().toString(36).substring(2, 9)}`;
    const customIconClass = options.iconClass ? `${options.iconClass} indexos-menu-icon` : "indexos-menu-icon";

    // 递归处理子菜单 submenu
    let processedSubmenu = options.submenu;
    if (Array.isArray(options.submenu)) {
        processedSubmenu = options.submenu.map((subItem, idx) => ({
            ...subItem,
            id: subItem.id ? (subItem.id.startsWith("indexos-") ? subItem.id : `indexos-${subItem.id}`) : `indexos-sub-${idx}-${Math.random().toString(36).substring(2, 7)}`,
            iconClass: subItem.iconClass ? `${subItem.iconClass} indexos-menu-icon` : "indexos-menu-icon"
        }));
    }

    return menu.addItem({
        ...options,
        id: customId,
        iconClass: customIconClass,
        submenu: processedSubmenu
    });
}
