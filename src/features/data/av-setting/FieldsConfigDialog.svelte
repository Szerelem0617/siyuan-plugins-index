<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { post } from "../../../shared/api-client/request";
    import { executeWritableSql } from "../../sqlite/sqlite-manager";

    export let avId: string;
    export let viewId: string;
    export let viewName: string;
    export let dialog: any;

    let columnsList: { id: string; name: string; hidden: boolean }[] = [];
    let loading = true;
    let saving = false;

    // Reactively compute select-all checkbox state
    $: allChecked = columnsList.length > 0 && columnsList.every(c => !c.hidden);
    $: isIndeterminate = columnsList.length > 0 && columnsList.some(c => !c.hidden) && !columnsList.every(c => !c.hidden);

    onMount(async () => {
        await loadViewColumns();
    });

    async function loadViewColumns() {
        try {
            loading = true;
            const avData = await post("/api/av/renderAttributeView", { id: avId });
            const viewsList = avData.views || avData.view?.views || [];
            const targetView = viewsList.find((v: any) => v.id === viewId);
            
            if (!targetView) {
                showMessage("未找到目标视图，无法配置字段", 3000, "error");
                dialog.destroy();
                return;
            }

            // Debug log response structure
            console.log("[FieldsConfig-Debug] avData:", avData);
            console.log("[FieldsConfig-Debug] targetView:", targetView);

            // 1. Get all columns of the AV schema from the main view (which always contains names)
            const mainSchemaCols = avData.view?.columns || avData.columns || [];
            console.log("[FieldsConfig-Debug] mainSchemaCols:", mainSchemaCols);
            
            // 2. Get the view-specific columns settings (which contains hidden status)
            const viewSpecificCols = targetView.columns || targetView.table?.columns || [];
            console.log("[FieldsConfig-Debug] viewSpecificCols:", viewSpecificCols);

            // 3. Merge them by matching column ID
            columnsList = mainSchemaCols.map((mainCol: any) => {
                const viewColSetting = viewSpecificCols.find((vc: any) => vc.id === mainCol.id);
                const isHidden = viewColSetting ? !!viewColSetting.hidden : false;
                
                return {
                    id: mainCol.id,
                    name: mainCol.name || mainCol.keyName || "",
                    hidden: isHidden
                };
            }).filter((c: any) => c.name && c.name.toLowerCase() !== "主键" && c.name.toLowerCase() !== "primary key");

            console.log("[FieldsConfig-Debug] Final columnsList:", columnsList);
        } catch (e: any) {
            console.error("[FieldsConfig] Failed to load columns:", e);
            showMessage(`加载字段列表失败: ${e.message || e}`, 5000, "error");
        } finally {
            loading = false;
        }
    }

    function toggleAll(event: Event) {
        const checked = (event.target as HTMLInputElement).checked;
        columnsList = columnsList.map(c => ({
            ...c,
            hidden: !checked
        }));
    }

    async function save() {
        try {
            saving = true;
            showMessage("⏳ 正在保存视图字段配置...", 2000);
            
            const cleanAvId = avId.replace(/[^a-zA-Z0-9]/g, "_");
            const tableName = `av_${cleanAvId}`;

            // Run SQL ALTER VIEW commands sequentially
            for (const col of columnsList) {
                const isHidden = col.hidden;
                const sql = `ALTER VIEW "${viewName}" ON "${tableName}" SET COLUMN "${col.name}" HIDDEN ${isHidden ? 1 : 0}`;
                console.log("[FieldsConfig] Running SQL:", sql);
                const res = await executeWritableSql(sql);
                if (!res || !res.success) {
                    throw new Error(res?.message || `配置字段 '${col.name}' 失败`);
                }
            }

            showMessage("✓ 视图字段配置保存成功");
            dialog.destroy();
        } catch (e: any) {
            console.error("[FieldsConfig] Failed to save column hidden state:", e);
            showMessage(`保存失败: ${e.message || e}`, 5000, "error");
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box;">
    <div style="font-weight: bold; font-size: 14px; margin-bottom: 8px;">
        配置视图字段显示 - {viewName}
    </div>
    <div class="b3-label__text" style="font-size: 12px; opacity: 0.7; margin-bottom: 16px;">
        勾选的字段将在当前过滤视图中显示，未勾选的字段将被隐藏。
    </div>

    <div class="fn__hr" style="margin-bottom: 12px;"></div>

    {#if loading}
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; opacity: 0.6;">
            ⏳ 正在加载视图字段...
        </div>
    {:else}
        <!-- Select All Header -->
        <div class="fn__flex" style="align-items: center; padding: 6px 8px; font-weight: bold; background: var(--b3-theme-surface-lighter); border-radius: 4px; margin-bottom: 8px;">
            <label class="fn__flex" style="align-items: center; cursor: pointer; gap: 8px; width: 100%;">
                <input 
                    type="checkbox" 
                    class="b3-switch" 
                    checked={allChecked} 
                    indeterminate={isIndeterminate}
                    on:change={toggleAll}
                />
                <span>显示所有字段 (全选 / 全不选)</span>
            </label>
        </div>

        <!-- Scrollable Columns List -->
        <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding: 4px;">
            {#each columnsList as col}
                <div class="fn__flex" style="align-items: center; padding: 6px 8px; border-bottom: 1px dashed var(--b3-theme-surface-lighter);">
                    <label class="fn__flex" style="align-items: center; cursor: pointer; gap: 8px; width: 100%;">
                        <input 
                            type="checkbox" 
                            class="b3-switch" 
                            checked={!col.hidden}
                            on:change={(e) => {
                                col.hidden = !e.target.checked;
                                columnsList = columnsList;
                            }}
                        />
                        <span>{col.name}</span>
                    </label>
                </div>
            {/each}
        </div>
    {/if}

    <div class="fn__flex" style="margin-top: 16px; justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button" disabled={loading || saving} on:click={save}>保存</button>
    </div>
</div>
