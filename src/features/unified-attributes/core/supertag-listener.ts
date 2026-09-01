/**
 * supertag-listener.ts
 *
 * WebSocket 消息监听、原生标签自动迁移与事件防抖队列核心管理器 (SupertagMonitor)
 */

import { post } from "../../../shared/api-client/request";
import { SUPERTAG_REGISTRY, globalSupertagsCache, getTypeAvId } from "../../command/registration";
import { getGlobalTypeConfigs } from "../../av/av-setting/db-config";
import { type TypeConfig } from "../../av/av-setting/types";
import { parseSupertags, diffSupertags, cleanTagString, tagCache } from "./supertag-diff";
import { supertagBinder } from "./supertag-binder";
import { triggerConditionalCommands, dispatchScopeEvents } from "./supertag-trigger";
import { SupertagRenderer } from "../renderer/SupertagRenderer";
import { commandRegistry } from "../../command/registry/command-registry";
import { encodeBtnHref } from "../../command/global-registration/inline-button";
import { supertagAVProjector } from "../projection/supertag-av-projector";
import { SYSTEM_EXCLUDED_SUPERTAGS, isIdLike } from "./supertag-entity";

export class SupertagMonitor {
    private dataRegistry: TypeConfig[] = [];
    private eventQueue: Map<string, any> = new Map();
    private queueTimer: any = null;
    private plugin: any = null;
    private wsHandler: any = null;
    private dbSyncDebounceTimer: any = null;

    public init(plugin: any) {
        this.plugin = plugin;
        this.wsHandler = (event: any) => {
            const detail = event?.detail || event;
            const cmd = detail?.cmd;

            if (cmd === "databaseIndexCommit") {
                // 仅在思源数据库索引提交广播时，防抖触发 supertag-db 状态同步与自愈
                this.triggerSupertagDbSync();
            }

            if (cmd === "databaseIndexCommit" || cmd === "transactions" || cmd === "updateBlock" || cmd === "doOperations" || cmd === "setBlockAttrs" || cmd === "insertBlock") {
                const txList = Array.isArray(detail?.data) ? detail.data : [detail?.data];
                for (const tx of txList) {
                    const ops = tx?.doOperations || (Array.isArray(tx) ? tx : []);
                    if (Array.isArray(ops)) {
                        for (const op of ops) {
                            // 1. 捕获原生 AV 单元格编辑并反向回写到块属性
                            if (op.action === "updateAttrViewCell" || op.action === "updateAttrViewCells" || op.action === "setAttrViewCell") {
                                supertagAVProjector.handleAVCellUpdate(op);
                                continue;
                            }

                            const blockId = op.id || op.blockID || op.rowID || op.itemID;
                            if (blockId && typeof blockId === "string" && !blockId.includes("_col_")) {
                                this.enqueueBlockEvent(blockId, op.data || op.value || op, op.action, op.id);
                            }
                        }
                    } else if (tx?.id && typeof tx.id === "string" && !tx.id.includes("_col_")) {
                        this.enqueueBlockEvent(tx.id, tx, detail.cmd);
                    }
                }
            }
        };

        if (plugin?.eventBus) {
            plugin.eventBus.on("ws-main", this.wsHandler);
        }
    }

    private triggerSupertagDbSync() {
        if (this.dbSyncDebounceTimer) {
            clearTimeout(this.dbSyncDebounceTimer);
        }
        this.dbSyncDebounceTimer = setTimeout(async () => {
            try {
                const { refreshSupertagRegistry } = await import("../../command/utils/sync-service");
                await refreshSupertagRegistry();
            } catch (err) {
                console.error("[SupertagListener] refreshSupertagRegistry 异常:", err);
            }
        }, 400);
    }

    public destroy() {
        if (this.dbSyncDebounceTimer) {
            clearTimeout(this.dbSyncDebounceTimer);
            this.dbSyncDebounceTimer = null;
        }
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

            const isInsert = eventData.action === "insert" || 
                             eventData.action === "insertBlock" || 
                             eventData.action === "append";

            if (isInsert) {
                await this.processBlockCreated(blockId);
            } else {
                await this.processBlockContentChanged(blockId);
            }
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

            if (activeProtyle?.element) {
                const liveBlock = activeProtyle.element.querySelector(`[data-node-id="${blockId}"]`);
                if (liveBlock) {
                    blockInActiveEditor = true;
                    liveBlock.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
                    const liveTags = liveBlock.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
                    liveTags.forEach((el: any) => {
                        const t = (el.textContent || "")
                            .replace(/#/g, '')
                            .replace(/[\u200B-\u200D\uFEFF]/g, '')
                            .trim()
                            .toLowerCase();
                        if (supertags.has(t)) el.remove();
                    });
                    SupertagRenderer.renderSingleBlockElement(liveBlock as HTMLElement);
                }
            }

            if (!blockInActiveEditor) {
                const newHTML = blockDiv ? blockDiv.outerHTML : tempDiv.innerHTML;
                try {
                    await post("/api/block/updateBlock", {
                        dataType: "dom",
                        data: newHTML,
                        id: blockId
                    });
                } catch (e) {
                    console.error("[Supertag] Native updateTransaction failed, falling back:", e);
                }
            }

            tagCache.set(blockId, new Set(updatedCustom));
            globalSupertagsCache.set(blockId, updatedCustom);

            for (const t of tagsToMigrate) {
                await this.processNewTag(blockId, t);
            }
        } catch (err) {
            console.error("[Supertag-Migration] Error during native tag auto migration:", err);
        }
    }

    private extractTagsFromPayload(payload: any, action?: string, opId?: string): Set<string> | null {
        if (!payload) return null;
        if (action === "setAttrViewCell" || action === "updateAttrViewCell") {
            return null;
        }

        const tags = new Set<string>();
        let hasTagField = false;

        const customSupertags = payload["custom-supertags"] || payload?.attrs?.["custom-supertags"];
        if (customSupertags !== undefined) {
            hasTagField = true;
            parseSupertags(customSupertags).forEach(t => tags.add(cleanTagString(t)));
        }

        const ial = payload.ial || payload.data?.ial;
        if (ial && typeof ial === "string") {
            const match = ial.match(/custom-supertags="([^"]+)"/);
            if (match) {
                hasTagField = true;
                const unescaped = match[1].replace(/&quot;/g, '"');
                parseSupertags(unescaped).forEach(t => tags.add(cleanTagString(t)));
            }
        }

        const dom = payload.dom || payload.data?.dom;
        if (dom && typeof dom === "string") {
            const match = dom.match(/custom-supertags="([^"]+)"/);
            if (match) {
                hasTagField = true;
                const unescaped = match[1].replace(/&quot;/g, '"');
                parseSupertags(unescaped).forEach(t => tags.add(cleanTagString(t)));
            }
        }

        if (hasTagField) {
            return tags;
        }

        return null;
    }

    public async processNewTag(blockId: string, tag: string) {
        try {
            const cleanTag = cleanTagString(tag);

            // 维护 processed 集合，防止 WebSocket 事件重入导致重复触发 tag_created
            let processedTags = tagCache.get(blockId);
            if (!processedTags) {
                processedTags = new Set<string>();
                tagCache.set(blockId, processedTags);
            }
            if (processedTags.has(cleanTag)) {
                return;
            }
            processedTags.add(cleanTag);
            globalSupertagsCache.set(blockId, Array.from(processedTags));

            this.dataRegistry = await getGlobalTypeConfigs();

            let dataMatches = this.dataRegistry.filter(c =>
                this.isTagEnabled(c.typeName) && cleanTagString(c.typeName) === cleanTag
            );

            let targetConfig: TypeConfig | null = null;
            let prefAvId = supertagBinder.getPref(cleanTag);

            if (!prefAvId || prefAvId === "disabled" || prefAvId === "enabled") {
                try {
                    const { ensureSupertagDatabase } = await import("./supertag-schema");
                    prefAvId = await ensureSupertagDatabase(cleanTag);
                } catch (_) {}
            }

            if (prefAvId) {
                targetConfig = this.dataRegistry.find(c => c.avId === prefAvId) || {
                    typeName: cleanTag,
                    avId: prefAvId,
                    avName: cleanTag,
                    typeFieldId: ""
                };
            } else if (dataMatches.length > 0) {
                targetConfig = dataMatches[0];
            }

            if (targetConfig) {
                await supertagBinder.applySupertag(blockId, cleanTag, targetConfig);
            }

            await triggerConditionalCommands(blockId, cleanTag, "tag_created");
            await this.ensureCommandButtons(blockId, cleanTag);
        } catch (e) {
            console.error("[Supertag] Failed to process new tag:", blockId, e);
        }
    }

    /**
     * 若该超标签配置了 Button 命令，在块下方新建一个段落块，内含命令按钮。
     * 通过块属性 custom-index-buttons 去重（已有按钮段落则跳过）。
     */
    private async ensureCommandButtons(blockId: string, tag: string) {
        const cleanTag = tag.replace(/^#/, "").trim().toLowerCase();
        const buttonEntries = SUPERTAG_REGISTRY.filter(l =>
            l.typeTag.toLowerCase() === cleanTag && l.uiLocation === "Button" && l.commandRef
        );
        if (buttonEntries.length === 0) return;

        try {
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            if (attrsRes?.data?.["custom-index-buttons"]) {
                return;
            }
        } catch { /* ignore */ }

        const buttonsMd = buttonEntries.map(e => {
            const cmdDef = commandRegistry.getCommand(e.commandRef);
            const label = cmdDef?.name || e.commandRef;
            const href = encodeBtnHref({ command: e.commandRef, param: e.inputMapping || undefined });
            return `[⚡ ${label}](${href})`;
        }).join(" ");

        const res = await post("/api/block/insertBlock", {
            previousID: blockId,
            dataType: "markdown",
            data: buttonsMd
        });
        const tx = Array.isArray(res) ? res : ((res as any)?.data || res);
        const newBlockId = Array.isArray(tx) ? tx[0]?.doOperations?.[0]?.id : (tx as any)?.id;
        if (newBlockId) {
            await post("/api/attr/setBlockAttrs", { id: blockId, attrs: { "custom-index-buttons": newBlockId } });
        }
    }

    public async processRemovedTag(blockId: string, tag: string) {
        try {
            const cleanTag = cleanTagString(tag);
            
            const cached = tagCache.get(blockId);
            if (cached) {
                cached.delete(cleanTag);
                if (cached.size > 0) {
                    globalSupertagsCache.set(blockId, Array.from(cached));
                } else {
                    globalSupertagsCache.delete(blockId);
                }
            }

            // 从 Hot-SQLite 内存表中即时移除该块
            await supertagAVProjector.removeBlockFromVirtualTable(blockId, cleanTag);

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
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes?.data || attrsRes || {};

            // 1. 严格只检查全局 task 变量是否更新为了 completed
            const taskStatus = attrs["custom-task"] || attrs["custom-index-task"];
            if (taskStatus !== "completed") {
                return;
            }

            // 2. 提取当前块上挂载的超级标签列表
            const rawTags = attrs["custom-supertags"];
            const currentTags = parseSupertags(rawTags).map(t => cleanTagString(t)).filter(Boolean);

            if (currentTags.length === 0) {
                return;
            }

            console.log(`[Supertag] 块 "${blockId}" 全局 task 更新为 completed，广播触发挂载的 Supertag [${currentTags.join(", ")}]...`);

            // 3. 针对当前块上挂载的所有 Supertag 广播 task_completed 事件
            // 只有绑定了 task_completed (或 [任务完成时]) 条件的 Supertag 才会触发其动作
            for (const tag of currentTags) {
                await triggerConditionalCommands(blockId, tag, "task_completed");
            }

            // 4. 级联广播触发同文档或祖先树中监听了 task_completed 的组件 (如 #player 或 #project)
            await dispatchScopeEvents(blockId, "task_completed");
        } catch (e) {
            console.error("[Supertag] Failed to process task completed:", blockId, e);
        }
    }

    public async processBlockCreated(blockId: string) {
        try {
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes?.data || attrsRes || {};
            const rawTags = attrs["custom-supertags"];
            const tags = parseSupertags(rawTags);

            for (const tag of tags) {
                const cleanTag = cleanTagString(tag);
                await triggerConditionalCommands(blockId, cleanTag, "block_created");
            }

            // ⚡ 级联广播触发同文档或祖先树中监听了 block_created 的组件 (如 #project)
            await dispatchScopeEvents(blockId, "block_created");
        } catch (e) {
            console.error("[Supertag] Failed to process block created:", blockId, e);
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

            // ⚡ 级联广播触发同文档或祖先树中监听了 block_content_changed 的组件 (如 #project 或 #player)
            await dispatchScopeEvents(blockId, "block_content_changed");
        } catch (e) {
            console.error("[Supertag] Failed to process block content changed:", blockId, e);
        }
    }
}

export const supertagMonitor = new SupertagMonitor();
