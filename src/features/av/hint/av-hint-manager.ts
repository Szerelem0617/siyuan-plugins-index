let headerObserver: MutationObserver | null = null;

/**
 * 扫描并仅为全库通用配置列 (icon/title-img/template) 挂载指示线
 * (已按需求移除 command-db 与 supertag-db 的蓝色表头指示线与添加按钮 hint)
 */
export function scanAvIndicators() {
    const avContainers = document.querySelectorAll('.av, .av__container, [data-av-id], [data-type="NodeAttributeView"]');
    avContainers.forEach(avContainer => {
        // 1. 表头 Headers 处理 (仅通用配置列保留指示线)
        const headerCells = avContainer.querySelectorAll(".av__row--header .av__cell");
        headerCells.forEach(cell => {
            const txt = (cell.textContent || "").trim().toLowerCase();

            // 对于 icon, title-img, template 列，无论处于任何数据库，做标线指示
            const isUniversalSpecialCol = (
                txt === "icon" || txt === "图标" ||
                txt === "title-img" || txt === "title_img" || txt === "titleimg" || txt === "文档图" || txt === "标题图" ||
                txt === "template" || txt === "模板"
            );

            if (isUniversalSpecialCol) {
                cell.classList.add("indexos-header-indicator");
            } else {
                cell.classList.remove("indexos-header-indicator");
            }
        });

        // 2. 清理可能残留的 command-db / supertag-db 按钮 hint
        const addButtons = avContainer.querySelectorAll('button[data-type="av-add-bottom"], [data-type="av-header-add"], [data-type="av-add-column"]');
        addButtons.forEach(btn => {
            btn.classList.remove("indexos-btn-bordered", "supertag-btn-hint");
            if (btn.getAttribute("title")?.includes("后台执行") || btn.getAttribute("title")?.includes("快捷导入预设")) {
                btn.removeAttribute("title");
            }
        });
    });
}

export function initAvHeaderIndicators() {
    scanAvIndicators();

    if (!headerObserver) {
        headerObserver = new MutationObserver(() => scanAvIndicators());
        headerObserver.observe(document.body, { childList: true, subtree: true });
    }
}

export function destroyAvHeaderIndicators() {
    if (headerObserver) {
        headerObserver.disconnect();
        headerObserver = null;
    }
    document.querySelectorAll('.indexos-header-indicator').forEach(el => el.classList.remove('indexos-header-indicator'));
    document.querySelectorAll('[data-type="av-add-bottom"], [data-type="av-header-add"], [data-type="av-add-column"]').forEach(el => el.classList.remove('indexos-btn-bordered', 'supertag-btn-hint'));
}
