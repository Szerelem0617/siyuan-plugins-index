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
        const trimmed = raw.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((t: any) => String(t || "").trim()).filter(Boolean);
            }
        } catch (_) {}
        // Fallback for comma separated tags
        const sep = trimmed.includes(",") ? "," : " ";
        return trimmed.split(sep).map(t => t.trim().replace(/^#/g, "")).filter(Boolean);
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
