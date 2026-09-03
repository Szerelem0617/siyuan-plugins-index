import { handleAvFooterClick } from "./command-db-handler";
import { initAvHeaderIndicators, destroyAvHeaderIndicators } from "../../av/hint";

/**
 * 初始化数据库交互快捷监听器
 */
export function initButtonLinkListener() {
    window.addEventListener("mousedown", handleAvFooterClick, true);
    initAvHeaderIndicators();
}

export function destroyButtonLinkListener() {
    window.removeEventListener("mousedown", handleAvFooterClick, true);
    destroyAvHeaderIndicators();
}
