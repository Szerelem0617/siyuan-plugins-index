import { 
    handleAvFooterClick, 
    initHoverTooltipListener,
    destroyHoverTooltipListener 
} from "./command-db-handler";

export { initHoverTooltipListener, destroyHoverTooltipListener };

/**
 * 初始化数据库交互快捷监听器
 * (已按需求移除 command-db 与 supertag-db 的 Alt+Click 单元格配置交互，统一收敛至超级标签与命令管理面板)
 */
export function initButtonLinkListener() {
    window.addEventListener("mousedown", handleAvFooterClick, true);
}

export function destroyButtonLinkListener() {
    window.removeEventListener("mousedown", handleAvFooterClick, true);
}
