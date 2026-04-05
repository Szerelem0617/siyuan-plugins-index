import { client } from "../../shared/api-client";
import { getProcessedDocIcon } from "../../shared/utils/icon-utils";
import { escapeHtml } from "../../shared/utils";


export interface ReverseBuildItem {
    id: string;
    text: string;
    icon?: string;
}

/**
 * 为 Database/Builder 专用的格式化渲染
 * 严格按照 Builder 引擎解析标准：[icon](siyuan://blocks/id) ➖ text
 */
export function generateBuilderListItem(item: ReverseBuildItem, indent: string = "", isOrdered: boolean = false): string {
    const marker = isOrdered ? "1. " : "* ";
    const icon = item.icon || "📄";
    return `${indent}${marker}[${icon}](siyuan://blocks/${item.id}) ➖ ${item.text}`;
}

/**
 * 递归获取子文档树，并以严格符合 Builder (双链数据库) 引擎语法的格式生成 Markdown。
 * 取代了原本写在 TOC 目录里的杂揉逻辑，完全分离。
 */
export async function buildSubdocTreeMarkdown(notebookId: string, path: string, tab = 0, isOrdered = false): Promise<string> {
    let md = "";
    
    let docs;
    try {
        docs = await client.listDocsByPath({ notebook: notebookId, path });
    } catch (err) {
        console.error(`[ReverseBuild] Failed to list docs for path "${path}":`, err);
        return "";
    }

    if (!docs?.data?.files) return md;

    let indent = "";
    for (let n = 0; n < tab; n++) {
        indent += '    ';
    }

    for (let doc of docs.data.files) {
        const id = doc.id;
        const name = escapeHtml(doc.name.slice(0, -3));
        const subFileCount = doc.subFileCount;
        const subPath = doc.path;

        let iconStr = getProcessedDocIcon(doc.icon, subFileCount != 0);
        if (!iconStr || (iconStr.startsWith(":") && iconStr.endsWith(":"))) {
            iconStr = subFileCount != 0 ? "📑" : "📄";
        }

        md += generateBuilderListItem({ id, text: name, icon: iconStr }, indent, isOrdered) + "\n";

        if (subFileCount > 0) {
            md += await buildSubdocTreeMarkdown(notebookId, subPath, tab + 1, isOrdered);
        }
    }

    return md;
}

/**
 * 递归获取大纲树，并严格按照 Builder (双链数据库) 引擎引擎要求输出格式。
 */
export async function buildOutlineTreeMarkdown(
    outlineData: any[],
    tab: number,
    stab: number,
    extraData?: Record<string, { ial: string, markdown: string, content: string }>,
    isOrdered: boolean = false
): Promise<string> {
    let md = "";
    tab++;

    for (let outline of outlineData) {
        let id = outline.id;
        let name = "";
        let pureTextContent = "";

        if (extraData && extraData[id]) {
            name = extraData[id].markdown.replace(/^#+\s+/, "").replace(/\s*\{:[^}]+\}\s*$/, "").trim();
            pureTextContent = extraData[id].content;
        } else {
            name = outline.depth == 0 ? outline.name : outline.content;
            pureTextContent = name;
        }

        let indent = "";
        for (let n = 1; n < tab - stab; n++) {
            indent += '    ';
        }

        // 强行使用 ➖ 图标保证 Builder 提取时的统一性
        md += generateBuilderListItem({ id, text: name || pureTextContent, icon: "➖" }, indent, isOrdered) + "\n";

        const subOutlineCount = outline.count;
        if (subOutlineCount > 0) {
            if (outline.depth == 0) {
                md += await buildOutlineTreeMarkdown(outline.blocks, tab, stab, extraData, isOrdered);
            } else {
                md += await buildOutlineTreeMarkdown(outline.children, tab, stab, extraData, isOrdered);
            }
        }
    }
    return md;
}

