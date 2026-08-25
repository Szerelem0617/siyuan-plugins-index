/**
 * rerender-dispatcher.ts
 *
 * 就地即时重绘调度器
 * 负责在虚拟投影状态切换、数据更新、反向编辑时，精准通知活动 Protyle 编辑器实例和 WebSocket 就地重绘，0 闪烁
 */

/**
 * 递归遍历所有挂载的活动 Protyle 编辑器实例 (Tab 树、浮动弹窗、块面板、移动端)
 */
export function getAllActiveEditors(): any[] {
    const editors: any[] = [];
    try {
        const siyuan = (window as any).siyuan;
        if (!siyuan) return editors;

        // 1. 遍历 Tab 树形布局 (window.siyuan.layout.layout)
        const getTabs = (layout: any) => {
            if (!layout || !layout.children) return;
            for (let i = 0; i < layout.children.length; i++) {
                const item = layout.children[i];
                if (item && item.model) {
                    if (item.model.editor) {
                        editors.push(item.model.editor);
                    }
                    if (item.model.editors?.edit) {
                        editors.push(item.model.editors.edit);
                    }
                } else if (item) {
                    getTabs(item);
                }
            }
        };

        if (siyuan.layout?.layout) {
            getTabs(siyuan.layout.layout);
        }

        // 2. 遍历浮动弹窗与面板 (dialogs & blockPanels)
        if (Array.isArray(siyuan.dialogs)) {
            siyuan.dialogs.forEach((d: any) => {
                if (d.editors) {
                    Object.values(d.editors).forEach((e: any) => {
                        if (e) editors.push(e);
                    });
                }
            });
        }

        if (Array.isArray(siyuan.blockPanels)) {
            siyuan.blockPanels.forEach((bp: any) => {
                if (Array.isArray(bp.editors)) {
                    bp.editors.forEach((e: any) => {
                        if (e) editors.push(e);
                    });
                }
            });
        }

        // 3. 移动端支持
        if (siyuan.mobile?.editor) {
            editors.push(siyuan.mobile.editor);
        }
        if (siyuan.mobile?.popEditor) {
            editors.push(siyuan.mobile.popEditor);
        }
    } catch (e) {
        console.warn("[RerenderDispatcher] getAllActiveEditors 异常:", e);
    }
    return editors;
}

/**
 * 通知当前前端编辑器即时重绘指定 AV 块 (无需手动刷新页面)
 */
export function notifyFrontendToRerender(avId: string, blockId?: string) {
    const cleanAvId = (avId || "").trim();
    if (!cleanAvId) return;

    // 1. 精准遍历所有活动 Tab 与 Protyle 实例
    try {
        const editors = getAllActiveEditors();

        for (const ed of editors) {
            try {
                const protyle = ed?.protyle || ed;
                const wysiwygEl = protyle?.wysiwyg?.element || protyle?.element;
                if (wysiwygEl) {
                    const avNodes = wysiwygEl.querySelectorAll(`div[data-type="NodeAttributeView"], .av[data-av-id="${cleanAvId}"]`);
                    avNodes.forEach((node: HTMLElement) => {
                        node.removeAttribute("data-render");
                        node.removeAttribute("data-rendering");
                    });
                }

                // ⚡ 直接向该 Protyle 的内置 WebSocket 模型派发原生 refreshAttributeView 事件
                if (protyle?.ws?.ws) {
                    const msgPayload = JSON.stringify({
                        cmd: "refreshAttributeView",
                        data: { id: cleanAvId }
                    });
                    protyle.ws.ws.dispatchEvent(new MessageEvent("message", { data: msgPayload }));
                }

                if (typeof ed?.reload === "function") {
                    ed.reload(false);
                } else if (typeof protyle?.reload === "function") {
                    protyle.reload(false);
                }
            } catch (err) {
                console.warn(`[RerenderDispatcher] 单个编辑器刷新异常:`, err);
            }
        }

        // 兜底检测全局 activeProtyleInstance
        const globalProtyle = (window as any).activeProtyleInstance;
        if (globalProtyle && !editors.includes(globalProtyle)) {
            try {
                const wysiwygEl = globalProtyle?.wysiwyg?.element || globalProtyle?.element;
                if (wysiwygEl) {
                    const avNodes = wysiwygEl.querySelectorAll(`div[data-type="NodeAttributeView"], .av[data-av-id="${cleanAvId}"]`);
                    avNodes.forEach((node: HTMLElement) => {
                        node.removeAttribute("data-render");
                        node.removeAttribute("data-rendering");
                    });
                }
                if (typeof globalProtyle.reload === "function") {
                    globalProtyle.reload(false);
                }
            } catch (_) {}
        }
    } catch (layoutErr) {
        console.warn(`⚠️ [RerenderDispatcher] Layout 遍历触发异常:`, layoutErr);
    }

    // 2. 补充派发全局原生 WebSocket 广播事件
    try {
        const msgPayload = JSON.stringify({
            cmd: "refreshAttributeView",
            data: { id: cleanAvId }
        });

        const siyuanWs = (window as any).siyuan?.ws?.ws;
        if (siyuanWs) {
            siyuanWs.dispatchEvent(new MessageEvent("message", { data: msgPayload }));
        }
    } catch (_) {}

    // 3. 全局 DOM 补齐标记清理与轻量级 resize 事件广播
    try {
        const els = document.querySelectorAll(`div[data-type="NodeAttributeView"], .av`);
        els.forEach((el: any) => {
            const curAvId = el.getAttribute("data-av-id") || el.querySelector(".av")?.getAttribute("data-av-id") || el.getAttribute("data-node-id");
            if (curAvId === cleanAvId || (blockId && el.getAttribute("data-node-id") === blockId)) {
                el.removeAttribute("data-render");
                el.removeAttribute("data-rendering");
            }
        });
        window.dispatchEvent(new Event("resize"));
    } catch (_) {}

    // 4. 异步刷新切换按钮状态
    setTimeout(async () => {
        try {
            const { avProjectionToggle } = await import("./av-projection-toggle");
            avProjectionToggle.scanAndMountToggles();
        } catch (_) {}
    }, 50);
}
