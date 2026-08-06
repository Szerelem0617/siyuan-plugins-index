import { constructCommandStorage } from "./instantiate-storage";
import { i18n } from "../../shared/utils";
import { type Protyle } from "siyuan";
import { registerFriendlyTableName } from "../sqlite/sqlite-manager";
import { refreshSupertagRegistry } from "./utils/sync-service";

import { settings } from "../../core/settings";

export function isDevInitSysEnabled(): boolean {
    return !!settings.get("devMode");
}

export const DEV_ENABLE_INIT_SYS = false;

// --- 内存缓存：Supertag 注册表 ---
// Layer 2 的一行绑定（label → commandRef），不是命令定义。
// 命令定义（Layer 1）见 ./registry/command-registry.ts 的 CommandDef。
export interface CommandBinding {
    methodName: string;
    commandRef: string;
    paramMapping: string;
}

export interface SupertagCommand {
    typeTag: string;      // 匹配核心标签 (如 Project)
    methodName: string;   // UI 显示的方法名
    commandRef: string;   // 执行 of the command ID
    paramMapping: string;
    uiLocation: string;   // 绑定的界面位置
    autoSync?: boolean;
    targetDbId?: string;
    typeFieldId?: string;
    mappedValue?: any;
}

export let COMMAND_BINDINGS: Record<string, CommandBinding> = {};
export let SUPERTAG_REGISTRY: SupertagCommand[] = [];
export const globalSupertagsCache = new Map<string, string[]>();

export let commandAvId: string = "";
export let typeAvId: string = "";
export let commandDocId: string = "";
export let typeDocId: string = "";

// State modifiers (setters)
export function setSupertagRegistry(val: SupertagCommand[]) {
    SUPERTAG_REGISTRY = val;
}

export function setCommandBindings(val: Record<string, CommandBinding>) {
    COMMAND_BINDINGS = val;
}

export function setCommandAvId(val: string) {
    commandAvId = val;
    if (val) registerFriendlyTableName("command-db", val);
}

export function setTypeAvId(val: string) {
    typeAvId = val;
    if (val) registerFriendlyTableName("supertag-db", val);
}

export function setCommandDocId(val: string) { 
    commandDocId = val; 
}

export function setTypeDocId(val: string) { 
    typeDocId = val; 
}

// Getters
export function getCommandAvId() { return commandAvId; }
export function getTypeAvId() { return typeAvId; }
export function getCommandDocId() { return commandDocId; }
export function getTypeDocId() { return typeDocId; }

/** 
 * 生成用于 Slash (/) 召唤出的初始构建指令选项
 */
export function getInitSystemSlashCommand() {
    if (!isDevInitSysEnabled()) return null;

    return [
        {
            filter: ["init system db", "实例化", "存到思源", "sxl"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.initSystemDB}</span><span class="b3-list-item__meta">${i18n.initSystemDBMeta}</span></div>`,
            id: "initSystemDB",
            async callback(protyle: Protyle) {
                protyle.insert("");
                await constructCommandStorage();
                await refreshSupertagRegistry();
            }
        },

    ];
}
