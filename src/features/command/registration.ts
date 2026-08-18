import { constructCommandStorage } from "./instantiate-storage";
import { i18n } from "../../shared/utils";
import { type Protyle } from "siyuan";
import { registerFriendlyTableName } from "../sqlite/sqlite-manager";
import { refreshSupertagRegistry } from "./utils/sync-service";

import { settings } from "../../core/settings";

import { commandRegistry } from "./registry/command-registry";
import { getSeedCommandRows } from "./indexos/seed-data";

export function isDevInitSysEnabled(): boolean {
    return !!settings.get("devMode");
}

// --- 内存缓存：Supertag 注册表 ---
// Layer 2 的一行绑定（label → commandRef），不是命令定义。
// 命令定义（Layer 1）见 ./registry/command-registry.ts 的 CommandDef。
export interface CommandBinding {
    methodName: string;
    commandRef: string;
    inputMapping: string;
    outputMapping: string;
}

export interface SupertagCommand {
    typeTag: string;      // 匹配核心标签 (如 Project)
    methodName: string;   // UI 显示的方法名
    commandRef: string;   // 执行 of the command ID
    inputMapping: string;
    outputMapping: string;
    uiLocation: string;   // 绑定的界面位置: "IconMenu" | "Slash" | "Button" | "VirtualButton" | "BoundOnly"
    condition?: string;   // 显示条件 (Condition)
    blockFilter?: string; // 兼容
    buttonLabel?: string; // 定制按钮名
    autoSync?: boolean;
    targetDbId?: string;
    typeFieldId?: string;
    mappedValue?: any;
}

export const COMMAND_BINDINGS: Record<string, CommandBinding> = {};
export const SUPERTAG_REGISTRY: SupertagCommand[] = [];
export const globalSupertagsCache = new Map<string, string[]>();

export function getSupertagRegistry(): SupertagCommand[] {
    return SUPERTAG_REGISTRY;
}

export let commandAvId: string = "";
export let typeAvId: string = "";
export let commandDocId: string = "";
export let typeDocId: string = "";

// State modifiers (setters)
export function setSupertagRegistry(val: SupertagCommand[]) {
    SUPERTAG_REGISTRY.length = 0;
    if (val && Array.isArray(val)) {
        SUPERTAG_REGISTRY.push(...val);
    }
}

export function setCommandBindings(val: Record<string, CommandBinding>) {
    for (const k of Object.keys(COMMAND_BINDINGS)) {
        delete COMMAND_BINDINGS[k];
    }
    if (val) {
        Object.assign(COMMAND_BINDINGS, val);
    }
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

/**
 * 获取当前所有已在 Layer 2 (Command-DB / 种子数据) 注册的可用命令
 */
export function getLayer2Commands(): { id: string; name: string; description?: string; params?: any[] }[] {
    const bindings = Object.values(COMMAND_BINDINGS);
    if (bindings.length > 0) {
        return bindings.map(b => {
            const def = commandRegistry.getCommand(b.commandRef) || commandRegistry.findByNameOrId(b.methodName);
            return {
                id: b.commandRef,
                name: b.methodName || def?.name || b.commandRef,
                description: def?.description || "",
                params: def?.params || []
            };
        }).sort((a, b) => a.name.localeCompare(b.name, "zh"));
    }

    // 兜底（未实例化或 bindings 尚未就绪）：从 seed-data.ts 常量读取 Layer 2 种子命令
    return getSeedCommandRows().map(row => {
        const def = commandRegistry.getCommand(row.commandID) || commandRegistry.findByNameOrId(row.label);
        return {
            id: row.commandID,
            name: row.label || def?.name || row.commandID,
            description: def?.description || "",
            params: def?.params || []
        };
    }).sort((a, b) => a.name.localeCompare(b.name, "zh"));
}
