import { Menu, showMessage } from "siyuan";
import { syncAttribute } from "./sync/attribute-sync";
import { i18n } from "../../../shared/utils";
import {
    openEmojiDialog,
    openBuiltInImagesDialog,
    openAssetDialog,
    openTemplateDialog,
    updateCellValue,
    BGS
} from "./special/special-handlers";
import { batchUpdateCellValue } from "./special/batch-update";
import { openDbConfigDialog, setColumnWeakInheritance } from "../av-setting/db-config";
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
                    label: isHeader ? i18n.dataMenu.batchSetIcon : i18n.dataMenu.selectIcon,
                    click: () => openEmojiDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID)
                });
            }

            // 2. 题头图 (Title Image)
            const isTitleImgCol = (colType === "mAsset") || (colType === "text" && /^title-img$/i.test(colName));
            if (isTitleImgCol) {
                const titleImgMenu: any[] = [];

                titleImgMenu.push({
                    icon: "iconLayout",
                    label: i18n.dataMenu.builtinImages,
                    click: () => openBuiltInImagesDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID)
                });

                titleImgMenu.push({
                    icon: "iconImage",
                    label: i18n.dataMenu.assetImage,
                    click: () => openAssetDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID)
                });

                titleImgMenu.push({
                    icon: "iconRefresh",
                    label: i18n.dataMenu.randomImage,
                    click: () => {
                        const randomBg = BGS[Math.floor(Math.random() * BGS.length)];
                        updateValueHandler(randomBg);
                    }
                });

                menu.addItem({
                    icon: "iconImage",
                    label: isHeader ? i18n.dataMenu.batchSetTitleImg : i18n.dataMenu.selectTitleImg,
                    submenu: titleImgMenu
                });
            }

            // 3. 模板 (Template)
            const isTemplateCol = (colType === "template") || (colType === "text" && /^template$/i.test(colName));
            if (isTemplateCol) {
                menu.addItem({
                    icon: "iconMath",
                    label: isHeader ? i18n.dataMenu.batchSetTemplate : i18n.dataMenu.selectTemplate,
                    click: () => openTemplateDialog(protyleInstance, avID, rowID || "", colID, avBlockID, isHeader)
                });
            }

            if (isIconCol || isTitleImgCol || isTemplateCol) {
                menu.addSeparator();
            }
        }

        const syncLabel = isHeader ? i18n.dataMenu.batchSyncTo : i18n.dataMenu.syncTo;

        if (isHeader) {
            menu.addItem({
                icon: "iconSync",
                label: i18n.dbConfig.setWeakInheritance,
                click: async () => {
                    try {
                        showMessage(i18n.dbConfig.applyingWeakInheritance, 3000);
                        const updatedCount = await setColumnWeakInheritance(avID, colID, avBlockID);
                        if (updatedCount > 0) {
                            showMessage(`${i18n.dbConfig.saveSyncSuccess} ${updatedCount} ${i18n.dbConfig.saveSyncSuccessCells}`, 3000);
                        } else {
                            showMessage(i18n.dbConfig.saveNoChange, 3000);
                        }
                    } catch (e: any) {
                        showMessage(`${i18n.dbConfig.setWeakInheritanceError} ${e.message}`, 3000, "error");
                    }
                }
            });

            menu.addSeparator();
            menu.addItem({
                icon: "iconSettings",
                label: i18n.dbConfig.dialogTitle,
                click: () => openDbConfigDialog(avID, avBlockID)
            });
        } else {
            const syncSubmenu = [
                {
                    icon: "iconSort",
                    label: i18n.dataMenu.level,
                    click: () => syncAttribute(avID, rowID || "first", colID, "level", avBlockID)
                },
                {
                    icon: "iconLink",
                    label: i18n.dataMenu.siblings,
                    click: () => syncAttribute(avID, rowID || "first", colID, "siblings", avBlockID)
                },
                {
                    icon: "iconDown",
                    label: i18n.dataMenu.descendants,
                    click: () => syncAttribute(avID, rowID || "first", colID, "descendants", avBlockID)
                },
                {
                    icon: "iconFilter",
                    label: i18n.dataMenu.filtered,
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