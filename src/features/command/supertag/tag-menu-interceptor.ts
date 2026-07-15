import { post } from "../../../shared/api-client/request";
import { supertagMonitor } from "./supertag";
import { SUPERTAG_REGISTRY } from "../registration";
import { SupertagRenderer } from "./SupertagRenderer";

// Visual indicator/badge text to identify supertags in the list
const BADGE_TEXT = "🐬 超级标签";
const BADGE_HTML = `<span style="color: var(--b3-theme-primary); font-weight: bold; margin-left: auto; font-size: 10px; display: inline-flex; align-items: center; gap: 2px;">🐬 <span style="opacity: 0.8;">超级标签</span></span>`;

async function addDocumentSupertag(docId: string, tag: string, protyle: any) {
    // 1. Close Siyuan's menu popover
    window.siyuan.menus.menu?.remove();

    // 2. Fetch current page attributes
    const attrsRes = await post("/api/attr/getBlockAttrs", { id: docId });
    const attrs = attrsRes || {};
    const rawTags = attrs["custom-supertags"];
    
    let currentCustom: string[] = [];
    if (rawTags) {
        try {
            const parsed = JSON.parse(rawTags);
            if (Array.isArray(parsed)) currentCustom = parsed;
        } catch (_) {}
    }
    const updatedCustom = Array.from(new Set([...currentCustom, tag]));
    const updatedCustomJSON = JSON.stringify(updatedCustom);

    // 3. Save attributes
    await post("/api/attr/setBlockAttrs", {
        id: docId,
        attrs: {
            "custom-supertags": updatedCustomJSON
        }
    });

    // 4. Process trigger rules and render pills
    await supertagMonitor.processNewTag(docId, tag);
    SupertagRenderer.render(protyle);
}

export function initTagMenuInterceptor() {
    // --- 1. Network Level Interception ---
    // Monkey-patch window.fetch to inject our supertags into Siyuan's searchTag API responses
    const originalFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === "string" ? input : (input as any).url || "";
        
        if (url.includes("/api/search/searchTag")) {
            const response = await originalFetch.call(this, input, init);
            const clone = response.clone();
            try {
                const json = await clone.json();
                if (json && json.data && Array.isArray(json.data.tags)) {
                    // Gather all registered supertags
                    const supertags = new Set<string>();
                    
                    const dbConfigs = supertagMonitor.getDataRegistry();
                    if (dbConfigs) {
                        dbConfigs.forEach(c => {
                            if (c.typeName) supertags.add(c.typeName.trim().toLowerCase());
                        });
                    }

                    if (SUPERTAG_REGISTRY) {
                        SUPERTAG_REGISTRY.forEach(l => {
                            if (l.typeTag) supertags.add(l.typeTag.trim().toLowerCase());
                        });
                    }

                    const searchKey = (json.data.k || "").trim().toLowerCase();
                    const matchedSupertags = Array.from(supertags).filter(t => t.includes(searchKey));

                    // Format supertags with the custom badge
                    const supertagItems = matchedSupertags.map(tag => {
                        // Siyuan uses HTML directly for list item texts in searchTag lists
                        return `${tag}${BADGE_HTML}`;
                    });

                    // Remove native tag duplicates that are already covered by supertags
                    const nativeItems = json.data.tags.filter((t: string) => {
                        const cleanT = t.replace(/<mark>/g, "").replace(/<\/mark>/g, "").toLowerCase();
                        return !supertags.has(cleanT);
                    });

                    // Prepend supertags to Siyuan's native recommendations
                    json.data.tags = [...supertagItems, ...nativeItems];

                    // Return mock Response containing the merged list
                    return new Response(JSON.stringify(json), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }
            } catch (e) {
                console.error("[TagMenuInterceptor] Interception failed:", e);
            }
            return response;
        }

        return originalFetch.call(this, input, init);
    };

    // --- 2. Selection Interception (Click) ---
    document.body.addEventListener("click", async (event: MouseEvent) => {
        const listItem = (event.target as HTMLElement).closest(".b3-list-item");
        if (listItem) {
            const text = listItem.textContent.trim();
            if (text.endsWith(BADGE_TEXT)) {
                // Intercept supertag clicks in the document tag menu
                event.stopPropagation();
                event.preventDefault();

                const tag = text.substring(0, text.length - BADGE_TEXT.length).trim();
                const protyle = (window as any).activeProtyleInstance;
                if (protyle) {
                    const docId = protyle.block?.id || protyle.blockId;
                    if (docId) {
                        await addDocumentSupertag(docId, tag, protyle);
                    }
                }
            }
        }
    }, true); // Capturing phase to run before Siyuan's event handlers

    // --- 3. Selection Interception (Enter Key) ---
    document.body.addEventListener("keydown", async (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            const target = event.target as HTMLInputElement;
            if (target && target.classList.contains("b3-text-field") && target.placeholder === window.siyuan.languages.tag) {
                const menu = target.closest(".b3-menu");
                if (menu) {
                    const focusEl = menu.querySelector(".b3-list-item--focus");
                    if (focusEl) {
                        const text = focusEl.textContent.trim();
                        if (text.endsWith(BADGE_TEXT)) {
                            event.stopPropagation();
                            event.preventDefault();

                            const tag = text.substring(0, text.length - BADGE_TEXT.length).trim();
                            const protyle = (window as any).activeProtyleInstance;
                            if (protyle) {
                                const docId = protyle.block?.id || protyle.blockId;
                                if (docId) {
                                    await addDocumentSupertag(docId, tag, protyle);
                                }
                            }
                        }
                    }
                }
            }
        }
    }, true); // Capturing phase
}
