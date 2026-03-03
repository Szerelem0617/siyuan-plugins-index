import { Dialog } from "siyuan";
import SupertagManagerDialog from "./supertag-manager-dialog.svelte";
import { i18n } from "../../../shared/utils";

export class SupertagManager {
    private observer: MutationObserver | null = null;

    init() {
        // 初始化时尝试注入
        this.inject();
        // 监听 DOM 变化以自动重新注入（当用户切换面板或思源重绘时）
        this.startObserver();
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        const els = document.querySelectorAll("#supertag-management");
        els.forEach(el => el.remove());
    }

    private inject() {
        // 如果已经注入则跳过
        if (document.getElementById("supertag-management")) {
            return;
        }

        // 定位标签面板的容器
        let tagPanels = Array.from(document.querySelectorAll('.sy__tag'));
        if (tagPanels.length === 0) {
            tagPanels = Array.from(document.querySelectorAll('.layout-tab-container > div[data-type="tag"], .layout-tab-container > div[data-type="dock-tag"]'));
        }
        if (tagPanels.length === 0) return;

        tagPanels.forEach(panel => {
            const blockIcons = panel.querySelector('.block__icons');
            // 确保找到了标题栏，并且尚未注入过
            if (blockIcons && !panel.querySelector('#supertag-management')) {
                const html = `
                <div id="supertag-management" class="b3-list-item" style="margin: 4px 8px 0; cursor: pointer; transition: background-color 0.2s;">
                    <svg class="b3-list-item__graphic" style="color: var(--b3-theme-primary);"><use xlink:href="#iconSettings"></use></svg>
                    <span class="b3-list-item__text" style="font-weight: bold; color: var(--b3-theme-primary);">
                        ${i18n.supertagManager.title}
                    </span>
                    <span class="b3-list-item__action" title="${i18n.supertagManager.configRule}">
                        <svg><use xlink:href="#iconLayout"></use></svg>
                    </span>
                </div>`;

                blockIcons.insertAdjacentHTML('afterend', html);

                // 绑定点击事件
                const mgmtBtn = panel.querySelector('#supertag-management');
                if (mgmtBtn) {
                    mgmtBtn.addEventListener("click", (e) => this.openDialog(e));
                }
            }
        });
    }

    private startObserver() {
        this.observer = new MutationObserver(() => {
            // 判断当前 DOM 中是否缺失该元素
            if (!document.getElementById("supertag-management")) {
                this.inject();
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    private openDialog(e: Event) {
        // 防止点击穿透或触发面板其他折叠逻辑
        e.stopPropagation();
        e.preventDefault();

        const dialog = new Dialog({
            title: i18n.supertagManager.title,
            content: `<div id="supertag-manager-container" style="height: 100%;"></div>`,
            width: "600px",
            height: "500px",
        });

        new SupertagManagerDialog({
            target: dialog.element.querySelector("#supertag-manager-container"),
            props: {
                dialog
            }
        });
    }
}

export const supertagManager = new SupertagManager();
