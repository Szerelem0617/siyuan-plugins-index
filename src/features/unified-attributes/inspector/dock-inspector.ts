/**
 * dock-inspector.ts
 *
 * 注册并管理 IndexOS 右侧栏常驻属性检查器 Dock 面板
 */

import type { Plugin } from "siyuan";
import DockAttributeInspector from "./DockAttributeInspector.svelte";
import { activeBlockTracker } from "./active-block-tracker";

export const DOCK_TYPE = "indexos_inspector_dock";

let inspectorSvelteInstance: any = null;

export function initDockInspector(plugin: Plugin) {
    activeBlockTracker.init();

    plugin.addDock({
        config: {
            position: "RightTop",
            size: { width: 300, height: 0 },
            icon: "iconTags",
            title: "IndexOS 属性",
            index: 3
        },
        data: {},
        type: DOCK_TYPE,
        init() {
            // this.element 为 Dock 的内容容器 DOM
            const container = (this as any).element;
            if (!container) return;

            container.innerHTML = `<div id="indexos-dock-inspector-root" style="height: 100%; width: 100%; display: flex; flex-direction: column; overflow: hidden;"></div>`;
            const root = container.querySelector("#indexos-dock-inspector-root");

            if (root) {
                inspectorSvelteInstance = new DockAttributeInspector({
                    target: root
                });
            }
        },
        destroy() {
            if (inspectorSvelteInstance) {
                inspectorSvelteInstance.$destroy();
                inspectorSvelteInstance = null;
            }
        }
    });
}
