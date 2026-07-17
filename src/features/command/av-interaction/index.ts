import { parseAVClickEvent } from "../../../shared/utils";
import { getCommandAvId, getTypeAvId } from "../registration";
import { 
    handleAvFooterClick, 
    handleCommandDbAltClick,
    initHoverTooltipListener,
    destroyHoverTooltipListener 
} from "./command-db-handler";
import { handleTypeDbAltClick } from "./type-db-handler";

export { initHoverTooltipListener, destroyHoverTooltipListener };

/**
 * 初始化按钮链接与参数配置快捷监听器
 * 功能：Alt + Click 点击 Command-DB (Layer 2) 或 Type-DB (Layer 3) 单元格进行配置
 */
export function initButtonLinkListener() {
    window.addEventListener("click", handleAvAltClick, true);
    window.addEventListener("mousedown", handleAvFooterClick, true);
}

export function destroyButtonLinkListener() {
    window.removeEventListener("click", handleAvAltClick, true);
    window.removeEventListener("mousedown", handleAvFooterClick, true);
}

async function handleAvAltClick(event: MouseEvent) {
    const clickCtx = parseAVClickEvent(event);
    if (!clickCtx) return;

    const { cell: cellEl, row: rowEl, avContainer, avId, rowId, colId, isHeader, isPrimaryKeyCell } = clickCtx;
    const commandAvId = getCommandAvId();
    const typeAvId = getTypeAvId();
    console.log("[Interaction-Debug] avId:", avId, "commandAvId:", commandAvId, "typeAvId:", typeAvId);

    if (avId !== commandAvId && avId !== typeAvId) {
        console.log("[Interaction-Debug] avId mismatch, returning early");
        return;
    }
    if (isHeader || rowEl.classList.contains("av__row--footer")) return;

    if (avId === commandAvId) {
        // Route to Command-DB Handler
        await handleCommandDbAltClick(event, avId, rowId, colId, rowEl, avContainer, isPrimaryKeyCell);
    } else if (avId === typeAvId) {
        // Route to Type-DB Handler
        await handleTypeDbAltClick(event, avId, rowId, colId, cellEl);
    }
}
