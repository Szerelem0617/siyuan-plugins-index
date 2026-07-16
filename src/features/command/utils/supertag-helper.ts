export function parseSupertags(rawAttr: string | null | undefined): string[] {
    if (!rawAttr) return [];
    try {
        const parsed = JSON.parse(rawAttr);
        if (Array.isArray(parsed)) {
            return parsed.map(t => String(t).trim().toLowerCase()).filter(Boolean);
        }
    } catch (_) {}
    return rawAttr.split(/[, ]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
}

export function serializeSupertags(tags: string[]): string {
    const cleaned = Array.from(new Set(tags.map(t => t.trim()))).filter(Boolean);
    return cleaned.length > 0 ? JSON.stringify(cleaned) : "";
}

export function findActiveBlock(protyle: any): HTMLElement | null {
    if (!protyle) return null;
    const selection = window.getSelection();
    const range = protyle.toolbar?.range || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (!range) return null;

    let node: Node | null = range.startContainer;
    while (node && node !== protyle.wysiwyg?.element) {
        if (node.nodeType === 1) {
            const el = node as HTMLElement;
            if (el.getAttribute("data-node-id") && el.getAttribute("data-type")) {
                return el;
            }
        }
        node = node.parentNode;
    }
    return null;
}
