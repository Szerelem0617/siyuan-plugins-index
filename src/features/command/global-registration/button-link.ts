
import { showMessage } from "siyuan";
import { commandAvId } from "../registration";
import { encodeBtnHref } from "./inline-button";

/**
 * 初始化按钮链接快捷复制监听器
 * 功能：Alt + Click 点击 Command-DB (Layer 2) 的主键，自动复制该命令的 siyuan-btn:// 链接
 */
export function initButtonLinkListener() {
    window.addEventListener("click", handleAvAltClick, true);
}

export function destroyButtonLinkListener() {
    window.removeEventListener("click", handleAvAltClick, true);
}

function handleAvAltClick(event: MouseEvent) {
    if (!event.altKey) return;

    const path = event.composedPath();
    
    // 1. 寻找被点击的 AV 单元格
    const cellEl = path.find(el => (el as HTMLElement).classList?.contains("av__cell")) as HTMLElement;
    if (!cellEl) return;

    // 2. 寻找所属的 AV 容器以获取 avID
    const avContainer = path.find(el => (el as HTMLElement).hasAttribute?.("data-av-id")) as HTMLElement;
    if (!avContainer) return;

    const avId = avContainer.getAttribute("data-av-id");
    if (avId !== commandAvId) return;

    // 3. 确认是否为主键 (通常是第一列)
    // 思源 AV DOM 结构中，行通常是 .av__row，单元格是 .av__cell
    const rowEl = cellEl.closest(".av__row");
    if (!rowEl) return;

    // 判断是否为第一个单元格 (主键列)
    const firstCell = rowEl.querySelector(".av__cell");
    if (firstCell !== cellEl) return;

    // 4. 提取主键内容 (命令名称)
    // 单元格内容可能是块链接、文本或多行文本
    const label = (cellEl.textContent || "").trim();
    if (!label) return;

    // 5. 组装并复制链接
    // 注意：这里建议直接用命令名称，因为 siyuan-btn 支持名称匹配，且名称比 ID 更具可读性
    const href = encodeBtnHref({ command: label });

    event.preventDefault();
    event.stopPropagation();

    navigator.clipboard.writeText(href).then(() => {
        showMessage(`已复制命令按钮链接: ${label}`, 2000);
        console.log("[ButtonLink] Copied link:", href);
    }).catch(err => {
        console.error("[ButtonLink] Failed to copy:", err);
        showMessage("复制链接失败", 2000, "error");
    });
}
