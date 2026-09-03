/**
 * insert-supertag-view.ts
 * 
 * 在当前光标/指定块下方就地插入指定超级标签的虚拟投影多维表格
 */

import { Dialog, showMessage } from "siyuan";
import { getSupertagDbRecords } from "../core/supertag-entity";
import { executeWritableSql } from "../../sqlite/sqlite-manager";
import { supertagBinder } from "../core/supertag-binder";
import { SupertagAVProjector } from "./supertag-av-projector";

export async function openSupertagViewSelectorDialog(insertAfterBlockId?: string | null) {
    const records = await getSupertagDbRecords();
    const tags = records.map(r => r.typeTag).filter(Boolean);

    if (tags.length === 0) {
        showMessage("当前暂无已定义的超级标签，请先在超级标签面板中创建", 4000, "info");
        return;
    }

    const dialog = new Dialog({
        title: "插入超级标签多维表格",
        content: `
            <div class="b3-dialog__content" style="padding: 16px; max-height: 420px; display: flex; flex-direction: column; gap: 12px;">
                <input class="b3-text-field fn__flex-1" id="supertag-view-search" placeholder="搜索超级标签..." style="width: 100%; box-sizing: border-box;" />
                <div id="supertag-view-list" style="overflow-y: auto; max-height: 320px; display: flex; flex-direction: column; gap: 6px;"></div>
            </div>
        `,
        width: "420px"
    });

    const searchInput = dialog.element.querySelector("#supertag-view-search") as HTMLInputElement;
    const listContainer = dialog.element.querySelector("#supertag-view-list") as HTMLElement;

    function renderList(query = "") {
        const lower = query.toLowerCase().trim();
        const filtered = tags.filter(t => !lower || t.toLowerCase().includes(lower));

        listContainer.innerHTML = filtered.map(tag => `
            <div class="b3-list-item b3-list-item--hide-action" data-tag="${tag}" style="cursor: pointer; padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--b3-border-color);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 600; color: var(--b3-theme-primary);">#${tag}</span>
                </div>
                <span class="b3-button b3-button--small" style="font-size: 11px; padding: 2px 8px;">插入表格</span>
            </div>
        `).join("");

        listContainer.querySelectorAll(".b3-list-item").forEach(item => {
            item.addEventListener("click", async () => {
                const tag = item.getAttribute("data-tag");
                if (!tag) return;
                dialog.destroy();
                await insertSupertagViewAt(tag, insertAfterBlockId);
            });
        });
    }

    searchInput?.addEventListener("input", () => {
        renderList(searchInput.value);
    });

    renderList();
    setTimeout(() => searchInput?.focus(), 50);
}

export async function insertSupertagViewAt(tag: string, insertAfterBlockId?: string | null) {
    const cleanTag = tag.replace(/^#+/, "").trim().toLowerCase();
    showMessage(`正在为 #${cleanTag} 插入多维表格视图...`, 2000, "info");

    try {
        const ddlOptions: any = {};
        if (insertAfterBlockId) {
            ddlOptions.insertAfterBlockId = insertAfterBlockId;
        }

        const ddlRes = await executeWritableSql(`CREATE TABLE "${cleanTag}" ( "主键" BLOCK );`, ddlOptions);
        const avId = ddlRes?.avId;

        if (avId) {
            await supertagBinder.setPref(cleanTag, avId);
            SupertagAVProjector.getInstance().bindTagToAV(cleanTag, avId);
            showMessage(`✓ 已就地插入 #${cleanTag} 多维表格视图！`, 3000);
        } else {
            showMessage("插入多维表格失败，未能解析新建数据库标识", 4000, "error");
        }
    } catch (e: any) {
        console.error("[insertSupertagViewAt] Error:", e);
        showMessage(`插入失败: ${e.message || e}`, 5000, "error");
    }
}
