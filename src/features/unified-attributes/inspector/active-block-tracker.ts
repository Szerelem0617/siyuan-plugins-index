/**
 * active-block-tracker.ts
 *
 * 智能当前聚焦/选定块感知追踪器：
 * 实时精准捕获光标所在块、选区块、列表项提权与当前文档根块
 */

export interface ActiveBlockContext {
    blockId: string;
    rootId: string;
    blockType: string;
    textSnippet: string;
    isDocRoot: boolean;
}

type BlockChangeCallback = (ctx: ActiveBlockContext | null) => void;

export class ActiveBlockTracker {
    private listeners: Set<BlockChangeCallback> = new Set();
    private currentCtx: ActiveBlockContext | null = null;
    private pinnedBlockId: string | null = null;
    private debounceTimer: any = null;
    private isInitialized = false;

    public init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        document.addEventListener("selectionchange", this.handleSelectionChange);
        document.addEventListener("click", this.handleClick);
        document.addEventListener("keyup", this.handleKeyup);
    }

    public destroy() {
        this.isInitialized = false;
        document.removeEventListener("selectionchange", this.handleSelectionChange);
        document.removeEventListener("click", this.handleClick);
        document.removeEventListener("keyup", this.handleKeyup);
        this.listeners.clear();
    }

    public subscribe(cb: BlockChangeCallback): () => void {
        this.listeners.add(cb);
        if (this.currentCtx) {
            cb(this.currentCtx);
        } else {
            this.detectCurrentActiveBlock();
        }
        return () => this.listeners.delete(cb);
    }

    public setPin(blockId: string | null) {
        this.pinnedBlockId = blockId;
        if (!blockId) {
            this.detectCurrentActiveBlock();
        }
    }

    public isPinned(): boolean {
        return !!this.pinnedBlockId;
    }

    public getPinnedId(): string | null {
        return this.pinnedBlockId;
    }

    public getCurrentContext(): ActiveBlockContext | null {
        return this.currentCtx;
    }

    public forceInspectDocRoot() {
        const activeProtyle = (window as any).activeProtyleInstance;
        const rootId = activeProtyle?.block?.rootID || activeProtyle?.protyle?.block?.rootID;
        if (rootId) {
            const titleEl = activeProtyle?.element?.querySelector(".protyle-title") as HTMLElement;
            const textSnippet = (titleEl?.innerText || "当前文档").trim().slice(0, 30);
            this.updateContext({
                blockId: rootId,
                rootId: rootId,
                blockType: "NodeDocument",
                textSnippet: textSnippet || "文档根块",
                isDocRoot: true
            });
        }
    }

    private handleSelectionChange = () => {
        const active = document.activeElement as HTMLElement | null;
        if (
            active && (
                active.closest(".sy__indexos_inspector_dock") || 
                active.closest(".indexos-dock-inspector") || 
                active.closest(".b3-dialog") ||
                active.closest(".b3-menu") ||
                active.closest(".indexos-dropdown")
            )
        ) {
            return;
        }
        this.triggerDetectionDebounced();
    };

    private handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (
            target.closest(".sy__indexos_inspector_dock") || 
            target.closest(".indexos-dock-inspector") ||
            target.closest(".b3-dialog") ||
            target.closest(".b3-menu") ||
            target.closest(".indexos-dropdown") ||
            target.closest(".protyle-util")
        ) {
            // 点击属性面板自身/菜单/弹窗，不触发块切走
            return;
        }
        this.triggerDetectionDebounced();
    };

    private handleKeyup = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (
            target.closest(".sy__indexos_inspector_dock") || 
            target.closest(".indexos-dock-inspector") ||
            target.closest(".b3-dialog")
        ) {
            return;
        }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter"].includes(e.key)) {
            this.triggerDetectionDebounced();
        }
    };

    private triggerDetectionDebounced() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.detectCurrentActiveBlock();
        }, 80);
    }

    public detectCurrentActiveBlock() {
        if (this.pinnedBlockId) return;

        const active = document.activeElement as HTMLElement | null;
        if (
            active && (
                active.closest(".sy__indexos_inspector_dock") || 
                active.closest(".indexos-dock-inspector") || 
                active.closest(".b3-dialog") ||
                active.closest(".b3-menu") ||
                active.closest(".indexos-dropdown")
            )
        ) {
            return;
        }

        const sel = window.getSelection();
        let targetEl: HTMLElement | null = null;
        const activeProtyle = (window as any).activeProtyleInstance;
        let rootId = activeProtyle?.block?.rootID || activeProtyle?.protyle?.block?.rootID || "";

        // 1. 优先检查选中块 (.protyle-wysiwyg--select)
        const selectedBlock = document.querySelector(".protyle-wysiwyg--select") as HTMLElement;
        if (selectedBlock && selectedBlock.getAttribute("data-node-id")) {
            targetEl = selectedBlock;
        }

        // 2. 检查光标所在位置
        if (!targetEl && sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            let node: Node | null = range.startContainer;

            // 检查是否在文档标题区
            if (node) {
                const titleNode = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest(".protyle-title");
                if (titleNode && rootId) {
                    const textSnippet = (titleNode as HTMLElement).innerText?.trim().slice(0, 30) || "文档标题";
                    this.updateContext({
                        blockId: rootId,
                        rootId: rootId,
                        blockType: "NodeDocument",
                        textSnippet,
                        isDocRoot: true
                    });
                    return;
                }
            }

            // 向上查找最近的 block
            while (node && node !== document.body) {
                if (node.nodeType === 1) {
                    const el = node as HTMLElement;
                    if (el.getAttribute("data-node-id") && el.getAttribute("data-type")) {
                        targetEl = el;
                        break;
                    }
                }
                node = node.parentNode;
            }
        }

        // 3. 若处于 NodeListItem 内部的段落 (NodeParagraph)，自动向上提权为 NodeListItem
        if (targetEl && targetEl.getAttribute("data-type") === "NodeParagraph") {
            const parentLi = targetEl.closest('[data-type="NodeListItem"]') as HTMLElement | null;
            if (parentLi && parentLi !== targetEl) {
                targetEl = parentLi;
            }
        }

        // 4. 解析目标块信息
        if (targetEl) {
            const blockId = targetEl.getAttribute("data-node-id") || "";
            const blockType = targetEl.getAttribute("data-type") || "NodeBlock";
            if (!rootId) {
                const protyleContainer = targetEl.closest(".protyle") as HTMLElement;
                rootId = protyleContainer?.getAttribute("data-root-id") || blockId;
            }
            const textSnippet = targetEl.innerText?.trim().replace(/\n/g, " ").slice(0, 32) || "";
            const isDocRoot = blockId === rootId;

            this.updateContext({
                blockId,
                rootId,
                blockType,
                textSnippet,
                isDocRoot
            });
        } else if (!this.currentCtx && rootId) {
            // 仅在首次无上下文时，回退到当前打开文档的根块
            this.updateContext({
                blockId: rootId,
                rootId: rootId,
                blockType: "NodeDocument",
                textSnippet: "当前文档",
                isDocRoot: true
            });
        }
    }

    private updateContext(ctx: ActiveBlockContext) {
        if (this.currentCtx && this.currentCtx.blockId === ctx.blockId && this.currentCtx.blockType === ctx.blockType) {
            return;
        }
        this.currentCtx = ctx;
        this.listeners.forEach(cb => {
            try {
                cb(ctx);
            } catch (err) {
                console.error("[ActiveBlockTracker] Listener error:", err);
            }
        });
    }
}

export const activeBlockTracker = new ActiveBlockTracker();
