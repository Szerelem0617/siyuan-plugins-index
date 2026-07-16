import { post } from "../../../shared/api-client/request";
import { showMessage } from "siyuan";
import { supertagMonitor } from "./supertag";
import { globalSupertagsCache } from "../registration";
import { parseSupertags, serializeSupertags } from "../utils/supertag-helper";

export class SupertagRenderer {
    private static renderedMap = new Map<string, string[]>();

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
    private static async renderDocumentTags(docId: string, editorEl: HTMLElement) {
        try {
            const titleEl = editorEl.querySelector(".protyle-title");
            if (!titleEl) return;

            // Query page attributes
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: docId });
            const attrs = attrsRes || {};
            const rawTags = attrs["custom-supertags"];

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

            if (tags.length === 0) {
                container.style.display = "none";
                return;
            }

            container.style.display = "flex";
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
     * Scan the DOM for blocks carrying `custom-supertags` and render inline pills.
     */
    private static renderBlockTags(editorEl: HTMLElement) {
        const blocks = editorEl.querySelectorAll("[custom-supertags]");
        blocks.forEach((block: any) => {
            const blockId = block.getAttribute("data-node-id");
            if (!blockId) return;

            const rawTags = block.getAttribute("custom-supertags");
            const tags = parseSupertags(rawTags);

            // Find or create Siyuan's native attribute container inside the block
            let attrEl = block.querySelector(".protyle-attr") as HTMLElement;
            if (!attrEl) {
                attrEl = document.createElement("div");
                attrEl.className = "protyle-attr";
                attrEl.setAttribute("contenteditable", "false");
                block.appendChild(attrEl);
            }

            // Find or create our supertags container inside Siyuan's native attribute bar
            let container = attrEl.querySelector(".index-block-supertags") as HTMLElement;
            
            if (tags.length === 0) {
                if (container) container.remove();
                return;
            }

            if (container) {
                container.innerHTML = "";
            } else {
                container = document.createElement("div");
                container.className = "index-block-supertags";
                container.style.cssText = "display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; vertical-align: middle;";
                
                // Insert container at the front of Siyuan's attribute bar
                if (attrEl.firstChild) {
                    attrEl.insertBefore(container, attrEl.firstChild);
                } else {
                    attrEl.appendChild(container);
                }
            }

            tags.forEach(tag => {
                const pill = this.createTagPill(tag, async () => {
                    await this.removeTagFromBlock(blockId, tag, "block", editorEl);
                }, true);
                container.appendChild(pill);
            });
        });
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
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            onRemove();
        });

        pill.appendChild(closeBtn);
        return pill;
    }

    /**
     * Helper to write tag removal back to block attributes.
     */
    private static async removeTagFromBlock(blockId: string, tagToRemove: string, type: "page" | "block", editorEl: HTMLElement) {
        try {
            // Get current attributes
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes || {};
            const rawTags = attrs["custom-supertags"];

            const tags = parseSupertags(rawTags);

            const updatedTags = tags.filter(t => t !== tagToRemove);
            globalSupertagsCache.set(blockId, updatedTags);
            
            // Write back
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-supertags": serializeSupertags(updatedTags)
                }
            });

            // Trigger tag_removed commands explicitly
            await supertagMonitor.processRemovedTag(blockId, tagToRemove);

            // Re-render visually instantly
            if (type === "page") {
                await this.renderDocumentTags(blockId, editorEl);
            } else {
                const blockEl = editorEl.querySelector(`[data-node-id="${blockId}"]`);
                if (blockEl) {
                    blockEl.setAttribute("custom-supertags", updatedTags.length > 0 ? JSON.stringify(updatedTags) : "");
                    this.renderBlockTags(editorEl);
                }
            }

            showMessage(`已移除超级标签: #${tagToRemove}`);
        } catch (e) {
            console.error("[SupertagRenderer] Failed to remove tag:", tagToRemove, e);
            showMessage("移除标签失败", 3000, "error");
        }
    }
}
