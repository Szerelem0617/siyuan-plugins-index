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

export function updateDockDom(plugin: Plugin) {
    try {
        const dockType = plugin.name + DOCK_TYPE;
        const dockButtons = document.querySelectorAll(`[data-type="${dockType}"], [data-type="${DOCK_TYPE}"], [data-type*="indexos_inspector_dock"]`);
        dockButtons.forEach((btn: any) => {
            btn.setAttribute("aria-label", "属性管理");
            btn.setAttribute("title", "属性管理");
            btn.setAttribute("data-title", "属性管理");
            const useEl = btn.querySelector("use");
            if (useEl) {
                useEl.setAttribute("xlink:href", "#iconAttr");
                useEl.setAttribute("href", "#iconAttr");
            }
        });

        const dockHeaderTitles = document.querySelectorAll(`.layout-tab-bar .item[data-type="${dockType}"] .item__text, .layout-tab-bar .item[data-type*="indexos_inspector_dock"] .item__text`);
        dockHeaderTitles.forEach((titleEl: any) => {
            titleEl.textContent = "属性管理";
        });
        const dockHeaderIcons = document.querySelectorAll(`.layout-tab-bar .item[data-type="${dockType}"] use, .layout-tab-bar .item[data-type*="indexos_inspector_dock"] use`);
        dockHeaderIcons.forEach((useEl: any) => {
            useEl.setAttribute("xlink:href", "#iconAttr");
            useEl.setAttribute("href", "#iconAttr");
        });
    } catch (_) {}
}

export function initDockInspector(plugin: Plugin) {
    activeBlockTracker.init();

    plugin.addDock({
        config: {
            position: "RightTop",
            size: { width: 300, height: 0 },
            icon: "iconAttr",
            title: "属性管理",
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
            updateDockDom(plugin);
        },
        destroy() {
            if (inspectorSvelteInstance) {
                inspectorSvelteInstance.$destroy();
                inspectorSvelteInstance = null;
            }
            activeBlockTracker.clearHighlight();
        }
    });

    updateDockDom(plugin);
    setTimeout(() => updateDockDom(plugin), 150);
    setTimeout(() => updateDockDom(plugin), 600);
    setTimeout(() => updateDockDom(plugin), 1500);
}
