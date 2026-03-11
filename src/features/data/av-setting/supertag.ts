
import { post } from "../../../shared/api-client/request";
import { getGlobalTypeConfigs } from "./db-config";
import { type TypeConfig } from "./types";
import { showMessage } from "siyuan";
import { formatDate } from "../../../shared/utils";
import { getColIDMap } from "../../../shared/utils/av-utils";

export class SupertagMonitor {
    private typeRegistry: TypeConfig[] = [];
    private lastUpdate = 0;
    private tagCache = new Map<string, Set<string>>();

    private refreshBoundHandler = this.refreshRegistry.bind(this);

    constructor() {
        this.refreshRegistry();
        window.addEventListener("index-plugin-refresh-supertags", this.refreshBoundHandler);
    }

    async refreshRegistry() {
        this.typeRegistry = await getGlobalTypeConfigs();
        this.lastUpdate = Date.now();
        console.log(`[Supertag] Registry refreshed: ${this.typeRegistry.length} types.`, this.typeRegistry);
    }

    private boundHandler = this.handleWsMessage.bind(this);
    private pluginInstance: any = null;

    private prefs: Record<string, string> = {};

    init(plugin: any) {
        this.pluginInstance = plugin;
        if (this.pluginInstance && this.pluginInstance.eventBus) {
            this.pluginInstance.eventBus.on("ws-main", this.boundHandler);
            console.log("[Supertag] Monitor started processing global ws-main events.");

            // Load preferences
            this.pluginInstance.loadData("supertag-prefs.json").then((data: any) => {
                if (data) this.prefs = data;
            }).catch(() => { });
        } else {
            console.error("[Supertag] Failed to start monitor: Plugin eventbus not provided.");
        }
    }

    async setPreferredConfig(typeName: string, avId: string) {
        this.prefs[typeName] = avId;
        if (this.pluginInstance) {
            await this.pluginInstance.saveData("supertag-prefs.json", this.prefs);
        }
    }

    public getPreferredConfig(typeName: string) {
        return this.prefs[typeName];
    }

    destroy() {
        if (this.pluginInstance && this.pluginInstance.eventBus) {
            this.pluginInstance.eventBus.off("ws-main", this.boundHandler);
        }
        window.removeEventListener("index-plugin-refresh-supertags", this.refreshBoundHandler);
    }

    private async handleWsMessage({ detail }: any) {
        if (detail.cmd !== "transactions") return;

        const transactions = detail.data;

        for (const trans of transactions) {
            for (const op of trans.doOperations) {
                // Focus on operations that carry tag info: update (DOM), insert (DOM), setAttrs (JSON string), updateAttrs (Object/JSON)
                if (op.action === "update" || op.action === "insert" || op.action === "setAttrs" || op.action === "updateAttrs") {
                    const blockId = op.id;
                    if (!blockId || !op.data) continue;

                    // Extract all tags currently embedded in the operation payload
                    const newTags = this.extractTagsFromPayload(op.data);

                    // Compare with virtual cache
                    const cachedTags = this.tagCache.get(blockId) || new Set<string>();
                    const addedTags = Array.from(newTags).filter(t => !cachedTags.has(t));

                    if (addedTags.length > 0) {
                        console.log(`[Supertag] Op: ${op.action} on ${blockId}. New tags added:`, addedTags);

                        // Update cache
                        this.tagCache.set(blockId, newTags);

                        // Trigger logic for each newly added tag
                        for (const tag of addedTags) {
                            this.processNewTag(blockId, tag);
                        }
                    } else if (newTags.size !== cachedTags.size) {
                        // Some tags were removed, just update the cache
                        this.tagCache.set(blockId, newTags);
                    }
                }
            }
        }
    }

    private extractTagsFromPayload(payload: any): Set<string> {
        const tags = new Set<string>();
        if (!payload) return tags;

        // Condition 0: payload is an object (common in updateAttrs)
        if (typeof payload === "object") {
            const rawTags = payload.new?.tags || payload.tags; // Expert: updateAttrs uses .new.tags
            if (rawTags && typeof rawTags === "string") {
                // Determine separator: updateAttrs uses comma, setAttrs/DOM uses space
                const sep = rawTags.includes(',') ? ',' : ' ';
                rawTags.split(sep).forEach((t: string) => {
                    const clean = t.trim().replace(/#/g, '');
                    if (clean) tags.add(clean);
                });
            }
            return tags;
        }

        if (typeof payload !== "string") return tags;

        // Condition 1: payload is a JSON string of attributes (action === "setAttrs")
        if (payload.trim().startsWith("{") && payload.trim().endsWith("}")) {
            try {
                const attrs = JSON.parse(payload);
                const rawTags = attrs.new?.tags || attrs.tags;
                if (rawTags && typeof rawTags === "string") {
                    const sep = rawTags.includes(',') ? ',' : ' ';
                    rawTags.split(sep).forEach((t: string) => {
                        const clean = t.trim().replace(/#/g, '');
                        if (clean) tags.add(clean);
                    });
                }
                if (rawTags) return tags; // If we found tags via JSON, don't fallback to regex
            } catch (e) { } // Ignore passive failures
        }

        // Condition 2: payload is DOM HTML (action === "update" | "insert")

        // Match 1: <span data-type="tag">YourTag</span> (This is the actual structure based on SiYuan debug logs)
        const regex1 = /<span[^>]*data-type="tag"[^>]*>([^<]+)<\/span>/ig;
        let tagMatch;
        while ((tagMatch = regex1.exec(payload)) !== null) {
            if (tagMatch[1]) {
                const tagText = tagMatch[1].replace(/#/g, ''); // Strip any # if present
                tags.add(tagText);
            }
        }

        // Match 2: <span data-type="tag" data-content="YourTag"> (Fallback)
        const regex2 = /data-type="[^"]*tag[^"]*"[^>]*data-content="([^"]+)"/ig;
        let contentMatch;
        while ((contentMatch = regex2.exec(payload)) !== null) {
            if (contentMatch[1]) tags.add(contentMatch[1]);
        }

        // Match 3: <span data-type="NodeTag">#YourTag#</span> (Fallback)
        const regex3 = /data-type="NodeTag"[^>]*>#([^<#]+)#<\/span>/ig;
        let matchHash;
        while ((matchHash = regex3.exec(payload)) !== null) {
            if (matchHash[1]) tags.add(matchHash[1]);
        }

        return tags;
    }

    private async processNewTag(blockId: string, tag: string) {
        try {
            // Refresh registry if empty or periodically
            if (this.typeRegistry.length === 0 || Date.now() - this.lastUpdate > 5 * 60 * 1000) {
                await this.refreshRegistry();
            }

            const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

            // Check for matched configs
            let matchedConfigs = this.typeRegistry.filter(c => c.typeName.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() === cleanTag);
            let config = null;

            if (matchedConfigs.length > 0) {
                const pref = this.prefs[cleanTag];
                if (pref) {
                    config = matchedConfigs.find(c => c.avId === pref) || matchedConfigs[0];
                } else {
                    config = matchedConfigs[0];
                }
            }

            if (config) {
                console.log(`[Supertag] ✨ MATCH! Tag "${cleanTag}" matches type "${config.typeName}". Triggering DB sync...`, config);
                await this.applySupertag(blockId, config);
            } else {
                console.log(`[Supertag] ℹ️ Tag "${cleanTag}" (Length: ${cleanTag.length}) ignored. It is not mapped to any Type in the Database settings.`);
            }
        } catch (e) {
            console.error("[Supertag] Failed to process new tag:", blockId, e);
        }
    }

    private async applySupertag(blockId: string, config: TypeConfig) {
        try {
            // 1. Check if block is already in the AV
            const membership = await post("/api/av/getAttributeViewItemIDsByBoundIDs", {
                avID: config.avId,
                blockIDs: [blockId]
            });

            let itemId = membership.data?.[blockId];

            if (!itemId) {
                // 2. Add block to AV if not present
                // @ts-ignore
                itemId = window.Lute.NewNodeID();
                console.log(`[Supertag] Adding block ${blockId} to AV ${config.avId} as item ${itemId}`);

                const insertRes = await post("/api/av/addAttributeViewBlocks", {
                    avID: config.avId,
                    srcs: [{ itemID: itemId, id: blockId, isDetached: false }]
                });
                console.log(`[Supertag] Insert Block Result:`, insertRes);

                // Wait a bit for backend to process
                await new Promise(r => setTimeout(r, 200));
            }

            if (config.typeFieldId && config.mappedValue !== undefined) {
                // 3. Get actual column type
                const { idToType } = await getColIDMap(config.avId);
                const colType = idToType[config.typeFieldId] || "text"; // fallback

                // 4. Set the attribute value
                const valuePayload = this.formatValue(config.mappedValue, colType);

                const updateRes = await post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: config.avId,
                    values: [{
                        keyID: config.typeFieldId,
                        itemID: itemId,
                        value: valuePayload
                    }]
                });
                console.log(`[Supertag] Update Attribute Result:`, updateRes);
            }

            // 4. Force UI refresh for the AV block so the new row shows up immediately
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: config.blockId, data: formatDate(new Date()) }] }] // Sending doUpdateUpdated triggers a refresh
            });

            console.log(`[Supertag] Successfully applied type "${config.typeName}" to block ${blockId}`);
            showMessage(`✨ Supertag: 已自动分类为 "${config.typeName}"`);

        } catch (e) {
            console.error("[Supertag] Failed to apply supertag:", e);
        }
    }

    private formatValue(val: string, colType: string) {
        console.log(`[Supertag] Formatting value "${val}" for column type "${colType}"`);

        if (colType === "number") {
            const numContent = Number(val);
            return {
                type: "number",
                number: { content: isNaN(numContent) ? 0 : numContent, isNotEmpty: true }
            };
        } else if (colType === "text" || colType === "block") {
            return {
                type: "text",
                text: { content: val }
            };
        } else if (colType === "select" || colType === "mSelect") {
            return {
                type: colType,
                mSelect: [{ content: val, color: "" }]
            };
        } else {
            // Best effort generic fallback for other column types
            return {
                type: "mSelect",
                mSelect: [{ content: val, color: "" }]
            };
        }
    }
}

export const supertagMonitor = new SupertagMonitor();
