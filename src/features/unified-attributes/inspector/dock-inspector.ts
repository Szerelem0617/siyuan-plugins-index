/**
 * dock-inspector.ts
 *
 * 注册并管理 IndexOS 右侧栏常驻属性检查器 Dock 面板
 */

import type { Plugin } from "siyuan";
import DockAttributeInspector from "./DockAttributeInspector.svelte";
import { activeBlockTracker } from "./active-block-tracker";
import { settings } from "../../../core/settings";

export const DOCK_TYPE = "indexos_inspector_dock";

let inspectorSvelteInstance: any = null;

export function updateDockDom(plugin: Plugin) {
    try {
        const isDev = !!settings.get("devMode");
        const dockType = plugin.name + DOCK_TYPE;
        const dockButtons = document.querySelectorAll(`[data-type="${dockType}"], [data-type="${DOCK_TYPE}"], [data-type*="indexos_inspector_dock"]`);
        dockButtons.forEach((btn: any) => {
            if (!isDev) {
                btn.style.display = "none";
                btn.classList.add("fn__none");
                return;
            }
            btn.style.display = "";
            btn.classList.remove("fn__none");
            btn.setAttribute("aria-label", "属性管理");
            btn.setAttribute("title", "属性管理");
            btn.setAttribute("data-title", "属性管理");
            const useEl = btn.querySelector("use");
            if (useEl) {
                useEl.setAttribute("xlink:href", "#iconAttr");
                useEl.setAttribute("href", "#iconAttr");
            }
        });

        const dockHeaderTitles = document.querySelectorAll(`.layout-tab-bar .item[data-type="${dockType}"], .layout-tab-bar .item[data-type*="indexos_inspector_dock"]`);
        dockHeaderTitles.forEach((item: any) => {
            if (!isDev) {
                item.style.display = "none";
                item.classList.add("fn__none");
                return;
            }
            item.style.display = "";
            item.classList.remove("fn__none");
            const titleEl = item.querySelector(".item__text");
            if (titleEl) titleEl.textContent = "属性管理";
            const useEl = item.querySelector("use");
            if (useEl) {
                useEl.setAttribute("xlink:href", "#iconAttr");
                useEl.setAttribute("href", "#iconAttr");
            }
        });
    } catch (_) {}
}

export function destroyDockInspector(plugin: Plugin) {
    activeBlockTracker.destroy();
    activeBlockTracker.clearHighlight();
    updateDockDom(plugin);
}

export function initDockInspector(plugin: Plugin) {
    if (settings.get("devMode")) {
        activeBlockTracker.init();
    }

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
