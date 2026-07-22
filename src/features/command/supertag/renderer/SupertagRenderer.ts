import { post } from "../../../../shared/api-client/request";
import { showMessage } from "siyuan";
import { supertagMonitor } from "../core/supertag-listener";
import { globalSupertagsCache } from "../../registration";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";

export class SupertagRenderer {
    private static renderedMap = new Map<string, string[]>();
    private static isObserverInit = false;

    /**
     * 初始化前端 MutationObserver 监听器。
     * 当 DOM 节点变动或 custom-supertags / custom-index-task 属性改变时，
     * 自动在前端实时挂载渲染 Supertag 胶囊药丸，无需后端轮询或复杂 API 调用。
     */
    public static initAutoObserver() {
        if (this.isObserverInit) return;
        this.isObserverInit = true;

        let timer: any = null;
        const observer = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                const activeProtyle = (window as any).activeProtyleInstance || (window as any).siyuan?.ws?.protyle;
                const editorEl = activeProtyle?.element || document.querySelector(".protyle-content") || document.body;
                if (editorEl) {
                    this.renderBlockTags(editorEl as HTMLElement);
                }
            }, 50);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["custom-supertags", "custom-index-task"]
        });
    }

    /**
     * Scan the editor and render tags for the page and its blocks.
     */
    public static async render(protyle: any) {
        if (!protyle || !protyle.element) return;
        const docId = protyle.block?.id || protyle.blockId;
        if (!docId) return;

        // 1. Render document-level tags (below the document title)
        await this.renderDocumentTags(docId, protyle.element);

        // 2. Render block-level tags for all blocks in the editor
        this.renderBlockTags(protyle.element);
    }

    /**
     * Query and render tags on the document level (just below the protyle-title).
     */
    public static async renderDocumentTags(docId: string, editorEl: HTMLElement) {
        try {
            const titleEl = editorEl.querySelector(".protyle-title");
            if (!titleEl) return;

            // Ensure docId matches actual page document node ID
            const pageDocId = titleEl.getAttribute("data-node-id");
            if (pageDocId && docId !== pageDocId) {
                return;
            }

            // Query page attributes
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: docId });
            const attrs = attrsRes?.data || attrsRes || {};
            const rawTags = attrs["custom-supertags"];
            const taskStatus = attrs["custom-index-task"];
            const isTask = Boolean(taskStatus);

            const tags = parseSupertags(rawTags);
            globalSupertagsCache.set(docId, tags);

            // Find or create document tags container
            let container = titleEl.querySelector(".index-doc-supertags") as HTMLElement;
            if (container) {
                container.innerHTML = "";
            } else {
                container = document.createElement("div");
                container.className = "index-doc-supertags";
                container.setAttribute("contenteditable", "false");
                container.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 8px; margin-top: 10px; border-bottom: 1px dashed var(--b3-border-color); flex-shrink: 0; min-height: 24px; align-items: center;";
                titleEl.appendChild(container);
            }

            if (tags.length === 0 && !isTask) {
                container.style.display = "none";
                return;
            }

            container.style.display = "flex";

            if (isTask) {
                const checkboxPill = this.createCheckboxPill(docId, taskStatus, editorEl);
                container.appendChild(checkboxPill);
            }

            tags.forEach(tag => {
                const pill = this.createTagPill(tag, async () => {
                    await this.removeTagFromBlock(docId, tag, "page", editorEl);
                });
                container.appendChild(pill);
            });

        } catch (e) {
            console.error("[SupertagRenderer] Failed to render document tags:", e);
        }
    }

    /**
     * Directly render tags and virtual task checkbox pill for a single block DOM element instantly.
     */
    public static renderSingleBlockElement(blockEl: HTMLElement) {
        if (!blockEl) return;
        const blockId = blockEl.getAttribute("data-node-id");
        if (!blockId) return;

        const editorEl = blockEl.closest(".protyle-wysiwyg") as HTMLElement || document.body;
        const rawTags = blockEl.getAttribute("custom-supertags") || "";
        const tags = parseSupertags(rawTags);
        const taskStatus = blockEl.getAttribute("custom-index-task");
        const isTask = Boolean(taskStatus);

        let attrEl = blockEl.querySelector(".protyle-attr") as HTMLElement;
        if (!attrEl) {
            attrEl = document.createElement("div");
            attrEl.className = "protyle-attr";
            attrEl.setAttribute("contenteditable", "false");
            blockEl.appendChild(attrEl);
        }

        let container = attrEl.querySelector(".index-block-meta-container") as HTMLElement;
        
        if (tags.length === 0 && !isTask) {
            if (container) container.remove();
            return;
        }

        const renderedKey = `${tags.join(",")}|${taskStatus || ""}`;
        if (container && container.getAttribute("data-rendered-key") === renderedKey) {
            return;
        }

        if (container) {
            container.innerHTML = "";
            container.setAttribute("data-rendered-key", renderedKey);
        } else {
            container = document.createElement("div");
            container.className = "index-block-meta-container";
            container.setAttribute("data-rendered-key", renderedKey);
            container.style.cssText = "display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; vertical-align: middle;";
            
            if (attrEl.firstChild) {
                attrEl.insertBefore(container, attrEl.firstChild);
            } else {
                attrEl.appendChild(container);
            }
        }

        if (isTask && taskStatus) {
            const checkboxPill = this.createCheckboxPill(blockId, taskStatus, editorEl);
            container.appendChild(checkboxPill);
        }

        tags.forEach(tag => {
            const pill = this.createTagPill(tag, async () => {
                await this.removeTagFromBlock(blockId, tag, "block", editorEl);
            }, true);
            container.appendChild(pill);
        });
    }

    /**
     * Scan the DOM for blocks carrying `custom-supertags` or `custom-index-task` and render inline pills.
     */
    public static renderBlockTags(editorEl: HTMLElement) {
        const blocks = editorEl.querySelectorAll("[custom-supertags], [custom-index-task]");
        blocks.forEach((block: any) => {
            this.renderSingleBlockElement(block);
        });
    }

    private static createCheckboxPill(blockId: string, status: string, editorEl: HTMLElement): HTMLElement {
        const pill = document.createElement("div");
        pill.className = "index-task-checkbox-pill";
        
        const isCompleted = status === "completed";
        
        pill.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 2px;
            padding: 0px 6px;
            border-radius: 4px;
            background-color: ${isCompleted ? "var(--b3-theme-primary-light)" : "var(--b3-theme-background-hover)"};
            border: 1px solid ${isCompleted ? "var(--b3-theme-primary)" : "var(--b3-border-color)"};
            color: ${isCompleted ? "var(--b3-theme-primary)" : "var(--b3-theme-on-surface-light)"};
            font-weight: bold;
            font-size: 10px;
            height: 16px;
            line-height: 14px;
            cursor: pointer;
            transition: all 0.15s ease-in-out;
            user-select: none;
            vertical-align: middle;
            box-sizing: border-box;
        `;
        
        pill.innerText = isCompleted ? "☑ 已完成" : "☐ 待办";

        const toggleTask = async (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            const newStatus = isCompleted ? "pending" : "completed";
            console.log(`[Supertag-Pill-Debug] Clicked task checkbox pill on block "${blockId}". Toggling status: ${status} -> ${newStatus}`);
            
            try {
                // Update Siyuan block attributes (Pure single attribute custom-index-task)
                await post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: {
                        "custom-index-task": newStatus
                    }
                });
                
                // Re-render visually for both document page tags and block tags instantly
                const targetBlockEl = (document.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement) || editorEl.querySelector(`[data-node-id="${blockId}"]`);
                if (targetBlockEl) {
                    targetBlockEl.setAttribute("custom-index-task", newStatus);
                    this.renderSingleBlockElement(targetBlockEl);
                }
                await this.renderDocumentTags(blockId, editorEl);
                this.renderBlockTags(editorEl);
                
                // Trigger event content change or task completed to run pipeline
                console.log(`[Supertag-Trigger] Virtual task status changed to: ${newStatus} for block: ${blockId}`);
                if (newStatus === "completed") {
                    await supertagMonitor.processTaskCompleted(blockId);
                } else {
                    await supertagMonitor.processBlockContentChanged(blockId);
                }
            } catch (err) {
                console.error("[SupertagRenderer] Failed to toggle virtual task status:", err);
            }
        };

        pill.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        pill.addEventListener("click", toggleTask);
        
        return pill;
    }

    private static createTagPill(tagName: string, onRemove: () => Promise<void>, isSmall: boolean = false): HTMLElement {
        const pill = document.createElement("div");
        pill.className = "index-supertag-pill";
        
        if (isSmall) {
            pill.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 0px 6px;
                border-radius: 4px;
                background-color: var(--b3-theme-background-hover);
                border: 1px solid var(--b3-theme-primary-light);
                color: var(--b3-theme-primary);
                font-weight: 500;
                font-size: 10px;
                height: 16px;
                line-height: 14px;
                cursor: default;
                transition: all 0.15s ease-in-out;
                user-select: none;
                vertical-align: middle;
                box-sizing: border-box;
            `;
        } else {
            pill.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                border-radius: 12px;
                background-color: var(--b3-theme-background-hover);
                border: 1px solid var(--b3-theme-primary-light);
                color: var(--b3-theme-primary);
                font-weight: 500;
                font-size: 11px;
                line-height: 1.2;
                cursor: default;
                transition: all 0.15s ease-in-out;
                margin-right: 4px;
                user-select: none;
            `;
        }

        const nameSpan = document.createElement("span");
        nameSpan.innerText = tagName;
        pill.appendChild(nameSpan);

        const closeBtn = document.createElement("span");
        closeBtn.innerHTML = "&times;";
        closeBtn.style.cssText = `
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            transition: background-color 0.1s ease;
            color: var(--b3-theme-on-surface-light);
        `;
        
        closeBtn.addEventListener("mouseover", () => {
            closeBtn.style.color = "var(--b3-theme-error)";
        });
        closeBtn.addEventListener("mouseout", () => {
            closeBtn.style.color = "var(--b3-theme-on-surface-light)";
        });
        
        const handleRemove = async (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            console.log(`[Supertag-Pill-Debug] Clicked remove pill for tag #${tagName}`);
            await onRemove();
        };

        closeBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        closeBtn.addEventListener("click", handleRemove);

        pill.appendChild(closeBtn);
        return pill;
    }

    /**
     * Helper to write tag removal back to block attributes.
     */
    private static async removeTagFromBlock(blockId: string, tagToRemove: string, type: "page" | "block", editorEl: HTMLElement) {
        try {
            console.log(`[Tag-Remove] Removing tag "${tagToRemove}" from ${type} "${blockId}"...`);

            // Get current attributes
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes?.data || attrsRes || {};
            const rawTags = attrs["custom-supertags"] || attrsRes?.["custom-supertags"];

            const tags = parseSupertags(rawTags);

            const updatedTags = tags.filter(t => t !== tagToRemove);
            globalSupertagsCache.set(blockId, updatedTags);
            
            // Prepare attributes update
            const updateAttrs: Record<string, string> = {
                "custom-supertags": serializeSupertags(updatedTags)
            };

            const isTaskTag = tagToRemove.toLowerCase() === "task";
            if (isTaskTag) {
                console.log(`[Tag-Remove] Task supertag removed. Clearing custom-index-task attribute on ${blockId}`);
                updateAttrs["custom-index-task"] = "";
            }

            // Write back to Siyuan
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: updateAttrs
            });

            // Trigger tag_removed commands explicitly
            console.log(`[Tag-Remove] Processing tag_removed event for tag "${tagToRemove}" on ${blockId}...`);
            await supertagMonitor.processRemovedTag(blockId, tagToRemove);

            // Re-render visually instantly
            if (type === "page") {
                await this.renderDocumentTags(blockId, editorEl);
            } else {
                const targetBlockEl = editorEl.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement;
                if (targetBlockEl) {
                    if (isTaskTag) {
                        targetBlockEl.removeAttribute("custom-index-task");
                    }
                    targetBlockEl.setAttribute("custom-supertags", updatedTags.length > 0 ? JSON.stringify(updatedTags) : "");
                    this.renderSingleBlockElement(targetBlockEl);
                }
                this.renderBlockTags(editorEl);
            }

            showMessage(`已移除超级标签: #${tagToRemove}`);
        } catch (e) {
            console.error("[Tag-Remove] Failed to remove tag:", tagToRemove, e);
            showMessage("移除标签失败", 3000, "error");
        }
    }
}
