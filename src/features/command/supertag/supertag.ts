import { post } from "../../../shared/api-client/request";
import { SUPERTAG_REGISTRY, refreshSupertagRegistry, COMMAND_REGISTRY, getTypeAvId } from "../registration";
import { getGlobalTypeConfigs } from "../../data/av-setting/db-config";
import { type TypeConfig } from "../../data/av-setting/types";
import { showMessage } from "siyuan";
import { formatDate } from "../../../shared/utils";
import { getColIDMap } from "../../../shared/utils/av-utils";
import { tableSyncTimes, instantiateAV, getSqliteEngine } from "../../sqlite/sqlite-manager";
import { dispatchCommand } from "../command-dispatcher";
import { SupertagRenderer } from "./SupertagRenderer";

export interface TriggerRule {
    event: string;
    condition: string;
    commands: string[];
}

export function parseConditionalString(text: string): TriggerRule[] {
    const rules: TriggerRule[] = [];
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    
    for (const line of lines) {
        const match = line.match(/^\[([^\]]+)\](?:\(([^\)]+)\))?\s*->\s*(.+)$/);
        if (match) {
            const rawEvent = match[1].trim();
            const condition = match[2] ? match[2].trim() : "";
            const cmdsText = match[3].trim();
            
            let event = "tag_created";
            if (rawEvent === "打上标签时" || rawEvent === "tag_created") {
                event = "tag_created";
            } else if (rawEvent === "移除标签时" || rawEvent === "tag_removed") {
                event = "tag_removed";
            } else if (rawEvent === "内容变动时" || rawEvent === "block_content_changed") {
                event = "block_content_changed";
            } else if (rawEvent === "属性变动时" || rawEvent === "block_attribute_changed") {
                event = "block_attribute_changed";
            } else {
                event = rawEvent;
            }
            
            const commands = cmdsText.split(/[,，]/).map(c => c.trim()).filter(Boolean);
            rules.push({ event, condition, commands });
        } else {
            // Fallback for legacy comma-separated lists
            const commands = line.split(/[,，]/).map(c => c.trim()).filter(Boolean);
            if (commands.length > 0) {
                rules.push({
                    event: "tag_created",
                    condition: "",
                    commands
                });
            }
        }
    }
    return rules;
}

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

    public getDataRegistry(): TypeConfig[] {
        return this.dataRegistry;
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
        console.log("[Supertag-Debug] ws-main raw detail:", detail?.cmd, JSON.stringify(detail?.data || {}));
        if (detail.cmd !== "transactions") return;

        const transactions = detail.data;
        for (const trans of transactions) {
            for (const op of trans.doOperations) {
                console.log("[Supertag-Debug] doOperation:", op.action, op.id, typeof op.data);
                // Focus on operations that carry tag info: update (DOM), insert (DOM), setAttrs (JSON string), updateAttrs (Object/JSON)
                if (op.action === "update" || op.action === "insert" || op.action === "setAttrs" || op.action === "updateAttrs") {
                    const blockId = op.id;
                    if (!blockId || !op.data) continue;

                    // If it is a DOM update/insert, intercept and migrate native tags
                    if (op.action === "update" || op.action === "insert") {
                        await this.detectAndMigrateNativeTags(blockId, op.data);
                    }

                    // Extract all tags currently embedded in the operation payload
                    const newTags = this.extractTagsFromPayload(op.data, op.action, blockId);
                    if (newTags === null) continue; // Skip if this operation doesn't carry definitive tag information

                    // Compare with virtual cache
                    const cachedTags = this.tagCache.get(blockId) || new Set<string>();
                    const addedTags = Array.from(newTags).filter(t => !cachedTags.has(t));
                    const removedTags = Array.from(cachedTags).filter(t => !newTags.has(t));

                    if (addedTags.length > 0 || removedTags.length > 0) {
                        // Update cache
                        this.tagCache.set(blockId, newTags);

                        // Trigger logic for each newly added tag
                        for (const tag of addedTags) {
                            await this.processNewTag(blockId, tag);
                        }

                        // Trigger logic for each removed tag
                        for (const tag of removedTags) {
                            await this.processRemovedTag(blockId, tag);
                        }
                    } else {
                        // All tags are already in cache
                        this.tagCache.set(blockId, newTags);
                    }
                }
            }
        }
    }

    private async detectAndMigrateNativeTags(blockId: string, payload: any) {
        console.log("[Supertag-Migration-Debug] Entered detectAndMigrateNativeTags for block:", blockId);
        if (!payload || typeof payload !== "string") {
            console.log("[Supertag-Migration-Debug] Exit: payload is empty or not string");
            return;
        }
        if (!payload.includes('data-type="tag"') && !payload.includes('data-type="NodeTag"')) {
            console.log("[Supertag-Migration-Debug] Exit: payload does not contain tag markup");
            return;
        }

        try {
            // Query all registered supertags from SQLite sys_type_db
            const { db } = await getSqliteEngine();
            const res = db.exec(`SELECT supertag FROM sys_type_db`);
            console.log("[Supertag-Migration-Debug] sys_type_db query result:", JSON.stringify(res));
            if (res.length === 0 || res[0].values.length === 0) {
                console.log("[Supertag-Migration-Debug] Exit: no supertags found in sys_type_db");
                return;
            }

            const supertags = new Set(
                res[0].values.map((row: any) => 
                    String(row[0]).replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase()
                ).filter(Boolean)
            );
            console.log("[Supertag-Migration-Debug] Active supertags set:", Array.from(supertags));

            // Parse HTML to find matching tags
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = payload;
            const tagEls = tempDiv.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
            console.log("[Supertag-Migration-Debug] Found tag elements count:", tagEls.length);
            
            const tagsToMigrate: string[] = [];
            tagEls.forEach((el: any) => {
                const tagText = (el.textContent || el.getAttribute("data-content") || "")
                    .replace(/#/g, '')
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim()
                    .toLowerCase();
                console.log("[Supertag-Migration-Debug] Checking tag text content:", tagText);
                if (supertags.has(tagText)) {
                    tagsToMigrate.push(tagText);
                    el.remove();
                }
            });

            if (tagsToMigrate.length === 0) {
                console.log("[Supertag-Migration-Debug] Exit: none of the tags are registered supertags");
                return;
            }

            console.log(`[Supertag-Migration] Intercepted native tags to migrate on block ${blockId}:`, tagsToMigrate);

            // Get current custom-supertags
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes || {};
            const rawTags = attrs["custom-supertags"];
            let currentCustom: string[] = [];
            if (rawTags) {
                try {
                    const parsed = JSON.parse(rawTags);
                    if (Array.isArray(parsed)) currentCustom = parsed;
                } catch (_) {}
            }

            // Add newly migrated tags
            const updatedCustom = Array.from(new Set([...currentCustom, ...tagsToMigrate]));

            // Set the custom-supertags attribute directly on the DOM wrapper div inside tempDiv
            const blockDiv = tempDiv.firstElementChild as HTMLElement;
            if (blockDiv) {
                blockDiv.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
            }

            // Update block attributes first
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-supertags": JSON.stringify(updatedCustom)
                }
            });

            // Update block content to strip the text tags
            const cleanDOM = tempDiv.innerHTML.trim();
            await post("/api/block/updateBlock", {
                id: blockId,
                dataType: "dom",
                data: cleanDOM
            });

            // Trigger visual rendering with a slight delay to allow editor async DOM replacement to settle
            const activeProtyle = (window as any).siyuan?.ws?.protyle;
            if (activeProtyle) {
                setTimeout(() => {
                    const blockEl = activeProtyle.element.querySelector(`[data-node-id="${blockId}"]`);
                    if (blockEl) {
                        blockEl.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
                        // Remove the text tags from editor DOM visually
                        const editorTagEls = blockEl.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
                        editorTagEls.forEach((el: any) => {
                            const text = (el.textContent || "").replace(/#/g, '').trim().toLowerCase();
                            if (supertags.has(text)) el.remove();
                        });
                    }
                    SupertagRenderer.render(activeProtyle);
                }, 80);
            }
        } catch (err) {
            console.error("[Supertag-Migration] Error during native tag auto migration:", err);
        }
    }

    private extractTagsFromPayload(payload: any, action?: string, opId?: string): Set<string> | null {
        if (!payload) return new Set<string>();

        // 1. Try extracting from HTML DOM payload (actions: update, insert)
        if (typeof payload === "string" && payload.includes("<") && payload.includes(">")) {
            const match = payload.match(/custom-supertags="([^"]+)"/);
            if (match) {
                const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                const tags = new Set<string>();
                try {
                    const parsed = JSON.parse(decoded);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((t: any) => {
                            const clean = String(t || "").trim();
                            if (clean) tags.add(clean);
                        });
                    }
                } catch (_) {}
                return tags;
            }
            // If DOM doesn't have custom-supertags attribute, we treat it as empty set of tags
            return new Set<string>();
        }

        // 2. Try extracting from JSON object or string (actions: setAttrs, updateAttrs)
        let attrs: any = null;
        if (typeof payload === "object") {
            attrs = payload.new || payload;
        } else if (typeof payload === "string" && payload.trim().startsWith("{")) {
            try {
                attrs = JSON.parse(payload);
                if (attrs.new) attrs = attrs.new;
            } catch (_) {}
        }

        if (attrs && attrs["custom-supertags"] !== undefined) {
            const rawVal = attrs["custom-supertags"];
            const tags = new Set<string>();
            if (rawVal) {
                try {
                    const parsed = JSON.parse(rawVal);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((t: any) => {
                            const clean = String(t || "").trim();
                            if (clean) tags.add(clean);
                        });
                    }
                } catch (_) {
                    // Fallback
                    const sep = rawVal.includes(',') ? ',' : ' ';
                    rawVal.split(sep).forEach((t: string) => {
                        const clean = t.trim().replace(/#/g, '');
                        if (clean) tags.add(clean);
                    });
                }
            }
            return tags;
        }

        // Also check legacy "tags" or "tag" in case we want to support fallback (optional, let's keep only custom-supertags for clean take over)
        return null; // Signifies "no custom-supertags updates in this transaction"
    }

    private async processNewTag(blockId: string, tag: string) {
        try {
            // Refresh registry if empty or periodically
            if (SUPERTAG_REGISTRY.length === 0 || Date.now() - this.lastUpdate > 5 * 60 * 1000) {
                await this.refreshRegistry();
            }

            const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();

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
            }

            // --- Path C: Execute Trigger Commands (Layer 3 trigger) ---
            await this.triggerConditionalCommands(blockId, cleanTag, "tag_created");
        } catch (e) {
            console.error("[Supertag] Failed to process new tag:", blockId, e);
        }
    }

    private async processRemovedTag(blockId: string, tag: string) {
        try {
            const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
            
            // Trigger tag_removed commands
            await this.triggerConditionalCommands(blockId, cleanTag, "tag_removed");
        } catch (e) {
            console.error("[Supertag] Failed to process removed tag:", blockId, e);
        }
    }

    private async triggerConditionalCommands(blockId: string, cleanTag: string, eventName: "tag_created" | "tag_removed") {
        const typeAvId = getTypeAvId();
        if (!typeAvId) return;

        try {
            const tableName = `av_${typeAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const { db } = await getSqliteEngine();
            
            // Find primary key column name (usually block type)
            const schemaCols = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [typeAvId]);
            let supertagColName = "supertag";
            if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
                supertagColName = String(schemaCols[0].values[0][0]);
            }

            // Find Conditional trigger column name
            const schemaConditional = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Conditional' OR key_name = '触发器' OR key_name = 'On Create' OR key_name = '创建时')`, [typeAvId]);
            let conditionalColName = "Conditional";
            if (schemaConditional.length > 0 && schemaConditional[0].values.length > 0) {
                conditionalColName = String(schemaConditional[0].values[0][0]);
            }

            const typeDbRes = db.exec(`SELECT "${conditionalColName}" FROM ${tableName} WHERE LOWER("${supertagColName}") = '#${cleanTag}' OR LOWER("${supertagColName}") = '${cleanTag}'`);

            if (typeDbRes && typeDbRes.length > 0 && typeDbRes[0].values.length > 0) {
                const conditionalVal = typeDbRes[0].values[0][0];
                if (conditionalVal) {
                    const rules = parseConditionalString(String(conditionalVal));
                    const targetRule = rules.find(r => r.event === eventName);

                    if (targetRule && targetRule.commands.length > 0) {
                        let conditionMet = true;
                        if (targetRule.condition) {
                            console.log(`[Supertag-Trigger] Evaluating condition: ${targetRule.condition}`);
                            // Extensible condition checks go here
                        }

                        if (conditionMet) {
                            console.log(`[Supertag-Trigger] Condition met. Executing commands for tag #${cleanTag} on event ${eventName}:`, targetRule.commands);

                            // Execute sequentially in order
                            for (const cmdLabel of targetRule.commands) {
                                const cmdInfo = COMMAND_REGISTRY[cmdLabel];
                                const commandRef = cmdInfo?.commandRef || cmdLabel;
                                const paramMapping = cmdInfo?.paramMapping || "";

                                console.log(`[Supertag-Trigger] Dispatching command: "${cmdLabel}" (ID: ${commandRef}) on block ${blockId}`);

                                const doc = document;
                                const blockEl = doc.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement || doc.createElement("div");
                                if (blockEl && !blockEl.getAttribute("data-node-id")) {
                                    blockEl.setAttribute("data-node-id", blockId);
                                }

                                const protyle = (window as any).siyuan?.ws?.protyle || null;
                                const context = {
                                    blockEl,
                                    protyleEl: protyle?.element || null,
                                    protyle,
                                    supertag: cleanTag
                                };

                                try {
                                    await dispatchCommand(commandRef, paramMapping, context);
                                } catch (cmdErr) {
                                    console.error(`[Supertag-Trigger] Failed to dispatch command: ${cmdLabel}`, cmdErr);
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[Supertag-Trigger] Error triggering ${eventName} commands:`, e);
        }
    }

    private async applySupertag(blockId: string, cleanTag: string, config: TypeConfig) {
        try {
            const avId = config.avId;
            console.log(`[Supertag-Debug] Applying supertag: "${cleanTag}" for block "${blockId}". Database: "${config.avName}" (${avId})`);

            // 1. Get current state of the AV
            const { blockToItem, idToType, keyValues } = await getColIDMap(avId);
            let itemId = blockToItem.get(blockId);
            console.log(`[Supertag-Debug] Current block to item mapping: "${itemId || 'not found'}"`);

            if (!itemId) {
                // 2. Add block to AV if not present
                // @ts-ignore
                itemId = window.Lute.NewNodeID();
                console.log(`[Supertag-Debug] Block not in database. Generating new itemId: "${itemId}" and adding block...`);

                const addRes = await post("/api/av/addAttributeViewBlocks", {
                    avID: avId,
                    srcs: [{ itemID: itemId, id: blockId, isDetached: false }]
                });
                console.log(`[Supertag-Debug] addAttributeViewBlocks response:`, JSON.stringify(addRes));

                // Wait 300ms for Siyuan to complete disk/memory write transaction for new row
                await new Promise(r => setTimeout(r, 300));
            } else {
                // 3. IDEMPOTENCY check
                if (config.typeFieldId && config.mappedValue !== undefined) {
                    const colKV = keyValues.find(kv => kv.key.id === config.typeFieldId);
                    if (colKV && colKV.values) {
                        const cell = colKV.values.find((v: any) => (v.itemID || v.itemId || v.id) === itemId);
                        if (cell) {
                            const currentVal = (cell.mSelect?.[0]?.content || cell.text?.content || cell.number?.content || cell.content || "").toString();
                            console.log(`[Supertag-Debug] Idempotency check. Column: "${colKV.key.name}", expected: "${config.mappedValue}", current: "${currentVal}"`);
                            if (currentVal === config.mappedValue.toString()) {
                                console.log(`[Supertag-Debug] Value matches expected. Skipping update.`);
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
                console.log(`[Supertag-Debug] Setting column ${config.typeFieldId} (type: ${colType}) to value:`, JSON.stringify(valuePayload));

                const setRes = await post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: avId,
                    values: [{
                        keyID: config.typeFieldId,
                        itemID: itemId,
                        value: valuePayload
                    }]
                });
                console.log(`[Supertag-Debug] batchSetAttributeViewBlockAttrs response:`, JSON.stringify(setRes));
            }

            // Clear SQLite cache and force sync to SQLite in-memory DB immediately
            tableSyncTimes.delete(avId);
            console.log(`[Supertag-Debug] Cleared SQLite sync cache for AV: "${avId}". Force-synchronizing AV to SQLite...`);
            await instantiateAV(avId, true);
            console.log(`[Supertag-Debug] SQLite synchronization complete.`);

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
