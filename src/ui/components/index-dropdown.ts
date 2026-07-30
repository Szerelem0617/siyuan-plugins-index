/**
 * index-dropdown.ts
 *
 * IndexOS 自定义 Fixed 浮层下拉选择器
 * 关键设计：
 * - position: fixed 挂载到 document.body，脱离 Dialog overflow:hidden 裁剪
 * - 使用 window.siyuan.zIndex 全局递增确保在 Dialog 之上
 * - 自动检测上下空间决定展开方向
 * - 外部点击 / Escape 自动关闭
 * - 100% 使用 IndexOS 设计 token
 */

export interface DropdownOption {
    value: string;
    label: string;
}

let activePanel: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

function closeActiveDropdown() {
    if (activePanel) {
        activePanel.remove();
        activePanel = null;
    }
    if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
    }
}

export function openIndexDropdown(opts: {
    event: MouseEvent;
    options: DropdownOption[];
    selectedValue?: string;
    onSelect: (value: string) => void;
}) {
    // 若点击的是同一个触发器且面板已打开，关闭并返回
    const trigger = opts.event.currentTarget as HTMLElement;
    if (activePanel && trigger.classList.contains("is-active")) {
        closeActiveDropdown();
        trigger.classList.remove("is-active");
        return;
    }

    // 关闭已有面板
    closeActiveDropdown();
    const rect = trigger.getBoundingClientRect();

    // 标记触发按钮为激活态
    trigger.classList.add("is-active");

    // 1. 创建面板
    const panel = document.createElement("div");
    panel.className = "indexos-dropdown-panel";

    // 关键：使用 SiYuan 全局 z-index 系统确保在 Dialog 之上
    const siyuan = (window as any).siyuan;
    if (siyuan && typeof siyuan.zIndex === "number") {
        panel.style.zIndex = (++siyuan.zIndex).toString();
    } else {
        panel.style.zIndex = "99999";
    }

    panel.style.position = "fixed";
    panel.style.left = rect.left + "px";
    panel.style.width = rect.width + "px";
    panel.style.boxSizing = "border-box";

    // 2. 填充选项
    for (const opt of opts.options) {
        const item = document.createElement("div");
        item.className = "indexos-dropdown-item";
        if (opt.value === opts.selectedValue) {
            item.classList.add("is-selected");
        }
        item.textContent = opt.label;
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            opts.onSelect(opt.value);
            trigger.classList.remove("is-active");
            closeActiveDropdown();
        });
        panel.appendChild(item);
    }

    // 3. 挂载到 body（脱离 Dialog DOM 树）
    document.body.appendChild(panel);
    activePanel = panel;

    // 4. 自动判断展开方向（先测量真实高度）
    const panelHeight = panel.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < panelHeight + 8 && rect.top > panelHeight + 8) {
        // 下方不够且上方够：向上展开
        panel.style.top = (rect.top - panelHeight - 4) + "px";
        panel.classList.add("is-flip");
    } else {
        // 向下展开
        panel.style.top = (rect.bottom + 4) + "px";
    }

    // 5. 右侧溢出修正
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.right > window.innerWidth) {
        panel.style.left = (window.innerWidth - panelRect.width - 8) + "px";
    }

    // 6. 外部点击关闭（延迟绑定避免当前 click 事件冒泡触发）
    const onDocClick = (e: MouseEvent) => {
        if (!panel.contains(e.target as Node) && !trigger.contains(e.target as Node)) {
            trigger.classList.remove("is-active");
            closeActiveDropdown();
        }
    };
    setTimeout(() => document.addEventListener("click", onDocClick, true), 0);

    // 7. Escape 关闭
    const onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            trigger.classList.remove("is-active");
            closeActiveDropdown();
        }
    };
    document.addEventListener("keydown", onKeydown);

    activeCleanup = () => {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKeydown);
    };
}
