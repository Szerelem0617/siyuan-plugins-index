import { addPluginMenuItem } from "../../../shared/utils/menu-utils";

export interface MenuOption {
    icon: string;
    label: string;
    click: () => void | Promise<void>;
}

export function addSupertagMenuOption(menu: any, option: MenuOption) {
    if (!menu || typeof menu.addItem !== "function") return;
    addPluginMenuItem(menu, {
        icon: option.icon,
        label: option.label,
        click: option.click
    });
}
