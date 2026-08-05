/**
 * supertag-listener.ts
 *
 * WebSocket 消息监听、原生标签自动迁移与事件防抖队列核心管理器 (SupertagMonitor)
 */

import { post } from "../../../../shared/api-client/request";
import { SUPERTAG_REGISTRY, globalSupertagsCache } from "../../registration";
import { getGlobalTypeConfigs } from "../../../av/av-setting/db-config";
import { type TypeConfig } from "../../../av/av-setting/types";
import { parseSupertags, diffSupertags, cleanTagString, tagCache } from "./supertag-diff";
import { supertagBinder } from "./supertag-binder";
import { triggerConditionalCommands } from "./supertag-trigger";
import { SupertagRenderer } from "../renderer/SupertagRenderer";

export class SupertagMonitor {
    private dataRegistry: TypeConfig[] = [];
    private eventQueue: Map<string, any> = new Map();
    private queueTimer: any = null;
    private plugin: any = null;
    private wsHandler: any = null;

    public init(plugin: any) {
        this.plugin = plugin;
        this.wsHandler = (event: any) => {
            const detail = event?.detail || event;
            const cmd = detail?.cmd;
            if (cmd === "transactions" || cmd === "updateBlock" || cmd === "doOperations" || cmd === "setBlockAttrs" || cmd === "insertBlock") {
                const ops = detail?.data?.[0]?.doOperations || detail?.data || [];
                if (Array.isArray(ops)) {
                    for (const op of ops) {
                        const blockId = op.id || op.blockID;
                        if (blockId) {
                            this.enqueueBlockEvent(blockId, op.data || op.value || op, op.action, op.id);
                        }
                    }
                } else if (detail?.data?.id) {
                    this.enqueueBlockEvent(detail.data.id, detail.data, detail.cmd);
                }
            }
        };

        if (plugin?.eventBus) {
            plugin.eventBus.on("ws-main", this.wsHandler);
        }
    }

    public destroy() {
        if (this.plugin?.eventBus && this.wsHandler) {
            this.plugin.eventBus.off("ws-main", this.wsHandler);
            this.wsHandler = null;
        }
    }

    public handleBlockUpdatedEvent(data: any) {
        if (!data || !data.id) return;
        const blockId = data.id;
        const action = data.action || data.type || "update";
        const opId = data.opId || data.operationId;

        this.enqueueBlockEvent(blockId, data.data || data, action, opId);
    }

    private enqueueBlockEvent(blockId: string, payload: any, action?: string, opId?: string) {
        this.eventQueue.set(blockId, { payload, action, opId, timestamp: Date.now() });

        if (this.queueTimer) {
            clearTimeout(this.queueTimer);
        }

        this.queueTimer = setTimeout(() => {
            this.processQueue();
        }, 300);
    }

    private async processQueue() {
        const queueToProcess = new Map(this.eventQueue);
        this.eventQueue.clear();

        for (const [blockId, eventData] of queueToProcess.entries()) {
            await this.processBlockTagsDiff(blockId, eventData.payload, eventData.action, eventData.opId);
        }
    }

    private isTagEnabled(tagName: string, _isLogicTag: boolean = false): boolean {
        const pref = supertagBinder.getPref(tagName);
        if (pref === "disabled") return false;
        if (pref && pref !== "enabled" && pref !== "auto") return true;
        return true;
    }

    public async processBlockTagsDiff(blockId: string, payload?: any, action?: string, opId?: string) {
        try {
            let newTagsSet: Set<string> | null = null;
            if (payload) {
                newTagsSet = this.extractTagsFromPayload(payload, action, opId);
            }

            if (newTagsSet === null) {
                const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
                const attrs = attrsRes?.data || attrsRes || {};
                const rawTags = attrs["custom-supertags"];
                newTagsSet = new Set(parseSupertags(rawTags));
            }

            let oldTagsSet = tagCache.get(blockId);
            if (!oldTagsSet) {
                if (globalSupertagsCache.has(blockId)) {
                    oldTagsSet = new Set(globalSupertagsCache.get(blockId));
                } else {
                    oldTagsSet = new Set<string>();
                }
            }

            const { added, removed } = diffSupertags(oldTagsSet, newTagsSet);
            tagCache.set(blockId, newTagsSet);

            if (newTagsSet.size > 0) {
                globalSupertagsCache.set(blockId, Array.from(newTagsSet));
            } else {
                globalSupertagsCache.delete(blockId);
            }

            if (added.length === 0 && removed.length === 0) {
                return;
            }

            console.log(`[Supertag] Block ${blockId} tag diff -> Added: [${added.join(", ")}], Removed: [${removed.join(", ")}]`);

            for (const tag of added) {
                await this.processNewTag(blockId, tag);
            }

            for (const tag of removed) {
                await this.processRemovedTag(blockId, tag);
            }
        } catch (err) {
            console.error("[Supertag] Failed to process block tags diff:", blockId, err);
        }
    }

    public async processNativeTags(blockId: string, content: string, _editorEl?: HTMLElement) {
        try {
            if (!content || !content.includes('data-type="tag"') && !content.includes('data-type="NodeTag"')) {
                return;
            }

            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = content;

            const tagElements = tempDiv.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
            if (tagElements.length === 0) {
                return;
            }

            const supertags = new Set<string>();
            SUPERTAG_REGISTRY.forEach(item => {
                const clean = cleanTagString(item.typeTag);
                if (clean) supertags.add(clean);
            });

            const tagsToMigrate: string[] = [];
            tagElements.forEach((el: any) => {
                const tagText = (el.textContent || "")
                    .replace(/#/g, '')
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim()
                    .toLowerCase();
                if (supertags.has(tagText)) {
                    tagsToMigrate.push(tagText);
                    el.remove();
                }
            });

            if (tagsToMigrate.length === 0) {
                return;
            }

            console.log(`[Supertag-Migration] Intercepted native tags to migrate on block ${blockId}:`, tagsToMigrate);

            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes?.data || attrsRes || {};
            const rawTags = attrs["custom-supertags"];
            const currentCustom = parseSupertags(rawTags);

            const updatedCustom = Array.from(new Set([...currentCustom, ...tagsToMigrate]));

            const blockDiv = tempDiv.firstElementChild as HTMLElement;
            if (blockDiv) {
                blockDiv.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
            }

            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-supertags": JSON.stringify(updatedCustom)
                }
            });

            const activeProtyle = (window as any).activeProtyleInstance;
            let blockInActiveEditor = false;

            if (activeProtyle) {
                const blockEl = activeProtyle.element.querySelector(`[data-node-id="${blockId}"]`);
                if (blockEl) {
                    blockInActiveEditor = true;
                    const oldHTML = blockEl.outerHTML;
                    
                    const temp = document.createElement("div");
                    temp.innerHTML = oldHTML;
                    const innerBlock = temp.firstElementChild as HTMLElement;
                    if (innerBlock) {
                        innerBlock.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
                        const tagEls = innerBlock.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
                        tagEls.forEach((el: any) => {
                            const text = cleanTagString(el.textContent || "");
                            if (supertags.has(text)) el.remove();
                        });
                    }
                    const cleanHTML = temp.innerHTML.trim();

                    try {
                        activeProtyle.updateTransaction(blockId, cleanHTML, oldHTML);
                    } catch (e) {
                        console.error("[Supertag] Native updateTransaction failed, falling back:", e);
                        blockInActiveEditor = false;
                    }

                    SupertagRenderer.render(activeProtyle);
                }
            }

            if (!blockInActiveEditor) {
                const cleanDOM = tempDiv.innerHTML.trim();
                await post("/api/block/updateBlock", {
                    id: blockId,
                    dataType: "dom",
                    data: cleanDOM
                });
            }

            for (const tag of tagsToMigrate) {
                await this.processNewTag(blockId, tag);
            }
        } catch (err) {
            console.error("[Supertag-Migration] Error during native tag auto migration:", err);
        }
    }

    private extractTagsFromPayload(payload: any, _action?: string, _opId?: string): Set<string> | null {
        if (!payload) return new Set<string>();

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
            return null;
        }

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
                const parsed = parseSupertags(rawVal);
                parsed.forEach(t => tags.add(t));
            }
            return tags;
        }

        return null;
    }

    public async processNewTag(blockId: string, tag: string) {
        try {
            const cleanTag = cleanTagString(tag);

            // Update memory tagCache immediately to prevent WebSocket diff 300ms later from duplicate triggering
            let cached = tagCache.get(blockId);
            if (!cached) {
                cached = new Set(globalSupertagsCache.get(blockId) || []);
                tagCache.set(blockId, cached);
            }
            if (cached.has(cleanTag)) {
                console.log(`[Supertag] Tag #${cleanTag} already in cache for block "${blockId}". Skipping duplicate processNewTag.`);
                return;
            }
            cached.add(cleanTag);
            globalSupertagsCache.set(blockId, Array.from(cached));

            console.log(`[Supertag] 🏷️ Processing supertag #${cleanTag} for block "${blockId}"...`);

            this.dataRegistry = await getGlobalTypeConfigs();

            let dataMatches = this.dataRegistry.filter(c =>
                this.isTagEnabled(c.typeName) && cleanTagString(c.typeName) === cleanTag
            );

            let targetConfig: TypeConfig | null = null;

            if (dataMatches.length > 0) {
                targetConfig = dataMatches[0];
                if (dataMatches.length > 1) {
                    const prefAvId = supertagBinder.getPref(cleanTag);
                    if (prefAvId) {
                        targetConfig = dataMatches.find(c => c.avId === prefAvId) || targetConfig;
                    }
                }
            }

            if (targetConfig) {
                console.log(`[Supertag] Step 1: Binding block "${blockId}" as row in Layer 4 AV "${targetConfig.avName}" (${targetConfig.avId})...`);
                await supertagBinder.applySupertag(blockId, cleanTag, targetConfig);
            } else {
                console.log(`[Supertag] Step 1: No Layer 4 AV matching #${cleanTag} found. Data will persist in block custom attributes.`);
            }

            console.log(`[Supertag] Step 2: Executing conditional trigger commands for #${cleanTag}...`);
            await triggerConditionalCommands(blockId, cleanTag, "tag_created");
        } catch (e) {
            console.error("[Supertag] Failed to process new tag:", blockId, e);
        }
    }

    public async processRemovedTag(blockId: string, tag: string) {
        try {
            const cleanTag = cleanTagString(tag);
            
            const cached = tagCache.get(blockId);
            if (cached) {
                if (!cached.has(cleanTag)) {
                    console.log(`[Supertag] Tag #${cleanTag} already absent from cache for block "${blockId}". Skipping duplicate processRemovedTag.`);
                    return;
                }
                cached.delete(cleanTag);
                if (cached.size > 0) {
                    globalSupertagsCache.set(blockId, Array.from(cached));
                } else {
                    globalSupertagsCache.delete(blockId);
                }
            }

            await triggerConditionalCommands(blockId, cleanTag, "tag_removed");
        } catch (e) {
            console.error("[Supertag] Failed to process removed tag:", blockId, e);
        }
    }

    public emit(event: string, data: any) {
        if (event === "task_completed" && data?.blockId) {
            void this.processTaskCompleted(data.blockId);
        }
    }

    public async processTaskCompleted(blockId: string) {
        try {
            console.log(`[Supertag] Triggering task_completed event for block "${blockId}"...`);
            await triggerConditionalCommands(blockId, "task", "task_completed");
        } catch (e) {
            console.error("[Supertag] Failed to process task completed:", blockId, e);
        }
    }

    public async processBlockContentChanged(blockId: string) {
        try {
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes?.data || attrsRes || {};
            const rawTags = attrs["custom-supertags"];
            const tags = parseSupertags(rawTags);

            for (const tag of tags) {
                const cleanTag = cleanTagString(tag);
                await triggerConditionalCommands(blockId, cleanTag, "block_content_changed");
            }
        } catch (e) {
            console.error("[Supertag] Failed to process block content changed:", blockId, e);
        }
    }
}

export const supertagMonitor = new SupertagMonitor();
