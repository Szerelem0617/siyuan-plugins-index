import { settings } from "../../core/settings";
import { stripMarkdownSyntax } from "../../shared/utils/markdown-utils";

function filterIAL(ialStr: string) {
    if (!ialStr) return "";
    const whitelist = new Set(["style", "class"]);
    
    const parts = ialStr.match(/(\S+?)=\"([\s\S]*?)\"/g);
    if (!parts) return "";
    
    const filtered = parts.filter(part => {
        const key = part.match(/^(\S+?)=/)?.[1];
        return key && whitelist.has(key);
    });
    
    return filtered.join(" ");
}

function extractHeadingContent(markdown: string) {
    if (!markdown) return "";
    let content = markdown.replace(/^#+\s+/, "").trim();
    content = content.replace(/\s*\{:[^}]+\}\s*$/, "").trim();
    return content;
}

export function generateOutlineMarkdown(outlineData: any[], tab: number, stab: number, extraData?: Record<string, { ial: string, markdown: string }>, existingAnchors?: Map<string, string>): string {
    let data = "";
    tab++;

    for (let outline of outlineData) {
        let id = outline.id;
        let name = "";
        let ial = "";

        if (extraData && extraData[id]) {
            name = extractHeadingContent(extraData[id].markdown) || (outline.depth == 0 ? outline.name : outline.content);
            ial = filterIAL(extraData[id].ial);
        } else {
            name = outline.depth == 0 ? outline.name : outline.content;
        }

        let indent = "";
        let subOutlineCount = outline.count;
        for (let n = 1; n <= stab; n++) {
            indent += '    ';
        }

        indent += "> ";

        for (let n = 1; n < tab - stab; n++) {
            indent += '    ';
        }

        let listType = settings.get("listTypeOutline") == "unordered" ? true : false;
        let listMarker = listType ? "* " : "1. ";

        data += indent + listMarker;

        let outlineType = settings.get("outlineType"); // "ref", "embed"
        let ialStr = ial ? `\n${indent}   {: ${ial}}` : "";

        let iconEnabled = settings.get("iconOutline") ?? true;
        let anchorText = existingAnchors?.get(id);

        // Strategy 2: If no icon, use plain text and bind to it
        if (!iconEnabled) {
            // If existing anchor is the default icon, discard it
            if (anchorText === "➖") anchorText = undefined;
            
            // If no custom anchor, use plain text
            if (!anchorText) {
                anchorText = stripMarkdownSyntax(name);
            }
        } else {
            // Strategy 1: If icon enabled, default to icon if no anchor
            if (!anchorText) anchorText = "➖";
        }

        let safeAnchorText = anchorText.replace(/"/g, "&quot;");

        if (iconEnabled) {
            // Icon Enabled: Bind to Icon + Append Rich Text
            if (outlineType == "ref") {
                data += `[${anchorText}](siyuan://blocks/${id}) ${name}${ialStr}\n`;
            } else {
                data += `((${id} "${safeAnchorText}")) ${name}${ialStr}\n`;
            }
        } else {
            // Icon Disabled: Bind to Plain Text (No append)
            if (outlineType == "ref") {
                data += `[${anchorText}](siyuan://blocks/${id})${ialStr}\n`;
            } else {
                data += `((${id} "${safeAnchorText}"))${ialStr}\n`;
            }
        }
        
        if (subOutlineCount > 0) {
            if (outline.depth == 0) {
                data += generateOutlineMarkdown(outline.blocks, tab, stab, extraData, existingAnchors);
            } else {
                data += generateOutlineMarkdown(outline.children, tab, stab, extraData, existingAnchors);
            }
        }
    }
    return data;
}
