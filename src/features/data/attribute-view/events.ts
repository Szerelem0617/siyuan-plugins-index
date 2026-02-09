import { client } from "../../../shared/api-client";
import { Menu, Dialog, showMessage } from "siyuan";
import { BGS } from "./constants";
import EmojiDialog from "../../../ui/components/dialog/emoji-dialog.svelte";
import { post } from "../../../shared/api-client/request";
import { formatDate, confirmDialog, i18n } from "../../../shared/utils";

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
        } catch(e) {
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
                this.batchUpdateCellValue(protyleInstance, avID, colID, val, colType, avBlockID);
            } else {
                this.updateCellValue(protyleInstance, avID, rowID!, colID, val);
            }
        };

        if (cell) {
            // 1. 图标 (Icon)
            const isIconCol = (cell.querySelector(".b3-menu__avemoji")) || /^icon$/i.test(colName);
            if (isIconCol) {
                menu.addItem({
                    icon: "iconEmoji",
                    label: isHeader ? "批量设置图标" : "选择图标 (Icon)",
                    click: () => {
                        this.openEmojiDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID);
                    }
                });
            }

            // 2. 题头图 (Title Image)
            const isTitleImgCol = (colType === "mAsset") || (colType === "text" && /^title-img$/i.test(colName));
            if (isTitleImgCol) {
                const titleImgMenu: any[] = [];
                
                titleImgMenu.push({
                    icon: "iconLayout",
                    label: "内置背景图 (Built-in)",
                    click: () => {
                        this.openBuiltInImagesDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID);
                    }
                });

                titleImgMenu.push({
                    icon: "iconImage",
                    label: "资源文件 (Assets)",
                    click: () => {
                        this.openAssetDialog(protyleInstance, avID, rowID || "", colID, isHeader, avBlockID);
                    }
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
                    click: () => {
                        this.openTemplateDialog(protyleInstance, avID, rowID || "", colID, avBlockID, isHeader);
                    }
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
                click: () => this.batchSyncToDescendants(avID, colID, avBlockID, protyleInstance)
            });
        } else {
            const syncSubmenu = [
                {
                    icon: "iconSort",
                    label: "同级",
                    click: () => this.syncAttribute(avID, rowID || "first", colID, "level", avBlockID, protyleInstance)
                },
                {
                    icon: "iconLink",
                    label: "兄弟",
                    click: () => this.syncAttribute(avID, rowID || "first", colID, "siblings", avBlockID, protyleInstance)
                },
                {
                    icon: "iconDown",
                    label: "后代",
                    click: () => this.syncAttribute(avID, rowID || "first", colID, "descendants", avBlockID, protyleInstance)
                },
                {
                    icon: "iconFilter",
                    label: "所有筛选出的项",
                    click: () => {
                        this.syncAttribute(avID, rowID || "first", colID, "filtered", avBlockID, protyleInstance);
                    }
                }
            ];

            menu.addItem({
                icon: "iconSync",
                label: syncLabel,
                submenu: syncSubmenu
            });
        }
    }

    private async batchUpdateCellValue(protyleInstance: any, avID: string, colID: string, newValue: string, colType: string, avBlockID: string) {
        try {
            showMessage("⏳ 正在批量执行...", 3000);
            const avData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
            const view = avData.view || avData; 
            const rows = view.rows || [];
            const columns = view.columns || [];
            const colIndex = columns.findIndex((c: any) => c.id === colID);
            if (colIndex === -1) throw new Error("Column not found");

            const ops = rows.map((row: any) => {
                const cellData = row.cells[colIndex];
                const cellType = cellData.valueType || colType || "text";
                const updateData: any = { id: cellData.id, type: cellType };
                if (cellType === "mAsset") {
                    updateData.mAsset = [{ content: newValue, name: newValue.split('/').pop() }];
                } else {
                    updateData[cellType === "text" || cellType === "template" ? cellType : "text"] = { content: newValue };
                }
                return { action: "updateAttrViewCell", id: cellData.id, avID, keyID: colID, rowID: row.id, data: updateData };
            });

            if (avBlockID) {
                ops.push({ action: "doUpdateUpdated", id: avBlockID, data: formatDate(new Date()) });
            }

            if (protyleInstance) {
                protyleInstance.transaction(ops);
            } else {
                await post("/api/transactions", { app: "plugin-index", reqId: Date.now(), transactions: [{ doOperations: ops }] });
            }
            showMessage(`✅ 批量更新成功: ${rows.length} 个项`, 3000);
        } catch (e: any) {
            console.error("Batch Update Error", e);
            showMessage(`❌ 批量执行失败: ${e.message}`, 3000, "error");
        }
    }

    private async batchSyncToDescendants(avID: string, colID: string, avBlockID: string, protyleInstance: any) {
        try {
            console.log(`[Batch Sync] Starting sync for AV [${avID}], Col [${colID}]`);
            showMessage("⏳ 正在批量同步到后代...", 3000);
            
            // 1. 获取当前视图的所有可见行（作为源）
            const sourceViewData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
            const sourceRows = sourceViewData.view?.rows || sourceViewData.rows || [];
            console.log(`[Batch Sync] Fetched ${sourceRows.length} source rows (current view)`);
            
            // 2. 获取整个数据库的所有行（作为目标查找范围）
            const allViewData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 2000, filters: [] });
            const allRows = allViewData.view?.rows || allViewData.rows || [];
            console.log(`[Batch Sync] Fetched ${allRows.length} total rows (target scope)`);

            const view = sourceViewData.view || sourceViewData;
            const columns = view.columns || [];
            const colIndex = columns.findIndex((c: any) => c.id === colID);
            const pathIdx = columns.findIndex((c: any) => c.name === "Path");
            
            console.log(`[Batch Sync] ColIndex: ${colIndex}, PathColIndex: ${pathIdx}`);
            
            if (colIndex === -1) throw new Error("Source column not found");
            
            const ops: any[] = [];
            
            // For each row in current view (SOURCE), find its descendants in all rows (TARGET) and update them
            for (const row of sourceRows) {
                const sourceValue = row.cells[colIndex].value;
                const sourceBlockCell = row.cells.find((c: any) => c.valueType === "block");
                const sourceBlockID = sourceBlockCell?.value?.block?.id;
                
                // Debug log for each source (optional, maybe too verbose for large sets, limiting to first few or specific checks)
                // console.log(`[Batch Sync] Processing source row: ${row.id}, BlockID: ${sourceBlockID}`);
                
                if (!sourceBlockID) continue;

                const cleanValue = (val: any) => {
                    const res: any = { type: val.type };
                    ["text", "number", "mSelect", "mAsset", "block", "url", "phone", "email", "template", "checkbox", "relation", "rollup", "date"].forEach(f => {
                        if (val[f] !== undefined) res[f] = JSON.parse(JSON.stringify(val[f]));
                    });
                    return res;
                };
                const syncValue = cleanValue(sourceValue);

                let targetIDs: string[] = [];
                if (pathIdx !== -1) {
                    targetIDs = allRows.filter((r: any) => {
                        const path = r.cells[pathIdx]?.value?.text?.content || "";
                        // Logic check: verify path format matches expectation
                        return path.includes(`/${sourceBlockID}/`) && r.id !== row.id;
                    }).map((r: any) => r.id);
                } else {
                    console.log(`[Batch Sync] Path column missing, falling back to recursive search for [${sourceBlockID}]`);
                    targetIDs = await this.findChildItemIDs(sourceBlockID, allRows, columns);
                }

                if (targetIDs.length > 0) {
                    console.log(`[Batch Sync] Found ${targetIDs.length} descendants for [${sourceBlockID}]`);
                }

                targetIDs.forEach(tid => {
                    const targetRow = allRows.find((r: any) => r.id === tid);
                    if (targetRow) {
                        const cell = targetRow.cells[colIndex];
                        const data = JSON.parse(JSON.stringify(syncValue)); 
                        data.id = cell.id;
                        ops.push({ action: "updateAttrViewCell", id: cell.id, avID, keyID: colID, rowID: tid, data });
                    }
                });
            }

            console.log(`[Batch Sync] Total operations generated: ${ops.length}`);

            if (ops.length === 0) {
                console.warn("[Batch Sync] No operations generated. Check path matching or source/target overlap.");
                return; // Silent return
            }

            if (avBlockID) {
                ops.push({ action: "doUpdateUpdated", id: avBlockID, data: formatDate(new Date()) });
            }

            if (protyleInstance) {
                protyleInstance.transaction(ops);
            } else {
                await post("/api/transactions", { 
                    app: "plugin-index", 
                    reqId: Date.now(),
                    transactions: [{ doOperations: ops }] 
                });
            }
            showMessage(`✅ 批量同步成功: 更新 ${ops.length} 个单元格`, 3000);

        } catch (e: any) {
            console.error("Batch Sync Error", e);
            showMessage(`❌ 批量同步失败: ${e.message}`, 3000, "error");
        }
    }

    private openEmojiDialog(protyleInstance: any, avID: string, rowID: string, colID: string, isBatch = false, avBlockID = "") {
        const dialog = new Dialog({
            title: "",
            content: `<div class="emoji-dialog-content" style="height: 100%; display: flex; flex-direction: column;"></div>`,
            width: "360px",
            height: "460px",
        });

        const target = dialog.element.querySelector(".emoji-dialog-content");
        if (target) {
            new EmojiDialog({
                target: target,
                props: {
                    onSelect: (emoji: string) => {
                        if (emoji !== undefined) {
                            if (isBatch) {
                                this.batchUpdateCellValue(protyleInstance, avID, colID, emoji, "text", avBlockID);
                            } else {
                                this.updateCellValue(protyleInstance, avID, rowID, colID, emoji);
                            }
                        }
                        dialog.destroy();
                    }
                }
            });
        }
    }

    private openBuiltInImagesDialog(protyleInstance: any, avID: string, rowID: string, colID: string, isBatch = false, avBlockID = "") {
        let html = "";
        BGS.forEach((item, index) => {
            html += `<div data-index="${index}" style="height: 128px;${item}; cursor: pointer; border-radius: 4px; border: 1px solid var(--b3-border-color);" class="b3-card b3-card--wrap"></div>`;
        });
        
        const dialog = new Dialog({
            title: "选择内置背景",
            content: `<div class="built-in-bgs" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; padding: 16px; overflow-y: auto; max-height: 70vh;">${html}</div>`,
            width: "900px",
        });

        dialog.element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains("b3-card")) {
                const index = parseInt(target.getAttribute("data-index")!);
                const bgStyle = BGS[index];
                if (isBatch) {
                    this.batchUpdateCellValue(protyleInstance, avID, colID, bgStyle, "text", avBlockID);
                } else {
                    this.updateCellValue(protyleInstance, avID, rowID, colID, bgStyle);
                }
                dialog.destroy();
            }
        });
    }

    private openAssetDialog(protyleInstance: any, avID: string, rowID: string, colID: string, isBatch = false, avBlockID = "") {
        const dialog = new Dialog({
            title: "选择资源",
            content: `
            <div id="sync-plugin-asset-root" style="display:flex; height: 60vh; width: 100%; box-sizing: border-box; overflow: hidden; border-radius: 0 0 4px 4px;">
                <div class="asset-sidebar" style="width: 320px; border-right: 1px solid var(--b3-border-color); display: flex; flex-direction: column; background-color: var(--b3-theme-surface);">
                    <div style="padding: 8px;">
                        <input class="b3-text-field fn__block" placeholder="搜索资源 (↑↓导航 Enter选择)" id="asset-search-input" autofocus>
                    </div>
                    <div class="b3-list b3-list--background fn__flex-1" id="asset-list" style="overflow-y: auto;">
                        <div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>
                    </div>
                </div>
                <div id="asset-preview" class="fn__flex-1" style="padding: 16px; display: flex; align-items: center; justify-content: center; background-color: var(--b3-theme-background); overflow: hidden;">
                    <div class="ft__center ft__on-surface">请选择资源预览</div>
                </div>
            </div>`,
            width: "900px",
        });

        const listEl = dialog.element.querySelector("#asset-list") as HTMLElement;
        const previewEl = dialog.element.querySelector("#asset-preview") as HTMLElement;
        const inputEl = dialog.element.querySelector("#asset-search-input") as HTMLInputElement;
        let currentPreviewPath = "";
        let hoverTimer: any = null;

        const renderList = (keyword = "") => {
            listEl.innerHTML = '<div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>';
            post("/api/search/searchAsset", { 
                k: keyword,
                exts: [".png", ".jpg", ".jpeg", ".gif", ".webp"]
            }).then((res: any) => {
                let html = "";
                // 注意：API 返回的 res 直接就是数组
                const assets = res || [];
                if (assets.length > 0) {
                    assets.forEach((item: any, index: number) => {
                        const isFocus = index === 0 ? " b3-list-item--focus" : "";
                        html += `<div class="b3-list-item b3-list-item--hide-action${isFocus}" 
                            data-path="${item.path}" 
                            style="cursor: pointer; padding: 4px 8px; margin: 2px 4px; border-radius: 4px;">
                            <span class="b3-list-item__text">${item.hName}</span>
                        </div>`;
                    });
                } else {
                    html = `<div class="b3-list--empty" style="padding: 16px; text-align: center; color: var(--b3-theme-on-surface-light);">无匹配资源</div>`;
                }
                listEl.innerHTML = html;

                const firstItem = listEl.querySelector(".b3-list-item") as HTMLElement;
                if (firstItem) {
                    const path = firstItem.getAttribute("data-path")!;
                    currentPreviewPath = path;
                    this.renderPreviewAsset(path, previewEl);
                }

                listEl.querySelectorAll(".b3-list-item").forEach(item => {
                    const path = item.getAttribute("data-path")!;
                    
                    item.addEventListener("mouseenter", () => {
                        if (currentPreviewPath === path) return;
                        listEl.querySelectorAll(".b3-list-item--focus").forEach(i => i.classList.remove("b3-list-item--focus"));
                        item.classList.add("b3-list-item--focus");
                        clearTimeout(hoverTimer);
                        hoverTimer = setTimeout(() => {
                            currentPreviewPath = path;
                            this.renderPreviewAsset(path, previewEl);
                        }, 150);
                    });

                    item.addEventListener("click", () => {
                        const finalVal = `background-image:url("${path}")`;
                        if (isBatch) {
                            this.batchUpdateCellValue(protyleInstance, avID, colID, finalVal, "text", avBlockID);
                        } else {
                            this.updateCellValue(protyleInstance, avID, rowID, colID, finalVal);
                        }
                        dialog.destroy();
                    });
                });
            }).catch(err => {
                listEl.innerHTML = `<div class="ft__center ft__error" style="padding: 16px;">查询失败: ${err.message}</div>`;
            });
        };

        inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
            const currentFocus = listEl.querySelector(".b3-list-item--focus") as HTMLElement;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = currentFocus ? currentFocus.nextElementSibling : listEl.querySelector(".b3-list-item");
                if (next && next.classList.contains("b3-list-item")) {
                    next.dispatchEvent(new MouseEvent("mouseenter"));
                    next.scrollIntoView({ block: "nearest" });
                }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const prev = currentFocus ? currentFocus.previousElementSibling : listEl.querySelector(".b3-list-item:last-child");
                if (prev && prev.classList.contains("b3-list-item")) {
                    prev.dispatchEvent(new MouseEvent("mouseenter"));
                    prev.scrollIntoView({ block: "nearest" });
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (currentFocus) currentFocus.click();
            }
        });

        renderList();
        inputEl.addEventListener("input", (e: any) => renderList(e.target.value));
        setTimeout(() => inputEl.focus(), 100);
    }

    private renderPreviewAsset(path: string, previewEl: HTMLElement) {
        previewEl.innerHTML = `<img src="/${path}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; box-shadow: var(--b3-dialog-shadow);">`;
    }

    private openTemplateDialog(protyleInstance: any, avID: string, rowID: string, colID: string, avBlockID: string, isBatch = false) {
        // @ts-ignore
        const renderID = protyleInstance ? protyleInstance.protyle.block.rootID : (avBlockID || "");
        
        const dialog = new Dialog({
            title: "选择模板",
            content: `
            <div id="sync-plugin-template-root" style="display:flex; height: 60vh; width: 100%; box-sizing: border-box; overflow: hidden; border-radius: 0 0 4px 4px;">
                <div class="template-sidebar" style="width: 280px; border-right: 1px solid var(--b3-border-color); display: flex; flex-direction: column; background-color: var(--b3-theme-surface);">
                    <div style="padding: 8px;">
                        <input class="b3-text-field fn__block" placeholder="搜索模板 (↑↓导航 Enter选择)" id="template-search-input" autofocus>
                    </div>
                    <div class="b3-list b3-list--background fn__flex-1" id="template-list" style="overflow-y: auto;">
                        <div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>
                    </div>
                </div>
                <div id="template-preview" class="fn__flex-1" style="padding: 16px; overflow-y: auto; background-color: var(--b3-theme-background);">
                    <div class="ft__center ft__on-surface" style="margin-top: 20vh;">请选择模板预览</div>
                </div>
            </div>`,
            width: "900px",
        });

        const listEl = dialog.element.querySelector("#template-list") as HTMLElement;
        const previewEl = dialog.element.querySelector("#template-preview") as HTMLElement;
        const inputEl = dialog.element.querySelector("#template-search-input") as HTMLInputElement;
        let currentPreviewPath = "";
        let hoverTimer: any = null;

        const renderList = (keyword = "") => {
            listEl.innerHTML = '<div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>';
            post("/api/search/searchTemplate", { k: keyword }).then((res: any) => {
                let html = "";
                const blocks = res.blocks || [];
                if (blocks.length > 0) {
                    blocks.forEach((item: any, index: number) => {
                        const isFocus = index === 0 ? " b3-list-item--focus" : "";
                        html += `<div class="b3-list-item b3-list-item--hide-action${isFocus}" 
                            data-path="${item.path}" 
                            data-content="${item.content.replace(/"/g, '&quot;')}"
                            style="cursor: pointer; padding: 4px 8px; margin: 2px 4px; border-radius: 4px;">
                            <span class="b3-list-item__text">${item.content}</span>
                        </div>`;
                    });
                } else {
                    html = `<div class="b3-list--empty" style="padding: 16px; text-align: center; color: var(--b3-theme-on-surface-light);">无匹配模板</div>`;
                }
                listEl.innerHTML = html;

                const firstItem = listEl.querySelector(".b3-list-item") as HTMLElement;
                if (firstItem) {
                    const path = firstItem.getAttribute("data-path")!;
                    currentPreviewPath = path;
                    this.renderPreview(renderID, path, previewEl);
                }

                listEl.querySelectorAll(".b3-list-item").forEach(item => {
                    const path = item.getAttribute("data-path")!;
                    const content = item.getAttribute("data-content")!;
                    
                    item.addEventListener("mouseenter", () => {
                        if (currentPreviewPath === path) return;
                        listEl.querySelectorAll(".b3-list-item--focus").forEach(i => i.classList.remove("b3-list-item--focus"));
                        item.classList.add("b3-list-item--focus");
                        clearTimeout(hoverTimer);
                        hoverTimer = setTimeout(() => {
                            currentPreviewPath = path;
                            this.renderPreview(renderID, path, previewEl);
                        }, 150);
                    });

                    item.addEventListener("click", () => {
                        if (isBatch) {
                            this.batchUpdateCellValue(protyleInstance, avID, colID, content, "text", avBlockID);
                        } else {
                            this.updateCellValue(protyleInstance, avID, rowID, colID, content);
                        }
                        dialog.destroy();
                    });
                });
            }).catch(err => {
                listEl.innerHTML = `<div class="ft__center ft__error" style="padding: 16px;">查询失败: ${err.message}</div>`;
            });
        };

        inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
            const currentFocus = listEl.querySelector(".b3-list-item--focus") as HTMLElement;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = currentFocus ? currentFocus.nextElementSibling : listEl.querySelector(".b3-list-item");
                if (next && next.classList.contains("b3-list-item")) {
                    next.dispatchEvent(new MouseEvent("mouseenter"));
                    next.scrollIntoView({ block: "nearest" });
                }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const prev = currentFocus ? currentFocus.previousElementSibling : listEl.querySelector(".b3-list-item:last-child");
                if (prev && prev.classList.contains("b3-list-item")) {
                    prev.dispatchEvent(new MouseEvent("mouseenter"));
                    prev.scrollIntoView({ block: "nearest" });
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (currentFocus) currentFocus.click();
            }
        });

        renderList();
        inputEl.addEventListener("input", (e: any) => renderList(e.target.value));
        setTimeout(() => inputEl.focus(), 100);
    }

    private renderPreview(id: string, path: string, previewEl: HTMLElement) {
        previewEl.innerHTML = '<div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>';
        post("/api/template/render", { id, path }).then((renderRes: any) => {
            if (renderRes && renderRes.content) {
                previewEl.innerHTML = `<div class="protyle-wysiwyg" style="padding:0; background:transparent;">${renderRes.content}</div>`;
            } else {
                previewEl.innerHTML = '<div class="ft__center ft__on-surface">模板内容为空</div>';
            }
        }).catch(err => {
            previewEl.innerHTML = `<div class="ft__center ft__error" style="padding: 20px;">渲染失败: ${err.message}</div>`;
        });
    }

    private async updateCellValue(protyleInstance: any, avID: string, rowID: string, colID: string, newValue: string) {
        try {
            console.log(`[Data] Updating cell: Row [${rowID}], Col [${colID}]`, { newValue });
            const avData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
            // The API response data structure usually has 'view' at the top level
            const view = avData.view || avData;
            const rows = view.rows || [];
            const row = rows.find((r: any) => r.id === rowID);
            
            // Columns might be directly on view or passed differently
            const columns = view.columns || [];
            const cellIndex = columns.findIndex((c: any) => c.id === colID);
            
            if (!row) {
                console.error("[Data] Row not found in rendered view", { rowID, availableRows: rows.length });
                throw new Error(`Row [${rowID}] not found`);
            }
            if (cellIndex === -1) {
                console.error("[Data] Column not found in rendered view", { colID, availableCols: columns.map(c => c.id) });
                throw new Error(`Column [${colID}] not found`);
            }
            
            const cellData = row.cells[cellIndex];
            if (!cellData) throw new Error("Cell data at index not found");
            
            const cellValue = cellData.value || {};
            const cellType = cellValue.type || cellData.valueType || "text";
            const updateData: any = { id: cellData.id, type: cellType };
            
            if (cellType === "text" || cellType === "template" || cellType === "url" || cellType === "email" || cellType === "phone") {
                updateData[cellType] = { content: newValue };
            } else if (cellType === "mAsset") {
                updateData.mAsset = [{ content: newValue, name: newValue.split('/').pop() }];
            } else {
                updateData.type = "text";
                updateData.text = { content: newValue };
            }
            
            const operation = {
                action: "updateAttrViewCell",
                id: cellData.id, avID: avID, keyID: colID, rowID: rowID, data: updateData
            };

            if (protyleInstance) {
                protyleInstance.transaction([operation]);
            } else {
                await post("/api/transactions", {
                    app: "plugin-index", // Use a fixed app ID or retrieved one
                    reqId: Date.now(),
                    transactions: [{ doOperations: [operation] }]
                });
            }
            showMessage(`✅ 已保存: ${newValue.substring(0, 20)}${newValue.length > 20 ? '...' : ''}`, 3000);
        } catch (e: any) {
            console.error("Update Value Error", e);
            showMessage(`❌ 保存失败: ${e.message}`, 3000, "error");
        }
    }

    private async findChildItemIDs(sourceBlockID: string, allRows: any[], columns: any[]) {
        const fatherCol = columns.find(c => c.name === "Father");
        if (!fatherCol) throw new Error("数据库中未找到 Father 字段");
        const fatherIndex = columns.indexOf(fatherCol);
        let childrenIDs: string[] = [];
        const findRecursive = (parentId: string) => {
            const children = allRows.filter(r => {
                const cell = r.cells[fatherIndex];
                const fatherVal = cell?.value?.text?.content;
                return fatherVal && fatherVal.trim() === parentId;
            });
            children.forEach(child => {
                childrenIDs.push(child.id);
                const blockCell = child.cells.find((c: any) => c.valueType === "block");
                if (blockCell && blockCell.value && blockCell.value.block && blockCell.value.block.id) {
                    findRecursive(blockCell.value.block.id);
                }
            });
        };
        findRecursive(sourceBlockID);
        return childrenIDs;
    }

    private async syncAttribute(avID: string, rowID: string, colID: string, mode: "level" | "siblings" | "descendants" | "filtered", avBlockID: string, protyleInstance: any) {
        try {
            showMessage("⏳ 正在同步...", 3000);
            const avData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
            const view = avData.view || avData; 
            const rows = view.rows || []; 
            
            let sourceRow;
            if (rowID === "first") {
                sourceRow = rows[0];
            } else {
                sourceRow = rows.find((r: any) => r.id === rowID);
            }
            
            const columns = view.columns || [];
            const colIndex = columns.findIndex((c: any) => c.id === colID);
            
            if (!sourceRow || colIndex === -1) throw new Error("Source row or column not found");

            const cleanValue = (val: any) => {
                const res: any = { type: val.type };
                ["text", "number", "mSelect", "mAsset", "block", "url", "phone", "email", "template", "checkbox", "relation", "rollup", "date"].forEach(f => {
                    if (val[f] !== undefined) res[f] = JSON.parse(JSON.stringify(val[f]));
                });
                return res;
            };

            const syncValue = cleanValue(sourceRow.cells[colIndex].value);
            const sourceBlockCell = sourceRow.cells.find((c: any) => c.valueType === "block");
            const sourceBlockID = sourceBlockCell?.value?.block?.id;
            if (!sourceBlockID) throw new Error("无法获取当前行对应的块 ID");

            let targetIDs: string[] = [];
            
            if (mode === "level") {
                const levelIdx = columns.findIndex((c: any) => c.name === "Level");
                if (levelIdx === -1) throw new Error("数据库中未找到 Level 字段");
                const targetLevel = sourceRow.cells[levelIdx]?.value?.number?.content;
                targetIDs = rows.filter((r: any) => r.cells[levelIdx]?.value?.number?.content == targetLevel && r.id !== sourceRow.id).map((r: any) => r.id);
            } else if (mode === "siblings") {
                const fatherIdx = columns.findIndex((c: any) => c.name === "Father");
                if (fatherIdx === -1) throw new Error("数据库中未找到 Father 字段");
                const targetFather = sourceRow.cells[fatherIdx]?.value?.text?.content || "";
                targetIDs = rows.filter((r: any) => (r.cells[fatherIdx]?.value?.text?.content || "") === targetFather && r.id !== sourceRow.id).map((r: any) => r.id);
            } else if (mode === "descendants") { 
                const pathIdx = columns.findIndex((c: any) => c.name === "Path");
                if (pathIdx !== -1) {
                    targetIDs = rows.filter((r: any) => {
                        const path = r.cells[pathIdx]?.value?.text?.content || "";
                        return path.includes(`/${sourceBlockID}/`) && r.id !== sourceRow.id;
                    }).map((r: any) => r.id);
                } else {
                    targetIDs = await this.findChildItemIDs(sourceBlockID, rows, columns); 
                }
            } else {
                // filtered: 同步到当前视图中除了源行以外的所有行
                targetIDs = rows.filter((r: any) => r.id !== sourceRow.id).map((r: any) => r.id);
            }

            if (targetIDs.length === 0) return showMessage("未找到目标项", 3000, "info");
            
            const ops = targetIDs.map(tid => {
                const cell = rows.find((r: any) => r.id === tid).cells[colIndex];
                const data = JSON.parse(JSON.stringify(syncValue)); 
                data.id = cell.id;
                return { action: "updateAttrViewCell", id: cell.id, avID, keyID: colID, rowID: tid, data };
            });

            if (avBlockID) {
                // @ts-ignore
                ops.push({ action: "doUpdateUpdated", id: avBlockID, data: formatDate(new Date()) });
            }

            if (protyleInstance) {
                protyleInstance.transaction(ops);
            } else {
                await post("/api/transactions", { 
                    app: "plugin-index", 
                    reqId: Date.now(),
                    transactions: [{ doOperations: ops }] 
                });
            }
            showMessage(`✅ 同步成功: 更新 ${targetIDs.length} 个项`, 3000);
        } catch (e: any) { 
            console.error("Sync Error", e);
            showMessage(`❌ 同步失败: ${e.message}`, 3000, "error"); 
        }
    }
}

export const avEventHandler = new AVEventHandler();
