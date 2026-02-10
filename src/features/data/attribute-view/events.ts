import { Menu } from "siyuan";
import { batchSyncToDescendants } from "./batch/batch-sync";
import { syncAttribute } from "./sync/attribute-sync";
import {
    openEmojiDialog,
    openBuiltInImagesDialog,
    openAssetDialog,
    openTemplateDialog,
    updateCellValue,
    BGS
} from "./special/special-handlers";
import { batchUpdateCellValue } from "./special/batch-update";

class AVEventHandler {
    private onContextMenuBound = this.onContextMenu.bind(this);
    private onMouseDownBound = this.onMouseDown.bind(this);
    private onClickBound = this.onClick.bind(this);
    private lastClickedAVCell: HTMLElement | null = null;

    public init() {
        window.addEventListener("contextmenu", this.onContextMenuBound, true);
        window.addEventListener("mousedown", this.onMouseDownBound, true);
        window.addEventListener("click", this.onClickBound, true);
    }

    public destroy() {
        window.removeEventListener("contextmenu", this.onContextMenuBound, true);
        window.removeEventListener("mousedown", this.onMouseDownBound, true);
        window.removeEventListener("click", this.onClickBound, true);
        this.lastClickedAVCell = null;
    }

    private getAVCell(event: MouseEvent) {
        if (!event.altKey) return null;
        const target = event.target as HTMLElement;
        return target.closest(".av__cell") as HTMLElement;
    }

    private onMouseDown(event: MouseEvent) {
        const cell = this.getAVCell(event);
        if (cell) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    private async onClick(event: MouseEvent) {
        const cell = this.getAVCell(event);
        if (!cell) return;

        event.preventDefault();
        event.stopPropagation();

        const menu = new Menu("av-sync-menu");
        this.showSyncMenu(menu, cell);

        const pos = {
            clientX: event.clientX || cell.getBoundingClientRect().left,
            clientY: event.clientY || cell.getBoundingClientRect().bottom
        };
        menu.open({ x: pos.clientX, y: pos.clientY });
    }

    private onContextMenu(event: MouseEvent) {
        const target = event.target as HTMLElement;
        const cell = target.closest(".av__cell") as HTMLElement;
        if (cell) {
            this.lastClickedAVCell = cell;
        } else {
            this.lastClickedAVCell = null;
        }
    }

    public getLastClickedCell() {
        return this.lastClickedAVCell;
    }

    public getProtyleByElement(element: Element): any {
        try {
            // @ts-ignore
            const root = window.siyuan.layout.layout;
            const find = (node: any): any => {
                if (!node) return null;
                if (node.model && node.model.editor && node.model.editor.protyle && node.model.editor.protyle.element) {
                    if (node.model.editor.protyle.element.contains(element)) {
                        return node.model.editor;
                    }
                }
                if (node.children) {
                    for (const child of node.children) {
                        const res = find(child);
                        if (res) return res;
                    }
                }
                return null;
            }
            return find(root);
        } catch (e) {
            console.error("Protyle lookup error", e);
            return null;
        }
    }

    public async showSyncMenu(menu: Menu, cell: HTMLElement) {
        const isHeader = !!cell.closest(".av__row--header");
        const row = cell.closest(".av__row") || cell.closest(".av__gallery-item") || cell.closest(".av__kanban-item");
        const avContainer = cell.closest(".av") as HTMLElement;
        if (!avContainer || (!row && !isHeader)) return;

        let protyleInstance: any = null;
        try {
            protyleInstance = this.getProtyleByElement(avContainer);
        } catch (e) {
            console.warn("[SyncPlugin] Protyle lookup failed:", e);
        }

        const avID = avContainer.getAttribute("data-av-id")!;
        const avBlockID = avContainer.getAttribute("data-node-id")!;
        const rowID = isHeader ? null : row?.getAttribute("data-id")!;
        let colID = cell.getAttribute("data-col-id") || cell.getAttribute("data-field-id")!;

        let colType = "";
        let colName = "";
        if (avContainer) {
            const headerCell = avContainer.querySelector(`.av__row--header .av__cell[data-col-id="${colID}"]`);
            if (headerCell) {
                colType = headerCell.getAttribute("data-dtype") || "";
                colName = headerCell.querySelector(".av__celltext")?.textContent?.trim() || "";
            }
        }

        // Add Separator to separate from native items
        menu.addSeparator();

        const updateValueHandler = (val: string) => {
            if (isHeader) {
                batchUpdateCellValue(protyleInstance, avID, colID, val, colType, avBlockID);
            } else {
                updateCellValue(protyleInstance, avID, rowID!, colID, val);
            }
        };

        if (cell) {
            // 1. 图标 (Icon)
            const isIconCol = (cell.querySelector(".b3-menu__avemoji")) || /^icon$/i.test(colName);
            if (isIconCol) {
                menu.addItem({
                    icon: "iconEmoji",
                    label: isHeader ? "批量设置图标" : "选择图标 (Icon)",
                    click: () => openEmojiDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID)
                });
            }

            // 2. 题头图 (Title Image)
            const isTitleImgCol = (colType === "mAsset") || (colType === "text" && /^title-img$/i.test(colName));
            if (isTitleImgCol) {
                const titleImgMenu: any[] = [];

                titleImgMenu.push({
                    icon: "iconLayout",
                    label: "内置背景图 (Built-in)",
                    click: () => openBuiltInImagesDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID)
                });

                titleImgMenu.push({
                    icon: "iconImage",
                    label: "资源文件 (Assets)",
                    click: () => openAssetDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID)
                });

                titleImgMenu.push({
                    icon: "iconRefresh",
                    label: "随机背景 (Random)",
                    click: () => {
                        const randomBg = BGS[Math.floor(Math.random() * BGS.length)];
                        updateValueHandler(randomBg);
                    }
                });

                menu.addItem({
                    icon: "iconImage",
                    label: isHeader ? "批量设置题头图" : "选择题头图 (Title Image)",
                    submenu: titleImgMenu
                });
            }

            // 3. 模板 (Template)
            const isTemplateCol = (colType === "template") || (colType === "text" && /^template$/i.test(colName));
            if (isTemplateCol) {
                menu.addItem({
                    icon: "iconMath",
                    label: isHeader ? "批量设置模板" : "选择模板 (Template)",
                    click: () => openTemplateDialog(protyleInstance, avID, rowID || "", colID, avBlockID, isHeader)
                });
            }

            if (isIconCol || isTitleImgCol || isTemplateCol) {
                menu.addSeparator();
            }
        }

        const syncLabel = isHeader ? "批量同步到后代" : "数据同步到";

        if (isHeader) {
            menu.addItem({
                icon: "iconSync",
                label: syncLabel,
                click: () => batchSyncToDescendants(avID, colID, avBlockID)
            });
        } else {
            const syncSubmenu = [
                {
                    icon: "iconSort",
                    label: "同级",
                    click: () => syncAttribute(avID, rowID || "first", colID, "level", avBlockID)
                },
                {
                    icon: "iconLink",
                    label: "兄弟",
                    click: () => syncAttribute(avID, rowID || "first", colID, "siblings", avBlockID)
                },
                {
                    icon: "iconDown",
                    label: "后代",
                    click: () => syncAttribute(avID, rowID || "first", colID, "descendants", avBlockID)
                },
                {
                    icon: "iconFilter",
                    label: "所有筛选出的项",
                    click: () => syncAttribute(avID, rowID || "first", colID, "filtered", avBlockID)
                }
            ];

            menu.addItem({
                icon: "iconSync",
                label: syncLabel,
                submenu: syncSubmenu
            });
        }
    }
}

export const avEventHandler = new AVEventHandler();

/**
 * AV 菜单回调 (open-menu-av)
 */
export function addAVMenuItems({ detail }: any) {
    const { menu } = detail;
    const cell = avEventHandler.getLastClickedCell();
    if (cell && menu) {
        avEventHandler.showSyncMenu(menu, cell);
    }
}