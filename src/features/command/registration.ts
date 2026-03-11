import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import type { Protyle, Menu } from "siyuan";

// 设置为 false 即可在发布时轻易关停此处的入口注册
export const DEV_ENABLE_INIT_SYS = true;

/** 
 * 生成用于 Slash (/) 召唤出的初始构建指令选项
 */
export function getInitSystemSlashCommand() {
    if (!DEV_ENABLE_INIT_SYS) return null;

    return {
        filter: ["init system db", "初始化体系", "cshi"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.initSystemDB}</span><span class="b3-list-item__meta"></span></div>`,
        id: "initSystemDB",
        async callback(protyle: Protyle) {
            console.log("[IndexPlugin] Slash initSystemDB");
            protyle.insert("");
            await constructCommandStorage();
        }
    };
}

/**
 * 将初始构建按钮注入到顶栏的右键菜单中
 */
export function appendInitSystemMenu(menu: Menu) {
    if (!DEV_ENABLE_INIT_SYS) return;

    menu.addSeparator();
    menu.addItem({
        icon: "iconDatabase",
        label: i18n.initSystemDB,
        click: async () => {
            await constructCommandStorage();
        }
    });
}
