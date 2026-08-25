/**
 * av-projection-toggle.ts
 *
 * 数据库界面原地「虚拟投影 / 原生物理数据」切换胶囊按钮注入器
 *
 * 机制：
 * 1. 自动监听编辑区内所有 Attribute View 头部 (.av__header 与 .av 节点)；
 * 2. 深度多渠道识别该 AV 是否关联 Supertag（绑定记录 / 偏好设置 / 数据库名称 supertag-* / SQL 块属性）；
 * 3. 关联时在视图工具栏插入轻量原生级胶囊按钮：
 *    - 投影模式：[ ⚡ #tag (投影) ] (点击切回物理数据)
 *    - 物理模式：[ 📁 物理数据 ] (点击开启标签虚拟投影)
 * 4. 点击后 0 延迟就地刷新视图，并在控制台输出完整的诊断调试日志。
 */

import { supertagAVProjector } from "./supertag-av-projector";
import { supertagBinder } from "../core/supertag-binder";
import { post } from "../../../shared/api-client/request";

export class AVProjectionToggleManager {
    private static instance: AVProjectionToggleManager | null = null;
    private observer: MutationObserver | null = null;
    private isObserving = false;
    private sqlCheckingAvIds = new Set<string>();

    public static getInstance(): AVProjectionToggleManager {
        if (!AVProjectionToggleManager.instance) {
            AVProjectionToggleManager.instance = new AVProjectionToggleManager();
        }
        return AVProjectionToggleManager.instance;
    }

    public init() {
        if (this.isObserving || typeof window === "undefined") return;
        this.isObserving = true;

        // 首次全域扫描
        this.scanAndMountToggles();

        // 监听 DOM 树变化，实时挂载/更新切换胶囊按钮
        let timer: any = null;
        this.observer = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                this.scanAndMountToggles();
            }, 50);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // 窗口尺寸变化与全局点击时兜底补齐扫描
        window.addEventListener("resize", () => this.scanAndMountToggles(), { passive: true });
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
        // 查找页面中所有 AV 节点
        const avHeaders = document.querySelectorAll(".av__header");
        const avBlocks = document.querySelectorAll(".av, div[data-type='NodeAttributeView']");

        const processedHeaders = new Set<HTMLElement>();

        avHeaders.forEach((headerEl) => {
            processedHeaders.add(headerEl as HTMLElement);
            this.mountToggleToHeader(headerEl as HTMLElement);
        });

        avBlocks.forEach((blockEl) => {
            const header = blockEl.querySelector(".av__header");
            if (header && !processedHeaders.has(header as HTMLElement)) {
                processedHeaders.add(header as HTMLElement);
                this.mountToggleToHeader(header as HTMLElement);
            }
        });
    }

    private mountToggleToHeader(headerEl: HTMLElement) {
        // 1. 多层级查找所属 AV 节点的 avId
        const avRootNode = headerEl.closest(".av") || headerEl.closest("[data-type='NodeAttributeView']") || headerEl.parentElement;
        let avId = avRootNode?.getAttribute("data-av-id") ||
                   headerEl.getAttribute("data-av-id") ||
                   avRootNode?.getAttribute("data-node-id") ||
                   headerEl.getAttribute("data-node-id") ||
                   "";

        if (!avId) {
            // 尝试从 view-id 或内部元素提取
            const viewTab = headerEl.querySelector(".layout-tab-bar .item--focus, .layout-tab-bar .item");
            const viewId = viewTab?.getAttribute("data-id");
            if (!viewId) return;
        }

        // 2. 多渠道解析绑定的 Supertag
        let boundTag = this.resolveBoundTag(avId, avRootNode, headerEl);

        if (!boundTag && avId && !this.sqlCheckingAvIds.has(avId)) {
            // 异步从思源块属性中解析（如 supertag-测试一下）
            this.asyncResolveBoundTagFromSql(avId, headerEl);
            return;
        }

        if (!boundTag) {
            const existingBtn = headerEl.querySelector(".indexos-av-mode-toggle");
            if (existingBtn) existingBtn.remove();
            return;
        }

        // 3. 寻找挂载容器 (.av__views)
        const viewsContainer = headerEl.querySelector(".av__views") as HTMLElement || headerEl;
        if (!viewsContainer) return;

        const currentIsVirtual = supertagAVProjector.isVirtualProjection(avId);

        let toggleBtn = headerEl.querySelector(".indexos-av-mode-toggle") as HTMLButtonElement | null;
        if (!toggleBtn) {
            toggleBtn = document.createElement("button");
            toggleBtn.className = "indexos-av-mode-toggle";
            toggleBtn.setAttribute("data-av-id", avId);
            toggleBtn.setAttribute("data-type", "indexos-av-mode-toggle");

            // 拦截 mousedown 防止思源原生选区/聚焦逻辑拦截吞噬点击
            toggleBtn.addEventListener("mousedown", (e) => {
                e.stopPropagation();
            });

            toggleBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleBtn!.style.opacity = "0.5";
                try {
                    const nextState = await supertagAVProjector.toggleProjectionMode(avId, boundTag);
                    this.updateToggleState(toggleBtn!, nextState, boundTag);
                } catch (err) {
                    console.error(`[AVProjectionToggle] 点击切换模式异常:`, err);
                } finally {
                    toggleBtn!.style.opacity = "1";
                }
            });

            // 智能定位插入：优先插入在右侧 .av__new (新建按钮) 前面，或 .fn__flex-1 弹性空白前面
            const avNewBtn = viewsContainer.querySelector(".av__new");
            const flexSpacer = viewsContainer.querySelector(".fn__flex-1");

            if (avNewBtn) {
                viewsContainer.insertBefore(toggleBtn, avNewBtn);
            } else if (flexSpacer) {
                viewsContainer.insertBefore(toggleBtn, flexSpacer);
            } else {
                viewsContainer.appendChild(toggleBtn);
            }
        }

        this.updateToggleState(toggleBtn, currentIsVirtual, boundTag);
    }

    /**
     * 多渠道同步解析 AV 绑定的 Supertag 名称
     */
    private resolveBoundTag(avId: string, avRootNode: HTMLElement | null, headerEl: HTMLElement): string | undefined {
        if (avId) {
            // 渠道 1: 内存 Projector 映射
            const tag1 = supertagAVProjector.getBoundTag(avId);
            if (tag1) return tag1.replace(/^#/, "");

            // 渠道 2: Binder 偏好设置
            const tag2 = supertagBinder.findTagByAvId(avId);
            if (tag2) return tag2.replace(/^#/, "");
        }

        // 渠道 3: DOM 节点属性与标题识别 (例如 name="supertag-测试一下" 或 custom-av-name="supertag-测试一下")
        const namesToCheck = [
            avRootNode?.getAttribute("custom-av-name"),
            avRootNode?.getAttribute("name"),
            headerEl.getAttribute("custom-av-name"),
            headerEl.getAttribute("name"),
            avRootNode?.querySelector(".av__title")?.textContent,
            headerEl.querySelector(".av__title")?.textContent,
        ].filter(Boolean);

        for (const rawName of namesToCheck) {
            const trimmed = String(rawName).trim();
            const match = trimmed.match(/^supertag-([^\s\/\.]+)/i) || trimmed.match(/supertag-([^\s\/\.]+)/i);
            if (match && match[1]) {
                const inferredTag = match[1].trim();
                if (avId) {
                    supertagBinder.setPref(inferredTag, avId);
                    supertagAVProjector.bindTagToAV(inferredTag, avId);
                }
                return inferredTag;
            }
        }

        return undefined;
    }

    /**
     * 异步从思源块数据库查询数据库名称 (兜底识别)
     */
    private async asyncResolveBoundTagFromSql(avId: string, headerEl: HTMLElement) {
        this.sqlCheckingAvIds.add(avId);
        try {
            const rows = await post("/api/query/sql", {
                stmt: `SELECT content, ial FROM blocks WHERE id = '${avId}' OR ial LIKE '%${avId}%' LIMIT 1;`
            });
            if (rows && rows.length > 0) {
                const content = rows[0].content || "";
                const ial = rows[0].ial || "";
                const combined = `${content} ${ial}`;
                const match = combined.match(/supertag-([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/i);
                if (match && match[1]) {
                    const tag = match[1].trim();
                    await supertagBinder.setPref(tag, avId);
                    await supertagAVProjector.bindTagToAV(tag, avId);
                    this.mountToggleToHeader(headerEl);
                }
            }
        } catch (err) {
            console.warn(`[AVProjectionToggle] SQL 解析 AV(${avId}) 失败:`, err);
        } finally {
            this.sqlCheckingAvIds.delete(avId);
        }
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
