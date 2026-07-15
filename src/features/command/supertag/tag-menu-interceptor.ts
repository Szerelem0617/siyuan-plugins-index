import { post } from "../../../shared/api-client/request";
import { supertagMonitor } from "./supertag";
import { SUPERTAG_REGISTRY } from "../registration";
import { SupertagRenderer } from "./SupertagRenderer";

// Visual indicator/badge texts to identify supertags in the list
const BADGE_MARKER = "🐬";

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
                    // Gather all registered supertags and classify them
                    const dbConfigs = supertagMonitor.getDataRegistry() || [];
                    const logicConfigs = SUPERTAG_REGISTRY || [];

                    const dataNames = new Set(dbConfigs.map(c => c.typeName.trim().toLowerCase()));
                    const logicNames = new Set(logicConfigs.map(l => l.typeTag.trim().toLowerCase()));

                    const allSupertags = Array.from(new Set([...dataNames, ...logicNames]));
                    const searchKey = (json.data.k || "").trim().toLowerCase();
                    const matchedSupertags = allSupertags.filter(t => t.includes(searchKey));

                    const classItems: string[] = [];
                    const dataItems: string[] = [];
                    const toolItems: string[] = [];

                    matchedSupertags.forEach(tag => {
                        const isData = dataNames.has(tag);
                        const isLogic = logicNames.has(tag);
                        
                        let badgeHtml = "";
                        let itemGroup: string[] = [];
                        if (isData && isLogic) {
                            badgeHtml = `<span style="color: var(--b3-theme-primary); font-weight: bold; margin-left: auto; font-size: 10px;">🐬 类</span>`;
                            itemGroup = classItems;
                        } else if (isData) {
                            badgeHtml = `<span style="color: #4caf50; font-weight: bold; margin-left: auto; font-size: 10px;">🐬 数据组件</span>`;
                            itemGroup = dataItems;
                        } else {
                            badgeHtml = `<span style="color: #ff9800; font-weight: bold; margin-left: auto; font-size: 10px;">🐬 工具组件</span>`;
                            itemGroup = toolItems;
                        }

                        // Siyuan uses HTML directly for list item texts in searchTag lists
                        itemGroup.push(`${tag}<span style="display: flex; align-items: center; width: 100%;">${badgeHtml}</span>`);
                    });

                    // Remove native tag duplicates that are already covered by supertags
                    const nativeItems = json.data.tags.filter((t: string) => {
                        const cleanT = t.replace(/<mark>/g, "").replace(/<\/mark>/g, "").toLowerCase();
                        return !dataNames.has(cleanT) && !logicNames.has(cleanT);
                    });

                    // Prepend supertags grouped by category, followed by native tags
                    json.data.tags = [...classItems, ...dataItems, ...toolItems, ...nativeItems];

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
            if (text.includes(BADGE_MARKER)) {
                // Intercept supertag clicks in the document tag menu
                event.stopPropagation();
                event.preventDefault();

                // Extract the tag name by cutting off at the badge emoji "🐬"
                const emojiIdx = text.indexOf(BADGE_MARKER);
                const tag = emojiIdx > -1 ? text.substring(0, emojiIdx).trim() : text;

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
                        if (text.includes(BADGE_MARKER)) {
                            event.stopPropagation();
                            event.preventDefault();

                            // Extract the tag name by cutting off at the badge emoji "🐬"
                            const emojiIdx = text.indexOf(BADGE_MARKER);
                            const tag = emojiIdx > -1 ? text.substring(0, emojiIdx).trim() : text;

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
