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
    anchor?: string; // Optional custom anchor override (Emoji/Icon)
    ial?: string;    // Block attribute string (e.g. 'custom-index-subdoc-id="xxx"')
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

        // Standard link format with builder-compatible separator
        
        if (context.isOutline) {
            // Outline Mode: Target is a Heading.
            if (context.iconEnabled) {
                const icon = item.anchor || "📄";
                return `${indent}${marker}${icon} [➖](siyuan://blocks/${item.id}) ${item.text}`;
            } else {
                return `${indent}${marker}[${item.text}](siyuan://blocks/${item.id})`;
            }
        } else {
             // Index Mode: Target is a Document
             if (context.iconEnabled) {
                 const docLink = `[${item.anchor || "📄"}](siyuan://blocks/${item.id})`;
                 return `${indent}${marker}${docLink} ➖ ${item.text}`;
             } else {
                 return `${indent}${marker}[${item.text}](siyuan://blocks/${item.id})`;
             }
        }
    }
}

/**
 * Standard Siyuan Block Reference Strategy: ((id "text"))
 */
export class RefStrategy implements TOCStrategy {
    render(item: RenderItem, context: RenderContext, indent: string): string {
        const marker = context.listType === "unordered" ? "* " : "1. ";
        const display = (item.text).replace(/"/g, "&quot;");

        if (context.isOutline) {
            if (context.iconEnabled) {
                const icon = item.anchor || "📄";
                return `${indent}${marker}${icon} [➖](siyuan://blocks/${item.id}) ((${item.id} "${display}"))`;
            } else {
                return `${indent}${marker}((${item.id} "${display}"))`;
            }
        } else {
            if (context.iconEnabled) {
                const icon = item.anchor || "📄";
                return `${indent}${marker}[${icon}](siyuan://blocks/${item.id}) ➖ ((${item.id} "${display}"))`;
            } else {
                return `${indent}${marker}((${item.id} "${display}"))`;
            }
        }
    }
}

/**
 * Protyle Native Dynamic Reference Strategy: <span data-type="block-ref" ...>
 */
export class DynamicRefStrategy implements TOCStrategy {
    render(item: RenderItem, context: RenderContext, indent: string): string {
        const marker = context.listType === "unordered" ? "* " : "1. ";
        const span = `<span data-type="block-ref" data-id="${item.id}" data-subtype="d">${item.text}</span>`;

        if (context.isOutline) {
            if (context.iconEnabled) {
                const icon = item.anchor || "📄";
                return `${indent}${marker}${icon} [➖](siyuan://blocks/${item.id}) ${span}`;
            } else {
                return `${indent}${marker}${span}`;
            }
        } else {
            if (context.iconEnabled) {
                const docLink = `[${item.anchor || "📄"}](siyuan://blocks/${item.id})`;
                return `${indent}${marker}${docLink} ➖ ${span}`;
            } else {
                return `${indent}${marker}${span}`;
            }
        }
    }
}

/**
 * Tree Strategy (For Outline Builder/Notebook Tree)
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
