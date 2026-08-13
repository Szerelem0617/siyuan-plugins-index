/**
 * attribute-sanitizer.ts
 * 思源块自定义属性名规范清洗器
 * 规则：思源属性名只能包含小写英文字母、数字和连字符 -，且必须以小写字母开头
 * 映射例：var.somevariable -> custom-somevariable
 */

export function sanitizeBlockAttrName(rawKey: string): string {
    if (!rawKey) return "custom-output";

    let key = rawKey.trim();
    // 剥离外层 {{ }}、custom- 以及 var. 前缀
    key = key.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").trim();
    key = key.replace(/^custom-/, "").trim();
    key = key.replace(/^var[._]/i, "").trim();

    // 替换所有非英文字母/数字为连字符 -
    let clean = key.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    clean = clean.replace(/-+/g, "-").replace(/^-+|-+$/g, "");

    if (!clean || !/^[a-z]/.test(clean)) {
        clean = `v-${clean || "output"}`;
    }

    return `custom-${clean}`;
}
