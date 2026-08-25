/**
 * active-block-tracker.ts
 *
 * 智能当前聚焦/选定块感知追踪器：
 * 实时精准捕获光标所在块、选区块、列表项提权与当前文档根块，
 * 支持被选定块/页面的蓝色高亮边框提示，以及点击左侧文档树自动切换为整页检查。
 * 
 * 性能优化：仅在“属性管理”界面开启（Dock 面板处于打开/可见状态或弹窗处于激活状态）时生效，
 * 面板未打开时完全休眠，不消耗任何计算资源。
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
    private highlightedEl: HTMLElement | null = null;

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
        this.clearHighlight();
        this.listeners.clear();
    }

    /**
     * 判断当前“属性管理”面板或对话框是否处于实际可见/打开状态
     */
    public isInspectorVisible(): boolean {
        // 1. 检查属性对话框是否开启
        if (document.querySelector(".indexos-dialog, #indexos-inspector-dialog-root")) {
            return true;
        }
        // 2. 检查右侧 Dock 属性管理面板是否已挂载且处于可见状态（未折叠、未隐藏）
        const dockRoot = document.querySelector("#indexos-dock-inspector-root") as HTMLElement | null;
        if (dockRoot && dockRoot.offsetParent !== null && !dockRoot.closest(".fn__none")) {
            return true;
        }
        return false;
    }

    public clearHighlight() {
        if (this.highlightedEl) {
            this.highlightedEl.classList.remove("indexos-inspected-highlight", "indexos-inspected-page-highlight");
            this.highlightedEl = null;
        }
    }

    public subscribe(cb: BlockChangeCallback): () => void {
        this.listeners.add(cb);
        if (this.isInspectorVisible()) {
            if (this.currentCtx) {
                cb(this.currentCtx);
            } else {
                this.detectCurrentActiveBlock();
            }
        }
        return () => {
            this.listeners.delete(cb);
            if (this.listeners.size === 0) {
                this.clearHighlight();
            }
        };
    }

    public setPin(blockId: string | null) {
        this.pinnedBlockId = blockId;
        if (!blockId && this.isInspectorVisible()) {
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

    public forceInspectDocRoot(customRootId?: string) {
        const activeProtyle = (window as any).activeProtyleInstance;
        const rootId = customRootId || activeProtyle?.block?.rootID || activeProtyle?.protyle?.block?.rootID;
        if (rootId) {
            let textSnippet = "当前文档";
            const titleEl = activeProtyle?.element?.querySelector(".protyle-title") as HTMLElement;
            if (titleEl && (!customRootId || customRootId === activeProtyle?.block?.rootID)) {
                textSnippet = (titleEl?.innerText || "当前文档").trim().slice(0, 30);
            }
            this.updateContext({
                blockId: rootId,
                rootId: rootId,
                blockType: "NodeDocument",
                textSnippet: textSnippet || "文档根块",
                isDocRoot: true
            });
        }
    }

    private applyHighlight(ctx: ActiveBlockContext | null) {
        if (!this.isInspectorVisible()) {
            this.clearHighlight();
            return;
        }

        if (this.highlightedEl) {
            this.highlightedEl.classList.remove("indexos-inspected-highlight", "indexos-inspected-page-highlight");
            this.highlightedEl = null;
        }
        if (!ctx || !ctx.blockId) return;

        const activeProtyle = (window as any).activeProtyleInstance;

        // 1. 如果检查的是整篇页面根块 (NodeDocument / isDocRoot)：高亮整个页面编辑区
        if (ctx.isDocRoot || ctx.blockType === "NodeDocument") {
            const pageEditorEl = activeProtyle?.element?.querySelector(".protyle-content") as HTMLElement
                || activeProtyle?.element?.querySelector(".protyle-wysiwyg") as HTMLElement
                || (document.querySelector(".protyle:not(.fn__none) .protyle-content") as HTMLElement)
                || (document.querySelector(".protyle:not(.fn__none) .protyle-wysiwyg") as HTMLElement);

            if (pageEditorEl) {
                pageEditorEl.classList.add("indexos-inspected-page-highlight");
                this.highlightedEl = pageEditorEl;
                return;
            }
        }

        // 2. 如果检查的是具体的内容块：精准定位在 .protyle-wysiwyg 内部的内容块 (绝不框选到顶部的面包屑导航区)
        let blockEl: HTMLElement | null = null;
        if (activeProtyle?.element) {
            blockEl = activeProtyle.element.querySelector(`.protyle-wysiwyg [data-node-id="${ctx.blockId}"]`) as HTMLElement;
        }
        if (!blockEl) {
            blockEl = document.querySelector(`.protyle-wysiwyg [data-node-id="${ctx.blockId}"]`) as HTMLElement;
        }

        if (blockEl) {
            blockEl.classList.add("indexos-inspected-highlight");
            this.highlightedEl = blockEl;
        }
    }

    private handleSelectionChange = () => {
        // 未打开属性管理界面时立即返回，不进行任何计算
        if (!this.isInspectorVisible()) {
            this.clearHighlight();
            return;
        }

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
        // 未打开属性管理界面时立即返回，不进行任何计算
        if (!this.isInspectorVisible()) {
            this.clearHighlight();
            return;
        }

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

        // 🌟 检查是否点击了左侧文档树/文件树区域
        const fileTreeItem = target.closest('.sy__file, [data-type="sidebar-file"], .file-tree, .b3-list-item[data-node-id], .b3-list-item[data-id]') as HTMLElement;
        if (fileTreeItem) {
            const docId = fileTreeItem.getAttribute("data-node-id") || fileTreeItem.getAttribute("data-id") || fileTreeItem.getAttribute("data-doc-id");
            if (docId) {
                this.forceInspectDocRoot(docId);
                return;
            } else {
                setTimeout(() => {
                    if (this.isInspectorVisible()) {
                        this.forceInspectDocRoot();
                    }
                }, 100);
                return;
            }
        }

        this.triggerDetectionDebounced();
    };

    private handleKeyup = (e: KeyboardEvent) => {
        // 未打开属性管理界面时立即返回，不进行任何计算
        if (!this.isInspectorVisible()) {
            this.clearHighlight();
            return;
        }

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
        if (!this.isInspectorVisible()) {
            this.clearHighlight();
            return;
        }

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
                    if (el.getAttribute("data-node-id") && el.getAttribute("data-type") && el.closest(".protyle-wysiwyg")) {
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
            this.applyHighlight(ctx);
            return;
        }
        this.currentCtx = ctx;
        this.applyHighlight(ctx);
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
