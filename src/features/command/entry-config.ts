/**
 * entry-config.ts
 * 全局入口配置（方案 B）：位置 → 命令列表，存插件数据（data/storage/petal/...，随工作空间同步）。
 * 位置：顶栏/底栏/侧栏（单选位置）、行内按钮/快捷命令/命令面板/块菜单/页面菜单/编辑器菜单（可多选）。
 * 块菜单条目支持 types 过滤（空 = 所有块类型）。
 */

import { plugin } from "../../shared/utils";

export const ENTRY_CONFIG_KEY = "entry-config";

export interface BlockMenuEntry {
    id: string;
    types?: string[];
}

export interface EntryConfig {
    positions: Record<string, (string | BlockMenuEntry)[]>;
}

export const ENTRY_POSITIONS = [
    "顶栏右", "顶栏左", "底栏右", "底栏左", "侧栏左", "侧栏右",
    "行内按钮", "快捷命令", "命令面板", "块菜单", "页面菜单", "编辑器菜单"
];

const DEFAULT_ENTRY_CONFIG: EntryConfig = {
    positions: {
        "顶栏右": [],
        "顶栏左": [],
        "底栏右": [],
        "底栏左": [],
        "侧栏左": [],
        "侧栏右": [],
        "行内按钮": [
            "plugin-index.command.safeUpdateBlock",
            "plugin-index.effect.fireworks",
            "siyuan.ui.toast",
            "plugin-index.command.turnIntoTask",
            "siyuan.view.graph"
        ],
        "快捷命令": [
            "siyuan.view.graph",
            "editor.block.duplicate",
            "api.block.insert",
            "plugin-index.command.safeUpdateBlock",
            "plugin-index.effect.fireworks",
            "siyuan.ui.toast",
            "plugin-index.command.turnIntoTask"
        ],
        "命令面板": [],
        "块菜单": [],
        "页面菜单": [],
        "编辑器菜单": []
    }
};

export function loadEntryConfig(): EntryConfig {
    const data = plugin?.data?.[ENTRY_CONFIG_KEY];
    if (data && typeof data === "object" && (data as EntryConfig).positions) {
        return data as EntryConfig;
    }
    return DEFAULT_ENTRY_CONFIG;
}

export async function initEntryConfig(): Promise<void> {
    if (!plugin?.data?.[ENTRY_CONFIG_KEY]) {
        await plugin.saveData(ENTRY_CONFIG_KEY, DEFAULT_ENTRY_CONFIG);
    }
}

export async function saveEntryConfig(cfg: EntryConfig): Promise<void> {
    await plugin.saveData(ENTRY_CONFIG_KEY, cfg);
}

/** 某位置的命令 ID 列表 */
export function positionCommands(cfg: EntryConfig, position: string): string[] {
    return (cfg.positions[position] || []).map(e => (typeof e === "string" ? e : e.id)).filter(Boolean);
}

/** 块菜单条目（含类型过滤） */
export function blockMenuEntries(cfg: EntryConfig): BlockMenuEntry[] {
    return (cfg.positions["块菜单"] || [])
        .map(e => (typeof e === "string" ? { id: e } : e))
        .filter(e => e.id);
}

/** 思源块 data-type → 用户可选的块类型名 */
export function blockTypeOf(dataType: string): string | null {
    const map: Record<string, string> = {
        "NodeDocument": "文档",
        "NodeParagraph": "段落",
        "NodeHeading": "标题",
        "NodeListItem": "列表",
        "NodeList": "列表",
        "NodeBlockquoteLiteral": "引述",
        "NodeCodeBlock": "代码块",
        "NodeTable": "表格",
        "NodeSuperBlock": "超级块"
    };
    return map[dataType] || null;
}

export const BLOCK_TYPES = ["段落", "标题", "列表", "引述", "代码块", "表格", "超级块", "文档"];
