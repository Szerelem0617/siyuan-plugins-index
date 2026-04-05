/**
 * Rendering strategies for TOC/Outline items
 * Shared across Index and Outline features
 */

export interface RenderContext {
    linkType: string;
    iconEnabled: boolean;
    listType: "unordered" | "ordered";
    col?: number; // For index column mode
    isOutline?: boolean; // For outline-specific behaviors
}

export interface RenderItem {
    id: string;
    text: string;
    icon?: string;
    anchor?: string; // Optional custom anchor override
    ial?: string; // Siyuan block attributes suffix
}

export interface TOCStrategy {
    render(item: RenderItem, context: RenderContext, indent: string): string;
}

/**
 * Standard Siyuan Markdown Link Strategy: [text](siyuan://blocks/id)
 */
export class LinkStrategy implements TOCStrategy {
    render(item: RenderItem, context: RenderContext, indent: string): string {
        const marker = context.listType === "unordered" ? "* " : "1. ";
        const ialStr = item.ial ? `\n${indent}   {: ${item.ial}}` : "";

        // If icon is enabled and NOT outline/tree, icon is a prefix, title is the link
        if (context.iconEnabled && !context.isOutline && context.linkType !== "tree") {
             const icon = item.anchor || "➖"; 
             return `${indent}${marker}${icon} [${item.text}](siyuan://blocks/${item.id})${ialStr}`;
        }

        // Outline or Tree: Icon is the link anchor
        const anchor = item.anchor || (context.iconEnabled ? "➖" : item.text);
        // FIX: In outline mode, if icon is enabled, ALWAYS append the main text.
        if (context.isOutline && context.iconEnabled && item.text) {
             return `${indent}${marker}[${anchor}](siyuan://blocks/${item.id}) ${item.text}${ialStr}`;
        }
        return `${indent}${marker}[${anchor}](siyuan://blocks/${item.id})${ialStr}`;
    }
}

/**
 * Standard Siyuan Block Reference Strategy: ((id "text"))
 */
export class RefStrategy implements TOCStrategy {
    render(item: RenderItem, context: RenderContext, indent: string): string {
        const marker = context.listType === "unordered" ? "* " : "1. ";
        const ialStr = item.ial ? `\n${indent}   {: ${item.ial}}` : "";

        // Index mode with icons: Icon as prefix, title as block ref
        if (context.iconEnabled && !context.isOutline && context.linkType !== "tree") {
            const icon = item.anchor || "➖";
            const safeText = item.text.replace(/"/g, "&quot;");
            return `${indent}${marker}${icon} ((${item.id} "${safeText}"))${ialStr}`;
        }

        // Outline or Tree mode: Block ref as the anchor
        const display = (item.anchor || (context.iconEnabled ? "➖" : item.text)).replace(/"/g, "&quot;");
        // FIX: In outline mode, if icon is enabled, ALWAYS append the main text.
        if (context.isOutline && context.iconEnabled && item.text) {
            return `${indent}${marker}((${item.id} "${display}")) ${item.text}${ialStr}`;
        }
        return `${indent}${marker}((${item.id} "${display}"))${ialStr}`;
    }
}

/**
 * Protyle Native Dynamic Reference Strategy: <span data-type="block-ref" ...>
 */
export class DynamicRefStrategy implements TOCStrategy {
    render(item: RenderItem, context: RenderContext, indent: string): string {
        const marker = context.listType === "unordered" ? "* " : "1. ";
        const span = `<span data-type="block-ref" data-id="${item.id}" data-subtype="d">${item.text}</span>`;
        const ialStr = item.ial ? `\n${indent}   {: ${item.ial}}` : "";

        if (context.iconEnabled) {
            const icon = item.anchor || "➖";
            if (context.isOutline || context.linkType === "tree") {
                return `${indent}${marker}[${icon}](siyuan://blocks/${item.id}) ${span}${ialStr}`;
            }
            return `${indent}${marker}${icon} ${span}${ialStr}`;
        }
        return `${indent}${marker}${span}${ialStr}`;
    }
}

/**
 * Tree Strategy (For Outline Builder/Notebook Tree)
 * Kept internally for backend builder/DB transformations. Hidden from UI.
 */
export class TreeStrategy implements TOCStrategy {
    render(item: RenderItem, context: RenderContext, indent: string): string {
        const marker = context.listType === "unordered" ? "* " : "1. ";
        const icon = item.anchor || "📄";
        return `${indent}${marker}[${icon}](siyuan://blocks/${item.id}) ➖ ${item.text}`;
    }
}

export class StrategyRegistry {
    private static strategies: Record<string, TOCStrategy> = {
        "link": new LinkStrategy(),
        "reference": new RefStrategy(),
        "dynamic-ref": new DynamicRefStrategy(),
        "tree": new TreeStrategy()
    };

    static get(type: string): TOCStrategy {
        return this.strategies[type] || this.strategies["link"];
    }
}
