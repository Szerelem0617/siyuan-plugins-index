import { showMessage } from "siyuan";
import { commandAvId, COMMAND_REGISTRY } from "../registration";
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
    const rowEl = cellEl.closest(".av__row");
    if (!rowEl) return;

    // 判断是否为第一个单元格 (主键列)
    const firstCell = rowEl.querySelector(".av__cell");
    if (firstCell !== cellEl) return;

    // 4. 提取主键内容 (命令名称)
    const rawLabel = (cellEl.textContent || "").trim();
    if (!rawLabel) return;

    // 净化 Label：处理某些情况下可能存在的零宽字符或特殊空格
    const cleanLabel = rawLabel.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // 5. 查找对应的 Command ID
    // 我们可以打印一下当前的注册表状态和获取到的 Label，方便调试
    // console.log("[ButtonLink] Clicked Label:", `"${cleanLabel}"`);
    // console.log("[ButtonLink] Registry Keys:", Object.keys(COMMAND_REGISTRY));

    // 尝试直接匹配
    let cmdInfo = COMMAND_REGISTRY[cleanLabel];

    // 如果直接匹配不到，尝试“包含”式模糊匹配 (处理 DOM 渲染差异)
    if (!cmdInfo) {
        const foundKey = Object.keys(COMMAND_REGISTRY).find(k => 
            cleanLabel.includes(k) || k.includes(cleanLabel)
        );
        if (foundKey) {
            cmdInfo = COMMAND_REGISTRY[foundKey];
            // console.log("[ButtonLink] Fuzzy match found via key:", foundKey);
        }
    }

    const targetCommand = cmdInfo?.commandRef || cleanLabel;
    if (!cmdInfo) {
        console.warn("[ButtonLink] Match failed, falling back to label. The link will be URL-encoded.");
    }

    // 6. 组装并复制链接
    const href = encodeBtnHref({ command: targetCommand });

    event.preventDefault();
    event.stopPropagation();

    navigator.clipboard.writeText(href).then(() => {
        showMessage(`已复制命令按钮链接: ${targetCommand}`, 2000);
        console.log("[ButtonLink] Copied link:", href);
    }).catch(err => {
        console.error("[ButtonLink] Failed to copy:", err);
        showMessage("复制链接失败", 2000, "error");
    });
}
