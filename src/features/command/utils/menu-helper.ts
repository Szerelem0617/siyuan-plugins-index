export interface MenuOption {
    icon: string;
    label: string;
    click: () => void | Promise<void>;
}

export function addSupertagMenuOption(menu: any, option: MenuOption) {
    if (!menu || typeof menu.addItem !== "function") return;
    menu.addItem({
        icon: option.icon,
        label: option.label,
        click: option.click
    });
}
