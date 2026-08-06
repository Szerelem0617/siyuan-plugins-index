/**
 * entry-config.ts
 * 全局入口配置（方案 B）：位置 → 命令列表。
 * 与后台规则一致，配置存 Command-DB 数据库块的 custom attributes
 * （custom-indexos-entry-config），随数据在思源内，卸载插件不丢失。
 * 位置：顶栏/底栏/侧栏（单选位置）、行内按钮/快捷命令/命令面板/块菜单/页面菜单/编辑器菜单（可多选）。
 * 块菜单条目支持 types 过滤（空 = 所有块类型）。
 */

import { post } from "../../shared/api-client/request";
import { getCommandAvId } from "./registration";
import type { ContextNeed } from "./registry/command-registry";

/** 存 Command-DB 数据库块 custom attributes 的属性名 */
export const ENTRY_CONFIG_KEY = "custom-indexos-entry-config";

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

export const DEFAULT_ENTRY_CONFIG: EntryConfig = {
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

function cloneDefault(): EntryConfig {
    return JSON.parse(JSON.stringify(DEFAULT_ENTRY_CONFIG)) as EntryConfig;
}

/** 解析 Command-DB 数据库块的物理 Block ID（与后台规则同一宿主块） */
export async function resolveEntryConfigBlockId(): Promise<string> {
    const commandAvId = getCommandAvId();

    // 1. 直接从 DOM 抓取 NodeAttributeView 的物理 data-node-id
    if (commandAvId) {
        const avEl = document.querySelector(`[data-av-id="${commandAvId}"]`);
        if (avEl) {
            const nodeId = avEl.getAttribute("data-node-id") || avEl.getAttribute("data-id");
            if (nodeId && nodeId !== commandAvId) return nodeId;
        }
    }

    // 2. 从 blocks 表反查 type = 'av' 的物理块
    if (commandAvId) {
        try {
            const res = await post("/api/query/sql", {
                stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${commandAvId}%' OR ial LIKE '%${commandAvId}%') LIMIT 1`
            });
            if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                const blockId = String(res.data[0].id || "");
                if (blockId && blockId !== commandAvId) return blockId;
            }
        } catch (_) {}
    }

    // 3. 从 attributes 表反查 custom-index-command-db 记录的 block_id
    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT block_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`
        });
        if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
            const blockId = String(res.data[0].block_id || "");
            if (blockId) return blockId;
        }
    } catch (_) {}

    return "";
}

export async function loadEntryConfig(): Promise<EntryConfig> {
    const blockId = await resolveEntryConfigBlockId();
    if (!blockId) return cloneDefault(); // 未实例化：种子默认（只读）
    try {
        const res = await post("/api/attr/getBlockAttrs", { id: blockId });
        const raw = res?.[ENTRY_CONFIG_KEY];
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && parsed.positions) {
                return parsed as EntryConfig;
            }
        }
    } catch (e) {
        console.error("[EntryConfig] 读取数据库块属性失败:", e);
    }
    return cloneDefault();
}

export async function saveEntryConfig(cfg: EntryConfig): Promise<void> {
    const blockId = await resolveEntryConfigBlockId();
    if (!blockId) {
        throw new Error("未找到 Command-DB 数据库块：请先将数据存到思源，入口配置会保存在数据库块属性中");
    }
    await post("/api/attr/setBlockAttrs", {
        id: blockId,
        attrs: { [ENTRY_CONFIG_KEY]: JSON.stringify(cfg) }
    });
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

/** 各入口位置提供的上下文等级（none=无上下文 / block=块 / doc=文档） */
export const POSITION_CONTEXT: Record<string, ContextNeed> = {
    "顶栏右": "none", "顶栏左": "none",
    "底栏右": "none", "底栏左": "none",
    "侧栏左": "none", "侧栏右": "none",
    "命令面板": "none", "快捷命令": "none",
    "行内按钮": "block", "块菜单": "block",
    "页面菜单": "doc", "编辑器菜单": "doc"
};

const CTX_LEVEL: Record<ContextNeed, number> = { none: 0, block: 1, doc: 2 };

/**
 * 命令裸绑定到某位置是否合适：位置提供的上下文等级 >= 命令的最低需求。
 * 例：contextNeed=block 的命令绑定到顶栏（none）→ 不合适；绑定到块菜单 → 合适。
 */
export function suitableForPosition(contextNeed: ContextNeed, position: string): boolean {
    const provided = POSITION_CONTEXT[position];
    if (!provided) return true; // 未知位置放行
    return CTX_LEVEL[provided] >= CTX_LEVEL[contextNeed];
}
