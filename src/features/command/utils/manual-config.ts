/**
 * manual-config.ts
 * Supertag-DB "Manual" (手动触发) 列数据结构与配置管理
 *
 * 4 种手动命令暴露形态 (Manual Exposure Forms)：
 * 1. ⌨️ showInSlash: ;; 快捷命令面板 (默认 true)
 * 2. 📋 showInMenu: Icon Menu 菜单栏 (默认 true)
 * 3. 🧱 showInButton: Button 块下方实体按钮 (默认 false)
 * 4. 👻 showInVirtualButton: Virtual Button 虚拟悬浮按钮 (默认 false)
 *
 * 块过滤条件 (Block Filter):
 * 用于 Virtual Button / Button 的条件显示（如 custom-status == 'pending'）
 */

export interface ManualCommandEntry {
    id: string;
    params?: Record<string, string>;
    showInSlash: boolean;          // ⌨️ ;; 面板
    showInMenu: boolean;           // 📋 Icon Menu 菜单
    showInButton: boolean;         // 🧱 块下方实体按钮
    showInVirtualButton: boolean;  // 👻 虚拟悬浮按钮
    condition?: string;            // 显示条件 (Condition)
    /** @deprecated 兼容字段 */
    blockFilter?: string;
    buttonLabel?: string;          // 定制按钮名称
}

export type ManualConfig = ManualCommandEntry[];

/** 默认初始化单个命令的 Manual 配置 (;; 面板与 Icon Menu 默认绑定，Button 与 Virtual Button 默认关闭) */
export function createDefaultManualEntry(id: string, params?: Record<string, string>): ManualCommandEntry {
    return {
        id: id.trim(),
        params: params && Object.keys(params).length > 0 ? params : undefined,
        showInSlash: true,
        showInMenu: true,
        showInButton: false,
        showInVirtualButton: false,
        condition: ""
    };
}

export function parseManualConfig(raw: string): ManualConfig {
    const text = String(raw || "").trim();
    if (!text) return [];

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return parsed.map((item: any) => {
                if (typeof item === "string") return createDefaultManualEntry(item);
                if (!item || !item.id) return null;
                const cond = item.condition || item.blockFilter;
                return {
                    id: String(item.id).trim(),
                    params: item.params && typeof item.params === "object" ? item.params : undefined,
                    showInSlash: item.showInSlash !== undefined ? Boolean(item.showInSlash) : true,
                    showInMenu: item.showInMenu !== undefined ? Boolean(item.showInMenu) : true,
                    showInButton: Boolean(item.showInButton),
                    showInVirtualButton: Boolean(item.showInVirtualButton),
                    condition: cond ? String(cond).trim() : undefined,
                    buttonLabel: item.buttonLabel ? String(item.buttonLabel).trim() : undefined
                };
            }).filter(Boolean) as ManualConfig;
        }

        // 兼容旧格式 { menu: [...], button: [...] }
        if (parsed && typeof parsed === "object") {
            const result: ManualCommandEntry[] = [];
            const menuList = Array.isArray(parsed.menu) ? parsed.menu : [];
            const buttonList = Array.isArray(parsed.button) ? parsed.button : [];

            const map = new Map<string, ManualCommandEntry>();

            menuList.forEach((m: any) => {
                const id = typeof m === "string" ? m.trim() : String(m?.id || "").trim();
                if (!id) return;
                const params = m?.params && typeof m.params === "object" ? m.params : undefined;
                map.set(id, {
                    id,
                    params,
                    showInSlash: true,
                    showInMenu: true,
                    showInButton: false,
                    showInVirtualButton: false
                });
            });

            buttonList.forEach((b: any) => {
                const id = typeof b === "string" ? b.trim() : String(b?.id || "").trim();
                if (!id) return;
                const params = b?.params && typeof b.params === "object" ? b.params : undefined;
                if (map.has(id)) {
                    const existing = map.get(id)!;
                    existing.showInButton = true;
                    if (!existing.params && params) existing.params = params;
                } else {
                    map.set(id, {
                        id,
                        params,
                        showInSlash: false,
                        showInMenu: false,
                        showInButton: true,
                        showInVirtualButton: false
                    });
                }
            });

            return Array.from(map.values());
        }
    } catch (_) {
        // 逗号/换行分隔旧格式
        const ids = text.split(/[,，\n;；]/).map(s => s.trim()).filter(Boolean);
        if (ids.length > 0) {
            return ids.map(id => createDefaultManualEntry(id));
        }
    }

    return [];
}

export function serializeManualConfig(entries: ManualConfig): string {
    const valid = entries.filter(e => e && e.id);
    return JSON.stringify(valid);
}

/** 兼容旧列名 */
export const MANUAL_COL_NAMES = ["Manual", "manual", "Icon Menu", "Icon menu & button", "图标菜单", "手动触发", "手动"];
export const AUTO_COL_NAMES = ["Auto", "auto", "Conditional", "conditional", "条件", "触发器", "自动触发", "自动"];
