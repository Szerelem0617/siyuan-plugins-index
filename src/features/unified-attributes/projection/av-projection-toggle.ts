/**
 * av-projection-toggle.ts
 *
 * 数据库界面原地「虚拟投影 / 原生物理数据」切换胶囊按钮注入器
 *
 * 机制：
 * 1. 监听 DOM 中渲染的 Attribute View 头部 (.av__header)；
 * 2. 检测该 AV 是否关联了 Supertag；
 * 3. 关联时在视图工具栏插入轻量原生级胶囊按钮：
 *    - 投影模式：[ ⚡ #tag (投影) ] (点击切回物理数据)
 *    - 物理模式：[ 📁 物理数据 ] (点击开启标签虚拟投影)
 * 4. 点击后 0 延迟就地刷新视图，无需打开任何复杂弹窗。
 */

import { supertagAVProjector } from "./supertag-av-projector";
import { supertagBinder } from "../core/supertag-binder";

export class AVProjectionToggleManager {
    private static instance: AVProjectionToggleManager | null = null;
    private observer: MutationObserver | null = null;
    private isObserving = false;

    public static getInstance(): AVProjectionToggleManager {
        if (!AVProjectionToggleManager.instance) {
            AVProjectionToggleManager.instance = new AVProjectionToggleManager();
        }
        return AVProjectionToggleManager.instance;
    }

    public init() {
        if (this.isObserving || typeof window === "undefined") return;
        this.isObserving = true;

        // 首次全局扫描
        this.scanAndMountToggles();

        // 监听 DOM 树变化，实时挂载/更新切换胶囊按钮
        let timer: any = null;
        this.observer = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                this.scanAndMountToggles();
            }, 60);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    public destroy() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.isObserving = false;
        document.querySelectorAll(".indexos-av-mode-toggle").forEach(el => el.remove());
    }

    public scanAndMountToggles() {
        const avHeaders = document.querySelectorAll(".av__header");
        avHeaders.forEach((headerEl: Element) => {
            this.mountToggleToHeader(headerEl as HTMLElement);
        });
    }

    private mountToggleToHeader(headerEl: HTMLElement) {
        // 查找所属 AV 节点的 avId
        const avRootNode = headerEl.closest(".av") || headerEl.closest("[data-type='NodeAttributeView']");
        const avId = avRootNode?.getAttribute("data-av-id") || headerEl.getAttribute("data-av-id") || "";
        if (!avId) return;

        // 检查该 AV 是否关联了 Supertag
        const boundTag = supertagAVProjector.getBoundTag(avId) || supertagBinder.findTagByAvId(avId);
        if (!boundTag) {
            const existingBtn = headerEl.querySelector(".indexos-av-mode-toggle");
            if (existingBtn) existingBtn.remove();
            return;
        }

        const isVirtual = supertagAVProjector.isVirtualProjection(avId);
        const viewsContainer = headerEl.querySelector(".av__views");
        if (!viewsContainer) return;

        let toggleBtn = headerEl.querySelector(".indexos-av-mode-toggle") as HTMLButtonElement | null;
        if (!toggleBtn) {
            toggleBtn = document.createElement("button");
            toggleBtn.className = "indexos-av-mode-toggle";

            toggleBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleBtn!.style.opacity = "0.5";
                try {
                    const nextState = await supertagAVProjector.toggleProjectionMode(avId, boundTag);
                    this.updateToggleState(toggleBtn!, nextState, boundTag);
                } finally {
                    toggleBtn!.style.opacity = "1";
                }
            });

            // 插入到 viewsContainer 中：优先插在 flex-1 弹性空白的前面
            const flexSpacer = viewsContainer.querySelector(".fn__flex-1");
            if (flexSpacer) {
                viewsContainer.insertBefore(toggleBtn, flexSpacer);
            } else {
                viewsContainer.appendChild(toggleBtn);
            }
        }

        this.updateToggleState(toggleBtn, isVirtual, boundTag);
    }

    private updateToggleState(btn: HTMLButtonElement, isVirtual: boolean, tag: string) {
        const cleanTag = tag.replace(/^#/, "").trim();
        btn.className = `indexos-av-mode-toggle ${isVirtual ? "indexos-av-mode-toggle--virtual" : "indexos-av-mode-toggle--physical"}`;
        btn.title = isVirtual
            ? `当前正在查看 #${cleanTag} 标签虚拟投影视图，点击切换回原生物理数据`
            : `当前正在查看原生物理数据视图，点击切换为 #${cleanTag} 标签虚拟投影`;

        btn.innerHTML = `
            <span class="toggle-icon">${isVirtual ? "⚡" : "📁"}</span>
            <span class="toggle-label">${isVirtual ? `#${cleanTag} (投影)` : "物理数据"}</span>
        `;
    }
}

export const avProjectionToggle = AVProjectionToggleManager.getInstance();
