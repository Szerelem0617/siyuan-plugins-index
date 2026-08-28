import { post } from "../../../shared/api-client/request";
import { showMessage } from "siyuan";
import { supertagMonitor } from "../core/supertag-listener";
import { globalSupertagsCache, SUPERTAG_REGISTRY, getLayer2CommandDisplayName } from "../../command/registration";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";
import { evaluateCondition } from "../core/condition-evaluator";
import { dispatchCommand } from "../../command/command-dispatcher";
import { commandRegistry } from "../../command/registry/command-registry";

export class SupertagRenderer {
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
            attributeFilter: ["custom-supertags", "custom-task-status"]
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
            const tags = parseSupertags(rawTags);
            globalSupertagsCache.set(docId, tags);

            const taskStatus = attrs["custom-task-status"];
            const isTask = Boolean(taskStatus);

            // Find or create document tags container
            let container = titleEl.querySelector(".index-doc-supertags") as HTMLElement;
            if (container) {
                container.innerHTML = "";
            } else {
                container = document.createElement("div");
                container.className = "index-doc-supertags";
                container.setAttribute("contenteditable", "false");
                container.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 8px; margin-top: 10px; border-bottom: 1px dashed var(--indexos-border-light); flex-shrink: 0; min-height: 24px; align-items: center;";
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
                    await this.removeTagFromBlock(docId, tag, "doc", editorEl);
                }, false);
                container.appendChild(pill);

                // 挂载文档级 Supertag 的虚拟按钮
                this.renderVirtualButtonsForTag(docId, tag, titleEl, editorEl, container);
            });
        } catch (e) {
            console.error("[SupertagRenderer] Failed to render document tags:", e);
        }
    }

    /**
     * Render tags on a single block DOM element.
     */
    public static renderSingleBlockElement(blockEl: HTMLElement) {
        if (!blockEl || !blockEl.getAttribute) return;
        
        // 跳过页面标题节点（页面文档级别的标签与 Task 由 renderDocumentTags 统一在标题下方挂载，避免右上角重复渲染）
        if (blockEl.classList.contains("protyle-title") || blockEl.closest(".protyle-title")) {
            return;
        }

        const blockId = blockEl.getAttribute("data-node-id");
        if (!blockId) return;

        const editorEl = blockEl.closest(".protyle-wysiwyg") as HTMLElement || document.body;
        const rawTags = blockEl.getAttribute("custom-supertags") || "";
        const tags = parseSupertags(rawTags);
        const taskStatus = blockEl.getAttribute("custom-task-status");
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

        const cleanTagList = tags.map(t => t.replace(/^#/, "").trim().toLowerCase());
        const vBtnConfigs = SUPERTAG_REGISTRY.filter(r => r.uiLocation === "VirtualButton" && cleanTagList.includes(r.typeTag.toLowerCase()));
        const vBtnSig = vBtnConfigs.map(v => `${v.commandRef}:${v.condition || ''}:${v.buttonLabel || ''}`).join(";");
        const renderedKey = `${tags.join(",")}|${taskStatus || ""}|${vBtnSig}`;

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

            // 渲染该 Supertag 绑定的 Virtual Button (虚拟悬浮按钮)
            this.renderVirtualButtonsForTag(blockId, tag, blockEl, editorEl, container);
        });
    }

    /**
     * 根据 Block Filter 条件动态挂载 Virtual Button (虚拟悬浮按钮)
     */
    private static renderVirtualButtonsForTag(
        blockId: string,
        tag: string,
        blockEl: HTMLElement,
        editorEl: HTMLElement,
        container: HTMLElement
    ) {
        const cleanTag = tag.replace(/^#/, "").trim().toLowerCase();
        const vEntries = SUPERTAG_REGISTRY.filter(l =>
            l.typeTag.toLowerCase() === cleanTag && l.uiLocation === "VirtualButton" && l.commandRef
        );
        if (vEntries.length === 0) return;

        // 收集块属性
        const attrs: Record<string, string> = {};
        for (let i = 0; i < blockEl.attributes.length; i++) {
            const attr = blockEl.attributes[i];
            if (attr.name.startsWith("custom-") || attr.name.startsWith("data-") || attr.name === "updated") {
                attrs[attr.name] = attr.value;
            }
        }
        const blockContent = blockEl.textContent || "";

        for (const entry of vEntries) {
            const cond = entry.condition || entry.blockFilter;
            const isMatch = evaluateCondition(cond, {
                id: blockId,
                attrs,
                content: blockContent
            });

            if (isMatch) {
                const vBtn = this.createVirtualButtonPill(blockId, entry, blockEl, editorEl);
                container.appendChild(vBtn);
            }
        }
    }

    private static createVirtualButtonPill(
        blockId: string,
        entry: any,
        blockEl: HTMLElement,
        editorEl: HTMLElement
    ): HTMLElement {
        const cmdDef = commandRegistry.getCommand(entry.commandRef);
        const displayName = entry.buttonLabel || entry.methodName || getLayer2CommandDisplayName(entry.commandRef, cmdDef?.name);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "indexos-virtual-button indexos-btn-inline";
        btn.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 1px 7px;
            height: 18px;
            font-size: 10px;
            font-weight: 600;
            line-height: 16px;
            box-sizing: border-box;
            vertical-align: middle;
        `;
        btn.innerHTML = `<span>⚡</span><span>${displayName}</span>`;
        btn.title = `虚拟按钮 [${displayName}] (满足条件动态悬浮)`;

        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                btn.style.opacity = "0.5";
                const ctx = { blockEl, protyleEl: editorEl, vars: { block_id: blockId } };
                await dispatchCommand(entry.commandRef, entry.inputMapping || "", ctx as any);
                // 触发重新渲染
                setTimeout(() => {
                    SupertagRenderer.renderBlockTags(editorEl);
                }, 100);
            } catch (err: any) {
                showMessage(`执行虚拟按钮失败: ${err?.message || err}`, 3000, "error");
            } finally {
                btn.style.opacity = "1";
            }
        });

        return btn;
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
        pill.className = "index-task-checkbox-pill indexos-supertag-chip";
        
        const isCompleted = status === "completed";
        
        pill.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 8px;
            border-radius: 3px;
            background-color: ${isCompleted ? "var(--indexos-accent-badge-bg)" : "var(--indexos-bg-container)"};
            border: 1px solid var(--indexos-border-light);
            color: ${isCompleted ? "var(--indexos-accent-primary)" : "var(--indexos-text-muted)"};
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-weight: 600;
            font-size: 10px;
            height: 18px;
            line-height: 16px;
            cursor: pointer;
            transition: all 0.15s ease-in-out;
            user-select: none;
            vertical-align: middle;
            box-sizing: border-box;
        `;
        
        pill.innerText = isCompleted ? "☑ 完成" : "☐ 待办";

        const toggleTask = async (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            const newStatus = isCompleted ? "pending" : "completed";
            console.log(`[Supertag-Pill-Debug] Clicked task checkbox pill on block "${blockId}". Toggling status: ${status} -> ${newStatus}`);

            try {
                // Update DOM immediately for instant UI feedback with safe null-checks
                const titleNode = editorEl?.querySelector?.(".protyle-title");
                if (titleNode && titleNode.getAttribute("data-node-id") === blockId) {
                    titleNode.setAttribute("custom-index-task", newStatus);
                } else {
                    const node = editorEl?.querySelector?.(`[data-node-id="${blockId}"]`) || document.querySelector(`[data-node-id="${blockId}"]`);
                    if (node) node.setAttribute("custom-index-task", newStatus);
                }

                // Update backend attribute
                await post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: {
                        "custom-index-task": newStatus
                    }
                });

                // Trigger task completed event if transitioned to completed
                if (newStatus === "completed") {
                    await supertagMonitor.processTaskCompleted(blockId);
                }

                // Re-render
                const titleNodeAfter = editorEl?.querySelector?.(".protyle-title");
                if (titleNodeAfter && titleNodeAfter.getAttribute("data-node-id") === blockId) {
                    await SupertagRenderer.renderDocumentTags(blockId, editorEl);
                } else {
                    const block = (editorEl?.querySelector?.(`[data-node-id="${blockId}"]`) || document.querySelector(`[data-node-id="${blockId}"]`)) as HTMLElement;
                    if (block) SupertagRenderer.renderSingleBlockElement(block);
                }
            } catch (err) {
                console.error("[SupertagRenderer] Failed to toggle virtual task status:", err);
                showMessage("更新任务状态失败", 3000, "error");
            }
        };

        pill.addEventListener("click", toggleTask);
        return pill;
    }

    private static createTagPill(tagName: string, onRemove: () => Promise<void>, isSmall: boolean = false): HTMLElement {
        const pill = document.createElement("div");
        pill.className = "index-supertag-pill indexos-supertag-chip";
        
        pill.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: ${isSmall ? "0px 6px" : "2px 8px"};
            border-radius: 3px;
            background-color: var(--indexos-accent-badge-bg);
            border: 1px solid var(--indexos-border-light);
            color: var(--indexos-accent-badge-text);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-weight: 600;
            font-size: ${isSmall ? "10px" : "11px"};
            line-height: 1.2;
            cursor: default;
            transition: all 0.15s ease-in-out;
            margin-right: 4px;
            user-select: none;
            box-sizing: border-box;
        `;

        const labelSpan = document.createElement("span");
        labelSpan.style.cssText = "display: inline-flex; align-items: center; gap: 2px;";
        labelSpan.innerHTML = `<span style="opacity: 0.7;">#</span>${this.escapeHtml(tagName)}`;
        pill.appendChild(labelSpan);

        const closeBtn = document.createElement("span");
        closeBtn.className = "index-supertag-pill-close";
        closeBtn.innerHTML = "&times;";
        closeBtn.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-left: 2px;
            font-size: 12px;
            line-height: 1;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            cursor: pointer;
            opacity: 0.6;
            transition: all 0.15s ease;
        `;
        
        closeBtn.addEventListener("mouseenter", () => {
            closeBtn.style.opacity = "1";
            closeBtn.style.backgroundColor = "rgba(220, 38, 38, 0.2)";
            closeBtn.style.color = "#DC2626";
        });
        closeBtn.addEventListener("mouseleave", () => {
            closeBtn.style.opacity = "0.6";
            closeBtn.style.backgroundColor = "transparent";
            closeBtn.style.color = "inherit";
        });

        closeBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await onRemove();
        });

        pill.appendChild(closeBtn);
        return pill;
    }

    private static async removeTagFromBlock(blockId: string, tagToRemove: string, scope: "doc" | "block", editorEl: HTMLElement) {
        try {
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes?.data || attrsRes || {};
            const rawTags = attrs["custom-supertags"] || "";
            const currentTags = parseSupertags(rawTags);

            const newTags = currentTags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase());
            const newRawValue = serializeSupertags(newTags);

            // Update DOM attribute
            if (scope === "doc") {
                const titleEl = editorEl.querySelector(".protyle-title");
                if (newRawValue) {
                    titleEl?.setAttribute("custom-supertags", newRawValue);
                } else {
                    titleEl?.removeAttribute("custom-supertags");
                }
            } else {
                const blockEl = editorEl.querySelector(`[data-node-id="${blockId}"]`);
                if (newRawValue) {
                    blockEl?.setAttribute("custom-supertags", newRawValue);
                } else {
                    blockEl?.removeAttribute("custom-supertags");
                }
            }

            // Update Backend
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-supertags": newRawValue
                }
            });

            // Trigger Supertag Removed Event
            supertagMonitor.emit("tag_removed", { blockId, removedTag: tagToRemove });

            // Re-render
            if (scope === "doc") {
                await this.renderDocumentTags(blockId, editorEl);
            } else {
                const blockEl = editorEl.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement;
                if (blockEl) this.renderSingleBlockElement(blockEl);
            }

            showMessage(`已移除标签 #${tagToRemove}`, 2000, "info");
        } catch (err) {
            console.error("[SupertagRenderer] Failed to remove tag from block:", err);
            showMessage("移除标签失败", 3000, "error");
        }
    }

    private static escapeHtml(str: string): string {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
}
