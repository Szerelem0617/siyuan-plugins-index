import { settings } from "../../../core/settings";
import { StrategyRegistry, RenderContext, RenderItem } from "../../../shared/render/strategy";

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

export function generateOutlineMarkdown(
    outlineData: any[],
    tab: number,
    stab: number,
    extraData?: Record<string, { ial: string, markdown: string, content: string }>,
    existingAnchors?: Map<string, string>,
    config?: any
): string {
    let data = "";
    tab++;

    const effectiveConfig = {
        outlineType: config?.outlineType ?? settings.get("outlineType"),
        listTypeOutline: config?.listTypeOutline ?? settings.get("listTypeOutline"),
        iconOutline: config?.iconOutline ?? settings.get("iconOutline")
    };

    const renderContext: RenderContext = {
        linkType: effectiveConfig.outlineType,
        iconEnabled: effectiveConfig.iconOutline,
        listType: effectiveConfig.listTypeOutline as "unordered" | "ordered",
        isOutline: true
    };

    const strategy = StrategyRegistry.get(effectiveConfig.outlineType);

    for (let outline of outlineData) {
        let id = outline.id;
        let name = "";
        let ial = "";
        let pureTextContent = "";

        // Fallback pattern: Prefer SQL data if available, otherwise use basic outline data
        if (extraData && extraData[id]) {
            name = extractHeadingContent(extraData[id].markdown) || (outline.depth == 0 ? outline.name : outline.content);
            ial = filterIAL(extraData[id].ial);
            pureTextContent = extraData[id].content;
        } else {
            name = outline.depth == 0 ? outline.name : outline.content;
            pureTextContent = name;
        }

        let indent = "";
        for (let n = 1; n <= stab; n++) {
            indent += '    ';
        }
        if (effectiveConfig.outlineType !== "tree") {
            indent += "> ";
        }
        for (let n = 1; n < tab - stab; n++) {
            indent += '    ';
        }

        let anchorText = existingAnchors?.get(id);
        
        // When rich text sync (iconOutline) is off, we use the pure text content
        if (!effectiveConfig.iconOutline && !anchorText) {
            anchorText = pureTextContent;
        }

        const renderItem: RenderItem = {
            id: id,
            text: name,
            anchor: anchorText,
            ial: ial || undefined
        };

        data += strategy.render(renderItem, renderContext, indent) + "\n";

        const subOutlineCount = outline.count;
        if (subOutlineCount > 0) {
            if (outline.depth == 0) {
                data += generateOutlineMarkdown(outline.blocks, tab, stab, extraData, existingAnchors, config);
            } else {
                data += generateOutlineMarkdown(outline.children, tab, stab, extraData, existingAnchors, config);
            }
        }
    }
    return data;
}
