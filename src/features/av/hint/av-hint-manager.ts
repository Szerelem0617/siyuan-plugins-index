import { getCommandAvId, getTypeAvId } from "../../command/registration";

let headerObserver: MutationObserver | null = null;

/**
 * 扫描并仅为 custom-index-command-db、custom-index-supertag-db 以及全库通用配置列 (icon/title-img/template) 挂载指示线与按钮边框
 */
export function scanAvIndicators() {
    const commandAvId = getCommandAvId();
    const typeAvId = getTypeAvId();

    const avContainers = document.querySelectorAll('.av, .av__container, [data-av-id], [data-type="NodeAttributeView"]');
    avContainers.forEach(avContainer => {
        const avId = avContainer.getAttribute("data-av-id") || "";
        
        // 严谨判别属性：检查 custom-index-command-db 与 custom-index-supertag-db 属性
        const isCommandDb = (
            (commandAvId && avId === commandAvId) ||
            avContainer.hasAttribute("custom-index-command-db") ||
            !!avContainer.getAttribute("custom-index-command-db") ||
            !!avContainer.querySelector('[custom-index-command-db]') ||
            !!avContainer.closest('[custom-index-command-db]')
        );
        const isSupertagDb = (
            (typeAvId && avId === typeAvId) ||
            avContainer.hasAttribute("custom-index-supertag-db") ||
            !!avContainer.getAttribute("custom-index-supertag-db") ||
            !!avContainer.querySelector('[custom-index-supertag-db]') ||
            !!avContainer.closest('[custom-index-supertag-db]')
        );

        // 1. 表头 Headers 处理
        const headerCells = avContainer.querySelectorAll(".av__row--header .av__cell");
        headerCells.forEach(cell => {
            const txt = (cell.textContent || "").trim().toLowerCase();

            // 对于 icon, title-img, template 列，无论处于任何数据库，也做标线指示
            const isUniversalSpecialCol = (
                txt === "icon" || txt === "图标" ||
                txt === "title-img" || txt === "title_img" || txt === "titleimg" || txt === "文档图" || txt === "标题图" ||
                txt === "template" || txt === "模板"
            );

            let isConfigurableCol = isUniversalSpecialCol;

            if (isCommandDb) {
                // Command-DB: 仅高亮支持 Alt+Click 快捷交互的列
                // - 主键: Alt+Click 打开命令详情/自定义命令编辑/复合命令编排
                // - Input: Alt+Click 打开入参配置抽屉 (InputConfigDialog)
                // - Output: Alt+Click 打开出参配置抽屉 (OutputConfigDialog)
                // - Composite: Alt+Click 打开复合命令流水线编排器 (PipelineEditor)
                // (注：Command ID 列仅用于机器标识展示，无 Alt+Click 操作，故不高亮)
                isConfigurableCol = isConfigurableCol || (
                    txt.includes("主键") ||
                    txt.includes("input") ||
                    txt.includes("output") ||
                    txt.includes("composite")
                );
            } else if (isSupertagDb) {
                // Supertag-DB: 仅高亮支持 Alt+Click 快捷交互的列
                // - Manual: Alt+Click 打开手动触发配置 (;;菜单/IconMenu/实体按钮/虚拟按钮)
                // - Auto: Alt+Click 打开多事件自动触发器编排器
                // (注：Supertag 主键列无 Alt+Click 拦截行为，故不高亮)
                isConfigurableCol = isConfigurableCol || (
                    txt.includes("manual") ||
                    txt.includes("auto")
                );
            }

            if (isConfigurableCol) {
                cell.classList.add("indexos-header-indicator");
            } else {
                cell.classList.remove("indexos-header-indicator");
            }
        });

        // 2. “添加条目” 与 “添加字段(+)” 按钮处理 (仅 Command-DB 与 Supertag-DB 绑定了 IndexOS 专属功能)
        const addButtons = avContainer.querySelectorAll('button[data-type="av-add-bottom"], [data-type="av-header-add"], [data-type="av-add-column"]');
        addButtons.forEach(btn => {
            if (isCommandDb) {
                btn.classList.add("indexos-btn-bordered");
                btn.setAttribute("title", "点击打开后台执行控制中心");
            } else if (isSupertagDb && btn.getAttribute("data-type") === "av-add-bottom") {
                btn.classList.add("indexos-btn-bordered", "supertag-btn-hint");
                btn.setAttribute("title", "💡 Alt + Click: 快捷导入预设超级标签 (Supertag Presets)");
            } else {
                btn.classList.remove("indexos-btn-bordered", "supertag-btn-hint");
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
    document.querySelectorAll('[data-type="av-add-bottom"], [data-type="av-header-add"], [data-type="av-add-column"]').forEach(el => el.classList.remove('indexos-btn-bordered'));
}
