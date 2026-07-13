import { post } from "../../../shared/api-client/request";
import { SUPERTAG_REGISTRY, refreshSupertagRegistry } from "../../command/registration";
import { getGlobalTypeConfigs } from "./db-config";
import { type TypeConfig } from "./types";
import { showMessage } from "siyuan";
import { formatDate } from "../../../shared/utils";
import { getColIDMap } from "../../../shared/utils/av-utils";

export class SupertagMonitor {
    private dataRegistry: TypeConfig[] = [];
    private lastUpdate = 0;
    private tagCache = new Map<string, Set<string>>();

    private refreshBoundHandler = this.refreshRegistry.bind(this);

    constructor() {
        window.addEventListener("index-plugin-refresh-supertags", this.refreshBoundHandler);
    }

    async refreshRegistry() {
        // 1. Refresh Logic Registry (Layer 3)
        await refreshSupertagRegistry();

        // 2. Refresh Data Component Registry (Layer 4 - Scanning individual DBs)
        this.dataRegistry = await getGlobalTypeConfigs();

        this.lastUpdate = Date.now();
    }

    private boundHandler = this.handleWsMessage.bind(this);
    private pluginInstance: any = null;

    private prefs: Record<string, string> = {};

    init(plugin: any) {
        this.pluginInstance = plugin;
        if (this.pluginInstance && this.pluginInstance.eventBus) {
            this.pluginInstance.eventBus.on("ws-main", this.boundHandler);

            // Load preferences
            this.pluginInstance.loadData("supertag-prefs.json").then((data: any) => {
                if (data) this.prefs = data;
            }).catch(() => { });

            // Refresh registry once on initialization
            this.refreshRegistry().catch(e => {
                console.error("[Supertag] Failed to refresh registry during init:", e);
            });
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
                    const newTags = this.extractTagsFromPayload(op.data, op.action, blockId);
                    if (newTags === null) continue; // Skip if this operation doesn't carry definitive tag information

                    console.log(`[SupertagMonitor-Debug] Parsed tags for block ${blockId}:`, Array.from(newTags));

                    // Compare with virtual cache
                    const cachedTags = this.tagCache.get(blockId) || new Set<string>();
                    const addedTags = Array.from(newTags).filter(t => !cachedTags.has(t));

                    if (addedTags.length > 0) {
                        console.log(`[SupertagMonitor-Debug] Detected newly added tags:`, addedTags);
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

    private extractTagsFromPayload(payload: any, action?: string, opId?: string): Set<string> | null {
        const tags = new Set<string>();
        if (!payload) return tags;

        // Condition 0: payload is an object (common in updateAttrs)
        if (typeof payload === "object") {
            const hasTagsProp = 
                (payload.new && (payload.new.tags !== undefined || payload.new.tag !== undefined)) || 
                payload.tags !== undefined || 
                payload.tag !== undefined;
            if (!hasTagsProp) return null; // Authority: No tag info here, don't clear cache

            const rawTags = payload.new?.tags !== undefined ? payload.new.tags :
                            (payload.new?.tag !== undefined ? payload.new.tag :
                            (payload.tags !== undefined ? payload.tags : payload.tag));
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
                const hasTagsProp = 
                    (attrs.new && (attrs.new.tags !== undefined || attrs.new.tag !== undefined)) || 
                    attrs.tags !== undefined || 
                    attrs.tag !== undefined;
                if (!hasTagsProp && action === "updateAttrs") return null;

                const rawTags = attrs.new?.tags !== undefined ? attrs.new.tags :
                                (attrs.new?.tag !== undefined ? attrs.new.tag :
                                (attrs.tags !== undefined ? attrs.tags : attrs.tag));
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
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = payload;

            // Find all tag elements
            const tagEls = tempDiv.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
            tagEls.forEach((el: any) => {
                // Check if this tag is inside a nested block (descendant element with data-node-id different from opId)
                let isNested = false;
                let parent = el.parentElement;
                while (parent && parent !== tempDiv) {
                    const nodeId = parent.getAttribute("data-node-id");
                    if (nodeId && nodeId !== opId) {
                        isNested = true;
                        break;
                    }
                    parent = parent.parentElement;
                }

                if (!isNested) {
                    let tagText = "";
                    if (el.getAttribute("data-type") === "NodeTag") {
                        tagText = el.textContent || "";
                    } else {
                        tagText = el.textContent || el.getAttribute("data-content") || "";
                    }
                    const clean = tagText.replace(/#/g, '').trim();
                    if (clean) {
                        tags.add(clean);
                    }
                }
            });

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

            if (SUPERTAG_REGISTRY.length < 10) {
                // Logic routing implementation
            }

            // --- Path A: Logic Routing (Layer 3) ---
            const logicMatches = SUPERTAG_REGISTRY.filter(c => c.typeTag === cleanTag);
            if (logicMatches.length > 0) {
                // Logic routing implementation (not strictly syncing to DB, just running commands)
                // In a future step, we might trigger the actual command bus here.
                // For now, logic is mainly represented by its presence in the registry.
            }

            // --- Path B: Data Component Persistence (Layer 4) ---
            const dataMatches = this.dataRegistry.filter(c =>
                c.typeName.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase() === cleanTag
            );

            if (dataMatches.length > 0) {
                let targetConfig = dataMatches[0];

                // If ambiguity exists, resolve via User Preferences
                if (dataMatches.length > 1) {
                    const prefAvId = this.prefs[cleanTag];
                    if (prefAvId) {
                        targetConfig = dataMatches.find(c => c.avId === prefAvId) || targetConfig;
                    }
                }

                await this.applySupertag(blockId, cleanTag, targetConfig);
            } else {
            }
        } catch (e) {
            console.error("[Supertag] Failed to process new tag:", blockId, e);
        }
    }

    private async applySupertag(blockId: string, cleanTag: string, config: TypeConfig) {
        try {
            const avId = config.avId;

            // 1. Get current state of the AV
            const { blockToItem, idToType, keyValues } = await getColIDMap(avId);
            let itemId = blockToItem.get(blockId);

            if (!itemId) {
                // 2. Add block to AV if not present
                // @ts-ignore
                itemId = window.Lute.NewNodeID();

                await post("/api/av/addAttributeViewBlocks", {
                    avID: avId,
                    srcs: [{ itemID: itemId, id: blockId, isDetached: false }]
                });

                // Wait a bit for backend to process
                await new Promise(r => setTimeout(r, 100));
            } else {
                // 3. IDEMPOTENCY check
                if (config.typeFieldId && config.mappedValue !== undefined) {
                    const colKV = keyValues.find(kv => kv.key.id === config.typeFieldId);
                    if (colKV && colKV.values) {
                        const cell = colKV.values.find((v: any) => (v.itemID || v.itemId || v.id) === itemId);
                        if (cell) {
                            const currentVal = (cell.mSelect?.[0]?.content || cell.text?.content || cell.number?.content || cell.content || "").toString();
                            if (currentVal === config.mappedValue.toString()) {
                                return;
                            }
                        }
                    }
                }
            }

            // 4. Set specific attribute value
            if (config.typeFieldId && config.mappedValue !== undefined) {
                const colType = idToType[config.typeFieldId] || "text";
                const valuePayload = this.formatValue(String(config.mappedValue).trim(), colType);

                await post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: avId,
                    values: [{
                        keyID: config.typeFieldId,
                        itemID: itemId,
                        value: valuePayload
                    }]
                });
            }

            // 5. Force UI refresh
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: blockId, data: formatDate(new Date()) }] }]
            });

            showMessage(`✨ Supertag: 已自动同步至 "${config.avName || cleanTag}"`);

        } catch (e) {
            console.error("[Supertag] Failed to apply data sync:", e);
        }
    }


    private formatValue(val: string, colType: string) {

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
