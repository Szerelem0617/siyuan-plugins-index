
import { post } from "../../../shared/api-client/request";
import { client } from "../../../shared/api-client";
import { SUPERTAG_REGISTRY, refreshSupertagRegistry } from "../../command/registration";
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
        await refreshSupertagRegistry();
        this.typeRegistry = await getGlobalTypeConfigs();
        this.lastUpdate = Date.now();
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
                    const newTags = this.extractTagsFromPayload(op.data, op.action);
                    if (newTags === null) continue; // Skip if this operation doesn't carry definitive tag information

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
                    } else {
                        // All tags are already in cache or it's a removal
                        this.tagCache.set(blockId, newTags);
                    }
                }
            }
        }
    }

    private extractTagsFromPayload(payload: any, action?: string): Set<string> | null {
        const tags = new Set<string>();
        if (!payload) return tags;

        // Condition 0: payload is an object (common in updateAttrs)
        if (typeof payload === "object") {
            const hasTagsProp = (payload.new && payload.new.tags !== undefined) || payload.tags !== undefined;
            if (!hasTagsProp) return null; // Authority: No tag info here, don't clear cache

            const rawTags = payload.new?.tags !== undefined ? payload.new.tags : payload.tags;
            if (typeof rawTags === "string") {
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
                // Check if this JSON actually contains attribute data
                const hasTagsProp = (attrs.new && attrs.new.tags !== undefined) || attrs.tags !== undefined;
                if (!hasTagsProp && action === "updateAttrs") return null;

                const rawTags = attrs.new?.tags !== undefined ? attrs.new.tags : attrs.tags;
                if (typeof rawTags === "string") {
                    const sep = rawTags.includes(',') ? ',' : ' ';
                    rawTags.split(sep).forEach((t: string) => {
                        const clean = t.trim().replace(/#/g, '');
                        if (clean) tags.add(clean);
                    });
                }
                if (hasTagsProp) return tags; // If we found (or explicitly didn't find) tags via JSON, return it
            } catch (e) { } // Ignore passive failures
        }

        // Condition 2: payload is DOM HTML (action === "update" | "insert")
        // We only proceed here if it's NOT a recognized JSON but looks like HTML
        if (payload.includes("<") && payload.includes(">")) {
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

        // If it's a string but doesn't look like HTML and doesn't have tag info, return null to avoid clearing cache blindly
        return (action === "updateAttrs" || action === "setAttrs") ? null : tags;
    }

    private async processNewTag(blockId: string, tag: string) {
        try {
            // Refresh registry if empty or periodically
            if (SUPERTAG_REGISTRY.length === 0 || Date.now() - this.lastUpdate > 5 * 60 * 1000) {
                await this.refreshRegistry();
            }

            const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();

            console.log(`[Supertag] Processing tag: "${cleanTag}". Registry size: ${SUPERTAG_REGISTRY.length}`);
            if (SUPERTAG_REGISTRY.length < 10) {
                console.log(`[Supertag] Current Registry Tags:`, SUPERTAG_REGISTRY.map(c => c.typeTag));
            }

            // Check for matched configs with autoSync === true AND valid targetDbId
            let matchedConfigs = SUPERTAG_REGISTRY.filter(c => c.typeTag === cleanTag && c.autoSync && c.targetDbId);

            if (matchedConfigs.length > 0) {
                // If there are multiple mappings for the same tag, just unique the db ids to avoid duplicated inserts
                // Note: If multiple configs point to same DB but different values, we should ideally handle them.
                // For now, we group by targetDbId and take the first config for that DB.
                const dbMap = new Map<string, typeof matchedConfigs[0]>();
                for (const c of matchedConfigs) {
                    if (!dbMap.has(c.targetDbId)) dbMap.set(c.targetDbId, c);
                }

                for (const [dbId, config] of dbMap.entries()) {
                    console.log(`[Supertag] ✨ MATCH! Tag "${cleanTag}" matches Auto-Sync rule. Triggering DB sync for target ${dbId}...`);
                    await this.applySupertag(blockId, cleanTag, config);
                }
                return;
            }

            // Fallback to legacy
            let legacyMatchedConfigs = this.typeRegistry.filter(c => c.typeName.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase() === cleanTag);
            let legacyConfig = null;

            if (legacyMatchedConfigs.length > 0) {
                const pref = this.prefs[cleanTag];
                if (pref) {
                    legacyConfig = legacyMatchedConfigs.find(c => c.avId === pref) || legacyMatchedConfigs[0];
                } else {
                    legacyConfig = legacyMatchedConfigs[0];
                }
            }

            if (legacyConfig) {
                console.log(`[Supertag] ✨ MATCH (Legacy)! Tag "${cleanTag}" matches type "${legacyConfig.typeName}". Triggering DB sync...`, legacyConfig);
                await this.applySupertagLegacy(blockId, legacyConfig);
            } else {
                console.log(`[Supertag] ℹ️ Tag "${cleanTag}" ignored. It is not mapped to any Auto-Sync rule in Type-DB nor legacy DB Config.`);
            }
        } catch (e) {
            console.error("[Supertag] Failed to process new tag:", blockId, e);
        }
    }

    private async applySupertag(blockId: string, cleanTag: string, config: any) {
        try {
            const targetDbId = config.targetDbId;
            let avId = targetDbId;
            // Test if targetDbId is actually a list block
            const linkTest = await post("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE id = '${targetDbId}' AND type = 'l' LIMIT 1` });
            if (linkTest && linkTest.length > 0) {
                const attrsRes = await client.getBlockAttrs({ id: targetDbId });
                avId = (attrsRes.data || {})["custom-index-linked-av"] || avId;
            }

            // 1. Get current state of the AV
            const { blockToItem, idToType } = await getColIDMap(avId);
            let itemId = blockToItem.get(blockId);

            if (!itemId) {
                // 2. Add block to AV if not present
                // @ts-ignore
                itemId = window.Lute.NewNodeID();
                console.log(`[Supertag] Adding block ${blockId} to AV ${avId} as item ${itemId}`);

                const insertRes = await post("/api/av/addAttributeViewBlocks", {
                    avID: avId,
                    srcs: [{ itemID: itemId, id: blockId, isDetached: false }]
                });
                console.log(`[Supertag] Insert Block Result:`, insertRes);

                // Reduced delay to minimize performance impact
                await new Promise(r => setTimeout(r, 50));
            } else {
                console.log(`[Supertag] Block ${blockId} already exists in AV ${avId} as item ${itemId}.`);
            }

            // 3. Set specific attribute value if multi-mode
            if (config.typeFieldId && config.mappedValue !== undefined) {
                const colType = idToType[config.typeFieldId] || "text";
                const valuePayload = this.formatValue(String(config.mappedValue).trim(), colType);

                console.log(`[Supertag] Setting attribute value (Type: ${colType}) via Batch API. Payload:`, valuePayload);
                const setRes = await post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: avId,
                    values: [{
                        keyID: config.typeFieldId,
                        itemID: itemId,
                        value: valuePayload
                    }]
                });
                console.log(`[Supertag] Batch Set Result:`, setRes);
            }

            // 5. Force UI refresh for the original block 
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: blockId, data: formatDate(new Date()) }] }]
            });

            console.log(`[Supertag] Successfully applied auto-sync for "${cleanTag}" to block ${blockId}`);
            showMessage(`✨ Supertag: 已自动同步至 "${cleanTag}" 数据组件`);

        } catch (e) {
            console.error("[Supertag] Failed to apply supertag:", e);
        }
    }

    private async applySupertagLegacy(blockId: string, config: TypeConfig) {
        try {
            // 1. Get current state of the AV
            const { blockToItem, keyValues, idToType } = await getColIDMap(config.avId);
            let itemId = blockToItem.get(blockId);

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
            } else {
                // 3. IDEMPOTENCY: Check if the value is already set correctly
                if (config.typeFieldId && config.mappedValue !== undefined) {
                    const colKV = keyValues.find(kv => kv.key.id === config.typeFieldId);
                    if (colKV && colKV.values) {
                        const cell = colKV.values.find((v: any) => (v.itemID || v.itemId || v.id) === itemId);
                        if (cell) {
                            const currentVal = (cell.mSelect?.[0]?.content || cell.text?.content || cell.number?.content || cell.content || "").toString();
                            if (currentVal === config.mappedValue.toString()) {
                                console.log(`[Supertag] Block ${blockId} already correctly categorized in ${config.avId}. Skipping.`);
                                return;
                            }
                        }
                    }
                }
            }

            if (config.typeFieldId && config.mappedValue !== undefined) {
                // 4. Set the attribute value
                const colType = idToType[config.typeFieldId] || "text";
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

            // 5. Force UI refresh for the AV block so the new row shows up immediately
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: config.blockId, data: formatDate(new Date()) }] }]
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
