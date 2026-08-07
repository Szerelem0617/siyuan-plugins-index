/**
 * icon-menu-config.ts
 * "Icon menu & button" 单元格格式：
 *   JSON: { "menu": [{ "id": "cmd1", "params": {...} }], "button": [...] }
 *   兼容旧格式：逗号分隔的命令 ID → 全部归入 menu
 */

export interface IconMenuEntry {
    id: string;
    params?: Record<string, string>;
}

export interface IconMenuConfig {
    menu: IconMenuEntry[];
    button: IconMenuEntry[];
}

function normalizeList(list: any): IconMenuEntry[] {
    if (!Array.isArray(list)) return [];
    return list
        .map((e: any) => {
            if (typeof e === "string") return { id: e.trim() };
            if (!e || typeof e !== "object") return null;
            const id = String(e.id || "").trim();
            if (!id) return null;
            const params: Record<string, string> = {};
            if (e.params && typeof e.params === "object") {
                for (const [k, v] of Object.entries(e.params)) params[k] = String(v);
            }
            return Object.keys(params).length > 0 ? { id, params } : { id };
        })
        .filter((e: any) => e && e.id);
}

export function parseIconMenuConfig(raw: string): IconMenuConfig {
    const text = String(raw || "").trim();
    if (!text) return { menu: [], button: [] };
    
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
            return {
                menu: normalizeList(parsed.menu),
                button: normalizeList(parsed.button)
            };
        }
    } catch {
        // 若存储的包含额外包裹或单字符命令ID，强转成标准化 JSON 尝试解析
        if (text.includes("menu") || text.includes("button") || text.startsWith("{")) {
            console.warn("[IconMenuConfig] Failed to parse iconMenu JSON DSL:", text);
        }
    }

    return { menu: [], button: [] };
}

export function serializeIconMenuConfig(cfg: IconMenuConfig): string {
    return JSON.stringify({
        menu: cfg.menu.filter(e => e.id),
        button: cfg.button.filter(e => e.id)
    });
}

/** 兼容新旧列名 */
export const ICON_MENU_COL_NAMES = ["Icon Menu", "Icon menu & button", "图标菜单"];
