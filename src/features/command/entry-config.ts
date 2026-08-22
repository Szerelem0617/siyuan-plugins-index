/**
 * entry-config.ts
 * 全局入口配置（方案 B）：位置 → 命令列表。
 * 与后台规则一致，配置存 Command-DB 数据库块的 custom attributes
 * （custom-indexos-entry-config），随数据在思源内，卸载插件不丢失。
 * 位置：顶栏/底栏/侧栏、命令按钮、;;菜单、快捷键、/菜单、块菜单、页面菜单、编辑器菜单。
 * 块菜单条目支持 types 过滤（空 = 所有块类型）。
 */

import { post } from "../../shared/api-client/request";
import { plugin } from "../../shared/utils";
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
    ";;菜单", "快捷键", "/菜单", "块菜单", "页面菜单", "编辑器菜单"
];

export const DEFAULT_ENTRY_CONFIG: EntryConfig = {
    positions: {
        "顶栏右": [],
        "顶栏左": [],
        "底栏右": [],
        "底栏左": [],
        "侧栏左": [],
        "侧栏右": [],
        ";;菜单": [
            "index.openGraph",
            "index.duplicateContent",
            "index.insertBlockBelow",
            "index.safeUpdateBlock",
            "index.visualEffect",
            "index.showToast",
            "index.setBlockAttribute",
            "index.moveContent"
        ],
        "快捷键": [],
        "/菜单": [],
        "块菜单": [],
        "页面菜单": [],
        "编辑器菜单": []
    }
};

/** 位置的补充说明（显示在入口配置对话框） */
export const POSITION_HINTS: Record<string, string> = {
    "快捷键": "加入后可在 设置 → 快捷键 → 插件 → 目录插件 中找到该命令，并为其绑定快捷键",
    "/菜单": "加入后可在编辑器内输入 / 呼出的菜单中找到该命令",
    ";;菜单": "在编辑器内输入 ;;（或；；）呼出的快捷命令面板"
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
            const rows: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
            if (rows.length > 0) {
                const blockId = String(rows[0].id || "");
                if (blockId && blockId !== commandAvId) return blockId;
            }
        } catch (_) {}
    }

    // 3. 从 attributes 表反查 custom-index-command-db 记录的 block_id
    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT block_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`
        });
        const rows: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        if (rows.length > 0) {
            const blockId = String(rows[0].block_id || "");
            if (blockId) return blockId;
        }
    } catch (_) {}

    return "";
}

const LOCAL_FILE_NAME = "entry-config.json";
let g_entryConfigCache: EntryConfig = cloneDefault();

export function getEntryConfigSync(): EntryConfig {
    return g_entryConfigCache;
}

export async function loadEntryConfig(): Promise<EntryConfig> {
    let localCfg: EntryConfig | null = null;
    try {
        if (plugin) {
            const data = await plugin.loadData(LOCAL_FILE_NAME);
            if (data && typeof data === "object" && data.positions) {
                localCfg = data as EntryConfig;
            }
        }
    } catch (_) {}

    const blockId = await resolveEntryConfigBlockId();
    if (blockId) {
        try {
            const res = await post("/api/attr/getBlockAttrs", { id: blockId });
            const raw = res?.[ENTRY_CONFIG_KEY];
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && parsed.positions) {
                    g_entryConfigCache = parsed as EntryConfig;
                    if (plugin) {
                        plugin.saveData(LOCAL_FILE_NAME, g_entryConfigCache);
                    }
                    return g_entryConfigCache;
                }
            }
        } catch (e) {
            console.error("[EntryConfig] 读取数据库块属性失败:", e);
        }
    }

    g_entryConfigCache = localCfg || cloneDefault();
    return g_entryConfigCache;
}

export async function saveEntryConfig(cfg: EntryConfig): Promise<void> {
    // 1. 独立写文件数据层 (插件 json 配置文件)，未实例化同样允许保存
    if (plugin) {
        await plugin.saveData(LOCAL_FILE_NAME, cfg);
    }

    // 2. 若已实例化，双写至 Command-DB 属性中
    const blockId = await resolveEntryConfigBlockId();
    if (blockId) {
        try {
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: { [ENTRY_CONFIG_KEY]: JSON.stringify(cfg) }
            });
        } catch (e) {
            console.error("[EntryConfig] 双写保存至数据库块属性失败:", e);
        }
    }

    g_entryConfigCache = cfg;
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

import type { TargetScope } from "./registry/command-registry";

/** 命令裸绑定到某位置是否合适（基于 targetScope 4 枚举分类智能匹配，非强制阻断） */
export function suitableForPosition(targetScope: TargetScope | undefined, position: string): boolean {
    const scope = targetScope || "any";
    if (scope === "any") return true;

    // 1. 顶栏/底栏/侧栏/快捷键：主要适合全局无需上下文的命令 (none)
    if (position.includes("顶栏") || position.includes("底栏") || position.includes("侧栏") || position === "快捷键") {
        return scope === "none" || scope === "any";
    }

    // 2. 页面菜单/编辑器菜单：适合页面命令 (doc) 及全局无上下文命令 (none)
    if (position === "页面菜单" || position === "编辑器菜单") {
        return scope === "doc" || scope === "none" || scope === "any";
    }

    // 3. 块菜单//菜单：适合内容块命令 (block) 及全局命令 (none)
    if (position === "块菜单" || position === "/菜单") {
        return scope === "block" || scope === "none" || scope === "any";
    }

    // 4. 命令按钮 / ;;菜单：允许任意匹配
    return true;
}
