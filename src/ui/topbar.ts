import {
    Dialog, Menu
} from "siyuan";
import { insertAction } from "../features/insert-moc/index/action";
import { insertOutlineAction } from "../features/insert-moc/outline/action";
import { i18n, isMobile, plugin } from "../shared/utils";
import { isDevInitSysEnabled } from "../features/command/registration";
import SettingsTab from "./components/setting.svelte";

export async function initTopbar() {
    // 添加顶栏按钮：左键单击直接弹出功能聚合菜单
    const topBarElement = plugin.addTopBar({
        icon: "iconList",
        title: i18n.addTopBarIcon,
        position: "right",
        callback: () => {
            if (isMobile) {
                addMenu();
            } else {
                let rect = topBarElement.getBoundingClientRect();
                // 如果被折叠隐藏，则使用更多按钮或插件按钮的位置
                if (rect.width === 0) {
                    const barMore = document.querySelector("#barMore");
                    if (barMore) rect = barMore.getBoundingClientRect();
                }
                if (rect.width === 0) {
                    const barPlugins = document.querySelector("#barPlugins");
                    if (barPlugins) rect = barPlugins.getBoundingClientRect();
                }
                addMenu(rect);
            }
        }
    });

    // 添加快捷键（高频使用仍可一键快捷调用）
    plugin.addCommand({
        langKey: "insertIndex",
        hotkey: "⌥⌘I",
        callback: async () => {
            insertAction();
        }
    });

    plugin.addCommand({
        langKey: "insertoutline",
        hotkey: "⌥⌘O",
        callback: async () => {
            insertOutlineAction();
        }
    });

    plugin.addCommand({
        langKey: "openSqliteStatus",
        hotkey: "⌥⌘S",
        callback: async () => {
            if (!isDevInitSysEnabled()) return;
            (plugin as any).openSqliteStatus?.();
        }
    });
}

export async function createDialog() {
    const settingsDialog = "index-settings";

    const dialog = new Dialog({
        title: "",
        content: `<div id="${settingsDialog}" class="fn__flex-1 fn__flex config__panel">`,
        width: "70%",
        height: "70%",
    });
    dialog.element.classList.add("indexos-dialog");

    let div: HTMLDivElement = dialog.element.querySelector(`#${settingsDialog}`);

    new SettingsTab({
        target: div,
    });
}

function addMenu(rect?: DOMRect) {
    const menu = new Menu();
    menu.addItem({
        icon: "iconList",
        label: i18n.insertIndex,
        accelerator: "⌥⌘I",
        click: () => {
            insertAction();
        }
    });
    menu.addItem({
        icon: "iconAlignCenter",
        label: i18n.insertoutline,
        accelerator: "⌥⌘O",
        click: () => {
            insertOutlineAction();
        }
    });

    menu.addSeparator();
    menu.addItem({
        icon: "iconSettings",
        label: i18n.settings,
        click: async () => {
            await createDialog();
        }
    });

    if (isMobile || !rect) {
        menu.fullscreen();
    } else {
        menu.open({
            x: rect.right,
            y: rect.bottom,
            isLeft: true,
        });
    }
}