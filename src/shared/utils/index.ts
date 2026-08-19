import { getFrontend, Dialog } from "siyuan";
// We might not import the Plugin class here to avoid circular dependency if possible, 
// but for now we follow the pattern. 
// However, newsrc structure suggests we should define types in core or shared.
// I'll skip importing IndexPlugin for the type definition to keep it generic for now, 
// or use 'any' until we migrate the main class.

/**
 * 延迟函数
 * @param time 时间 (ms)
 */
export function sleep(time: number) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

// i18n 全局实例
export let i18n: any;
export function setI18n(_i18n: any) {
    i18n = _i18n;
}

// 插件全局对象
export let plugin: any; // Type as any for now to avoid dependency on legacy code
export function setPlugin(_plugin: any) {
    plugin = _plugin;
}

export function confirmDialog(title: string, text: string, confirmCallback: () => void, cancelCallback?: () => void, confirmText?: string, cancelText?: string) {
    const dialog = new Dialog({
        title,
        content: `<div class="b3-dialog__content">
            <div class="ft__breakword">${text}</div>
        </div>
        <div class="b3-dialog__action">
            <button class="b3-button b3-button--cancel">${cancelText || i18n.cancel}</button>
            <div class="fn__space"></div>
            <button class="b3-button b3-button--text">${confirmText || i18n.confirm}</button>
        </div>`,
        width: "520px",
    });
    dialog.element.classList.add("indexos-dialog");

    const btns = dialog.element.querySelectorAll(".b3-button");
    btns[0].addEventListener("click", () => {
        dialog.destroy();
        if (cancelCallback) cancelCallback();
    });
    btns[1].addEventListener("click", () => {
        dialog.destroy();
        confirmCallback();
    });
}

/**
 * 替换字符串中的导致异常的字符
 */
export function escapeHtml(unsafe: string) {
    return unsafe
        .split('[').join('\\[')
        .split(']').join('\\]')
        .split('&#39;').join('&apos;')
        .split('\\').join('&#92;')
        .split('"').join('&quot;'); // Added double quote escaping as per recent fixes
}

// 运行环境检测
const frontEnd = getFrontend();
export const isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

/**
 * 获取当前文档 ID (DOM 操作)
 */
export function getDocid() {
    if (isMobile)
        return document.querySelector('#editor .protyle-content .protyle-background')?.getAttribute("data-node-id");
    else
        return document.querySelector('.layout__wnd--active .protyle.fn__flex-1:not(.fn__none) .protyle-background')?.getAttribute("data-node-id");
}

export function getAttrFromIAL(ial: string, attrName: string): string | null {
    if (!ial) return null;
    // Match attr="value"
    // Value can be anything except double quote, but internal quotes are escaped as &quot;
    // Regex: attrName="([^"]*)"
    const regex = new RegExp(`${attrName}="([^"]*)"`);
    const match = ial.match(regex);
    if (match && match[1]) {
        return decodeHtml(match[1]);
    }
    return null;
}

export function decodeHtml(html: string) {
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
}

/**
 * 格式化日期为 YYYYMMDDHHmmss
 */
export function formatDate(d: Date) {
    const p = (n: number) => (n < 10 ? "0" + n : n);
    return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

export interface AVClickContext {
    cell: HTMLElement;
    row: HTMLElement;
    avContainer: HTMLElement;
    avId: string;
    rowId: string;
    colId: string;
    isHeader: boolean;
    isPrimaryKeyCell: boolean;
}

/**
 * 解析属性视图（AV）点击/Alt-点击事件，并返回关联的所有 DOM 与数据上下文。
 * 能够完美兼容思源表格“锁定列”与“滚动列”两部分 DOM 行（.av__row）独立分离的渲染机制。
 */
export function parseAVClickEvent(event: MouseEvent): AVClickContext | null {
    if (!event.altKey) return null;
    const target = event.target as HTMLElement;
    const cell = target.closest(".av__cell") as HTMLElement;
    if (!cell) return null;

    const row = (cell.closest(".av__row") || cell.closest(".av__gallery-item") || cell.closest(".av__kanban-item")) as HTMLElement;
    const avContainer = (cell.closest(".av") || cell.closest("[data-av-id]") || cell.closest('[data-type="NodeAttributeView"]') || cell.closest(".av__container")) as HTMLElement;
    if (!avContainer || !row) return null;

    const avId = avContainer.getAttribute("data-av-id") || cell.closest("[data-av-id]")?.getAttribute("data-av-id") || "";
    const rowId = row.getAttribute("data-id") || "";
    const colId = cell.getAttribute("data-col-id") || cell.getAttribute("data-field-id") || "";
    const isHeader = !!cell.closest(".av__row--header") || cell.classList.contains("av__cell--header");

    // 从表头中精确识别主键列（ Primary Key，在思源中固定为类型为 "block" 的列）
    const pkHeader = avContainer.querySelector('.av__row--header .av__cell[data-dtype="block"]');
    const pkColId = pkHeader?.getAttribute("data-col-id");
    const isPrimaryKeyCell = pkColId ? (colId === pkColId) : false;

    return {
        cell,
        row,
        avContainer,
        avId,
        rowId,
        colId,
        isHeader,
        isPrimaryKeyCell
    };
}
