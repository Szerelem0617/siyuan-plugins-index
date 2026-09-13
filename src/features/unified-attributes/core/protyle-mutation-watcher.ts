/**
 * protyle-mutation-watcher.ts
 *
 * 方案 E 快轨（Near-Field）：近场 DOM 毫秒级感知观察器
 * 
 * 职责：
 * 1. 监听当前活动 Protyle 编辑器容器 (.protyle-wysiwyg) 的 DOM 结构变动；
 * 2. 在新块 (NodeListItem, NodeParagraph, NodeList, NodeHeading 等) 挂载到 DOM 的微任务阶段 (0ms 级) 立即感知；
 * 3. 彻底消除用户输入模式差异 (回车换行、Slash 菜单键盘/鼠标点选、Markdown * 空格转换、多行粘贴等行为在 DOM 落地层完全统一)；
 * 4. 20ms 微批处理队列合并，快速调用 dispatchScopeEvents 触发级联规则引擎；
 * 5. 与慢轨 (WebSocket 事务流) 共享 1500ms triggerKey 防重锁，天然互斥去重，杜绝重复执行与死循环。
 */

import { dispatchScopeEvents } from "./supertag-trigger";

export class ProtyleMutationWatcher {
    private observer: MutationObserver | null = null;
    private isInitialized = false;
    private pendingBlockIds: Set<string> = new Set();
    private microDebounceTimer: any = null;

    public init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.observer = new MutationObserver(this.handleMutations.bind(this));

        // 监听 document.body 下的所有 childList 变动，内部精准锁定 .protyle-wysiwyg 范围
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    public destroy() {
        if (!this.isInitialized) return;
        this.isInitialized = false;

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.microDebounceTimer) {
            clearTimeout(this.microDebounceTimer);
            this.microDebounceTimer = null;
        }

        this.pendingBlockIds.clear();
    }

    private handleMutations(mutations: MutationRecord[]) {
        for (const mutation of mutations) {
            if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
                continue;
            }

            // 过滤：仅关注发生在 Protyle 编辑器工作区内的变动
            const targetEl = mutation.target as HTMLElement;
            if (!targetEl || (!targetEl.closest?.(".protyle-wysiwyg") && !targetEl.classList?.contains("protyle-wysiwyg"))) {
                continue;
            }

            for (let i = 0; i < mutation.addedNodes.length; i++) {
                const node = mutation.addedNodes[i];
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    continue;
                }

                const element = node as HTMLElement;

                // 严格守卫：忽略插件自身注入的 UI 元素与思源辅助装饰
                if (this.isPluginOrDecorElement(element)) {
                    continue;
                }

                // 收集元素本身或其内部所有带合法 data-node-id 的块
                this.collectBlockIds(element);
            }
        }

        if (this.pendingBlockIds.size > 0) {
            this.scheduleFlush();
        }
    }

    /**
     * 判断是否为插件自身的注入组件或思源属性装饰，避免反向监听死循环
     */
    private isPluginOrDecorElement(el: HTMLElement): boolean {
        const cls = el.className || "";
        if (typeof cls === "string") {
            if (cls.includes("indexos-") ||
                cls.includes("protyle-attr") ||
                cls.includes("protyle-action") ||
                cls.includes("b3-menu") ||
                cls.includes("protyle-hint") ||
                cls.includes("protyle-icons") ||
                cls.includes("protyle-gutters")) {
                return true;
            }
        }
        return false;
    }

    /**
     * 深度收集真实块节点的 blockId
     */
    private collectBlockIds(element: HTMLElement) {
        // 1. 如果元素自身就是真实块节点
        const selfId = element.getAttribute("data-node-id");
        const selfType = element.getAttribute("data-type") || "";

        if (selfId && selfType.startsWith("Node")) {
            this.addBlockCandidate(element, selfId, selfType);
        }

        // 2. 检查其内部嵌套的子块 (如复制粘贴、列表容器 Spin 生成的一组列表项)
        const childBlocks = element.querySelectorAll<HTMLElement>('[data-node-id][data-type^="Node"]');
        for (let i = 0; i < childBlocks.length; i++) {
            const child = childBlocks[i];
            const childId = child.getAttribute("data-node-id");
            const childType = child.getAttribute("data-type") || "";
            if (childId && childType.startsWith("Node") && !this.isPluginOrDecorElement(child)) {
                this.addBlockCandidate(child, childId, childType);
            }
        }
    }

    /**
     * 针对列表容器做展开提权，确保列表项被优先处理
     */
    private addBlockCandidate(element: HTMLElement, blockId: string, blockType: string) {
        if (blockType === "NodeList") {
            // 若为列表容器，提取其所有的直接子列表项 (NodeListItem)
            const listItems = element.querySelectorAll<HTMLElement>(':scope > [data-type="NodeListItem"], :scope > .li');
            if (listItems.length > 0) {
                for (let i = 0; i < listItems.length; i++) {
                    const liId = listItems[i].getAttribute("data-node-id");
                    if (liId) this.pendingBlockIds.add(liId);
                }
                return;
            }
        }

        this.pendingBlockIds.add(blockId);
    }

    /**
     * 20ms 微批处理调度：合并瞬时高频节点注入（如输入法批量上屏或粘贴）
     */
    private scheduleFlush() {
        if (this.microDebounceTimer) {
            return;
        }

        this.microDebounceTimer = setTimeout(async () => {
            this.microDebounceTimer = null;
            const blockIds = Array.from(this.pendingBlockIds);
            this.pendingBlockIds.clear();

            for (const blockId of blockIds) {
                try {
                    // ⚡ 快轨毫秒级触发：直接分发 block_created 事件
                    await dispatchScopeEvents(blockId, "block_created");
                } catch (err) {
                    console.error("[ProtyleMutationWatcher] 快轨分发异常:", blockId, err);
                }
            }
        }, 20);
    }
}

export const protyleMutationWatcher = new ProtyleMutationWatcher();
