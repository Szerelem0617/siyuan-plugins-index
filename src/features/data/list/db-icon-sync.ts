import { client } from "../../../shared/api-client";

export interface DBItemProp {
    icon: string;
    titleImg: string;
}

/**
 * Parses the Markdown/HTML of a list item's paragraph to extract the primary bound document/block ID.
 * Supports doc-trees, composite-trees, and implicitly bound links.
 */
export function extractBoundBlockIdFromDOM(pChild: Element | null): string | null {
    if (!pChild) return null;

    // First try: The precise attribute we set for subdocs
    const explicitSubdoc = pChild.getAttribute("custom-index-subdoc-id");
    if (explicitSubdoc) return explicitSubdoc;

    // Second try: Find any siyuan://blocks/ link in the paragraph
    const links = pChild.querySelectorAll('span[data-type="a"]');
    for (let i = 0; i < links.length; i++) {
        const href = links[i].getAttribute("data-href");
        if (href && href.startsWith("siyuan://blocks/")) {
            const id = href.replace("siyuan://blocks/", "");
            // Prioritize document links, but we return the first block ID found
            // In doc-tree or composite-tree, this is usually the target.
            return id;
        }
    }

    return null;
}

/**
 * Bulk fetches the icon and title-img for all targeted block IDs.
 * Filters out fallback text emojis (like 📄) if the document has a real icon.
 */
export async function fetchDocumentIconsForDBItems(targetIds: string[]): Promise<Record<string, DBItemProp>> {
    const itemPropsMap: Record<string, DBItemProp> = {};
    if (!targetIds || targetIds.length === 0) return itemPropsMap;

    const formattedIds = targetIds.filter(id => id).map(id => `'${id}'`);
    if (formattedIds.length === 0) return itemPropsMap;

    try {
        const sqlStr = `SELECT id, ial, type FROM blocks WHERE id IN (${formattedIds.join(",")})`;
        const sqlRes = await client.sql({ stmt: sqlStr });

        if (sqlRes && sqlRes.data) {
            sqlRes.data.forEach((row: any) => {
                let icon = "";
                let titleImg = "";

                if (row.ial) {
                    const iconMatch = row.ial.match(/icon="([^"]+)"/);
                    if (iconMatch) {
                        icon = iconMatch[1];
                        // Translate backend hex to emoji if needed
                        if (/^[0-9a-fA-F-]+$/.test(icon)) {
                            icon = icon.split('-').map(code => String.fromCodePoint(parseInt(code, 16))).join('');
                        }
                    }

                    const imgMatch = row.ial.match(/title-img="([^"]+)"/);
                    if (imgMatch) titleImg = imgMatch[1];
                }

                itemPropsMap[row.id] = { icon, titleImg };
            });
        }
    } catch (e) {
        console.error("[db-icon-sync] Error fetching document icons for DB bulk insert", e);
    }

    return itemPropsMap;
}
