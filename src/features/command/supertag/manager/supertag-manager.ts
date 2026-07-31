import { Dialog } from "siyuan";
import SupertagManagerDialog from "./supertag-manager-dialog.svelte";
import { i18n } from "../../../../shared/utils";

import { settings } from "../../../../core/settings";

export class SupertagManager {
    private observer: MutationObserver | null = null;

    init() {
        this.updateState();
    }

    updateState() {
        const isDev = !!settings.get("devMode");
        if (isDev) {
            this.inject();
            if (!this.observer) {
                this.startObserver();
            }
        } else {
            this.destroy();
        }
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
        if (!settings.get("devMode")) return;
        if (document.getElementById("supertag-management")) {
            return;
        }

        let tagPanels = Array.from(document.querySelectorAll('.sy__tag'));
        if (tagPanels.length === 0) {
            tagPanels = Array.from(document.querySelectorAll('.layout-tab-container > div[data-type="tag"], .layout-tab-container > div[data-type="dock-tag"]'));
        }
        if (tagPanels.length === 0) return;

        tagPanels.forEach(panel => {
            const blockIcons = panel.querySelector('.block__icons');
            if (blockIcons && !panel.querySelector('#supertag-management')) {
                const html = `
                <div id="supertag-management" class="b3-list-item indexos-btn-bordered" style="margin: 6px 8px 4px; padding: 6px 12px; width: calc(100% - 16px); box-sizing: border-box; justify-content: center; background: transparent !important; border: 1px solid var(--indexos-ice-shadow) !important; border-radius: 4px; cursor: pointer; transition: all 0.15s ease;">
                    <svg class="b3-list-item__graphic" style="color: var(--indexos-accent-primary); width: 13px; height: 13px; flex-shrink: 0; margin-right: 6px;"><use xlink:href="#iconSettings"></use></svg>
                    <span class="b3-list-item__text" style="font-weight: 600; font-size: 12px; color: var(--indexos-accent-primary); flex: none;">
                        ${i18n.supertagManager.title}
                    </span>
                </div>`;

                blockIcons.insertAdjacentHTML('afterend', html);

                const mgmtBtn = panel.querySelector('#supertag-management');
                if (mgmtBtn) {
                    mgmtBtn.addEventListener("click", (e) => this.openDialog(e));
                }
            }
        });
    }

    private startObserver() {
        this.observer = new MutationObserver(() => {
            if (!document.getElementById("supertag-management")) {
                this.inject();
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    private openDialog(e: Event) {
        e.stopPropagation();
        e.preventDefault();

        const dialog = new Dialog({
            title: i18n.supertagManager.title,
            content: `<div id="supertag-manager-container" style="height: 100%;"></div>`,
            width: "720px",
            height: "520px",
        });
        dialog.element.classList.add("indexos-dialog");
        dialog.element.querySelector('.b3-dialog__header')?.remove();

        new SupertagManagerDialog({
            target: dialog.element.querySelector("#supertag-manager-container"),
            props: {
                dialog
            }
        });
    }
}

export const supertagManager = new SupertagManager();
