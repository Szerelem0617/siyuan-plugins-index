import { constructCommandStorage } from "./construct-dir";
import { i18n } from "../../shared/utils";
import { type Protyle } from "siyuan";
import { registerFriendlyTableName } from "../sqlite/sqlite-manager";
import { isDevModeActive } from "../dev-mode";
import { refreshSupertagRegistry } from "./utils/sync-service";

export const DEV_ENABLE_INIT_SYS = true;

// --- 内存缓存：Supertag 注册表 ---
export interface CommandDef {
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

export let COMMAND_REGISTRY: Record<string, CommandDef> = {};
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

export function setCommandRegistry(val: Record<string, CommandDef>) {
    COMMAND_REGISTRY = val;
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
    if (!DEV_ENABLE_INIT_SYS || !isDevModeActive()) return null;

    return [
        {
            filter: ["init system db", "实例化", "sxl"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.initSystemDB}</span><span class="b3-list-item__meta">Legacy AV</span></div>`,
            id: "initSystemDB",
            async callback(protyle: Protyle) {
                protyle.insert("");
                await constructCommandStorage();
                await refreshSupertagRegistry();
            }
        },

    ];
}
