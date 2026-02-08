/**
 * 将 Hex 字符串转换为 Emoji 字符
 * @param hex Emoji 的 Hex 编码 (e.g. "1f600" or "1f600-fe0f")
 * @returns 对应的 Unicode Emoji 字符
 */
export function hexToEmoji(hex: string) {
    if (!hex) return "";
    try {
        return hex.split("-").map(item => String.fromCodePoint(parseInt(item, 16))).join("");
    } catch (e) {
        return hex;
    }
}

/**
 * 获取处理后的文档图标 (Unicode/Emoji/Static Text/Custom Image/Dynamic Icon)
 * @param icon 图标字符串
 * @param hasChild 是否有子文档 (用于默认图标判断)
 * @returns 处理后的图标字符串 (可能是字符或符合思源语法的冒号别名)
 */
export function getProcessedDocIcon(icon: string, hasChild: boolean) {
    if (!icon) {
        return hasChild ? "📑" : "📄";
    }

    // 1. 动态图标 (Dynamic Icons)
    // 目前跳过动态图标支持，回退到默认图标以保证稳定性
    if (icon.startsWith("api/icon/getDynamicIcon")) {
        return hasChild ? "📑" : "📄";
    }

    // 2. 自定义图片表情 (Custom image emojis - e.g. kmind/kmind.svg)
    // 使用思源最原生的别名语法 :分组名/文件名:，确保 100% 行内显示且支持点击更换
    if (icon.includes(".")) {
        const alias = icon.split(".")[0];
        return `:${alias}:`;
    }

    // 3. 自定义短代码 (Shortcode support - e.g. :kmind/kmind:)
    if (icon.startsWith(':') && icon.endsWith(':')) {
        return icon;
    }

    // 4. Unicode 十六进制序列 (Unicode Hex Sequence - e.g. "1f600")
    if (/^[0-9a-fA-F-]+$/.test(icon)) {
        return hexToEmoji(icon) || (hasChild ? "📑" : "📄");
    }

    return hasChild ? "📑" : "📄";
}
