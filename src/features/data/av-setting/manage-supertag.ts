import { Dialog } from "siyuan";

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
        // 尝试两种常见的思源 dock 标识： .sy__tag 类 或 data-type="tag"
        // 兼容不同的思源大版本
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
                <div id="supertag-management" class="b3-list-item" style="margin: 4px 8px 0; cursor: pointer;">
                    <svg class="b3-list-item__graphic"><use xlink:href="#iconSettings"></use></svg>
                    <span class="b3-list-item__text" style="font-weight: bold; color: var(--b3-theme-primary);">
                        超级标签管理
                    </span>
                    <span class="b3-list-item__action" title="添加新规则">
                        <svg><use xlink:href="#iconAdd"></use></svg>
                    </span>
                </div>`;

                blockIcons.insertAdjacentHTML('afterend', html);

                // 绑定点击事件
                const mgmtBtn = panel.querySelector('#supertag-management');
                if (mgmtBtn) {
                    mgmtBtn.addEventListener("click", this.openDialog.bind(this));
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

        new Dialog({
            title: "超级标签管理",
            content: `
                <div class="b3-dialog__content" style="padding: 16px;">
                    <p>配置你的超级标签规则...</p>
                    <div id="supertag-config-list"></div>
                </div>
            `,
            width: "600px",
            height: "400px",
        });
    }
}

export const supertagManager = new SupertagManager();
