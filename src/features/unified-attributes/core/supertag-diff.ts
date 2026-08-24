/**
 * supertag-diff.ts
 *
 * 标签解析、增量 Diff 对比与缓存管理模块 (Pure Calculations & Cache)
 */

export const tagCache = new Map<string, Set<string>>();

export function parseSupertags(raw: any): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((t: any) => String(t || "").trim()).filter(Boolean);
    }
    if (typeof raw === "string") {
        let trimmed = raw.trim();
        if (!trimmed) return [];
        // 解码常见 HTML 转义字符 (&quot;, &#34;, &amp; 等) 与转义引号
        trimmed = trimmed
            .replace(/&quot;/g, '"')
            .replace(/&#34;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/\\"/g, '"');
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((t: any) => String(t || "").trim()).filter(Boolean);
            }
        } catch (_) {}
        // 支持纯数组字符串解析 (如 ["tag1", "tag2"])
        const arrayMatch = trimmed.match(/^\[(.*)\]$/);
        if (arrayMatch) {
            return arrayMatch[1]
                .split(",")
                .map(t => t.replace(/["'\s]/g, "").trim())
                .filter(Boolean);
        }
        // Fallback for comma separated tags
        const sep = trimmed.includes(",") ? "," : " ";
        return trimmed.split(sep).map(t => t.trim().replace(/^#/g, "").replace(/["']/g, "")).filter(Boolean);
    }
    return [];
}

export function serializeSupertags(tags: string[]): string {
    const cleanTags = Array.from(new Set(tags.map(t => String(t || "").trim()).filter(Boolean)));
    return cleanTags.length > 0 ? JSON.stringify(cleanTags) : "";
}

export function diffSupertags(oldTagsSet: Set<string>, newTagsSet: Set<string>): { added: string[]; removed: string[] } {
    const added: string[] = [];
    const removed: string[] = [];

    for (const tag of newTagsSet) {
        if (!oldTagsSet.has(tag)) {
            added.push(tag);
        }
    }

    for (const tag of oldTagsSet) {
        if (!newTagsSet.has(tag)) {
            removed.push(tag);
        }
    }

    return { added, removed };
}

export function cleanTagString(tag: string): string {
    return tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
}
