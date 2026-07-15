<script lang="ts">
    import { onMount } from "svelte";
    import { post } from "../../../shared/api-client/request";
    import { showMessage } from "siyuan";

    export let dialog: any;
    export let blockId: string;
    export let availableTags: string[]; // From SUPERTAG_REGISTRY
    export let blockEl: HTMLElement;
    export let onSaveComplete: () => void;

    let selectedTags: string[] = [];
    let isSaving = false;

    onMount(async () => {
        // Query current custom-supertags
        try {
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes || {};
            const rawTags = attrs["custom-supertags"];

            if (rawTags) {
                try {
                    const parsed = JSON.parse(rawTags);
                    if (Array.isArray(parsed)) selectedTags = parsed;
                } catch (_) {
                    selectedTags = rawTags.split(/[, ]/).map((s: string) => s.trim()).filter(Boolean);
                }
            }
        } catch (e) {
            console.error("Failed to load block supertags:", e);
        }
    });

    async function handleSave() {
        isSaving = true;
        try {
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-supertags": selectedTags.length > 0 ? JSON.stringify(selectedTags) : ""
                }
            });

            // Update HTML attribute so instant rendering picks it up
            if (blockEl) {
                blockEl.setAttribute("custom-supertags", selectedTags.length > 0 ? JSON.stringify(selectedTags) : "");
            }

            showMessage("超级标签保存成功");
            onSaveComplete();
            dialog.destroy();
        } catch (e) {
            console.error("Failed to save supertags:", e);
            showMessage("保存失败", 3000, "error");
        } finally {
            isSaving = false;
        }
    }

    function toggleTag(tag: string) {
        if (selectedTags.includes(tag)) {
            selectedTags = selectedTags.filter(t => t !== tag);
        } else {
            selectedTags = [...selectedTags, tag];
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box;">
    <!-- Header -->
    <div style="margin-bottom: 12px; flex-shrink: 0;">
        <div style="font-size: 15px; font-weight: bold; color: var(--b3-theme-on-surface); display: flex; align-items: center; gap: 8px;">
            <svg class="b3-list-item__graphic" style="height: 18px; width: 18px; color: var(--b3-theme-primary);"><use xlink:href="#iconTags"></use></svg>
            <span>管理超级标签</span>
        </div>
        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 4px; font-family: monospace;">
            Block ID: {blockId}
        </div>
    </div>

    <!-- Tag List -->
    <div style="flex: 1; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;">
        {#if availableTags.length === 0}
            <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 30px 0; font-size: 12px;">
                ⚠️ 暂无已注册的超级标签。<br/>
                <span style="font-size: 11px; opacity: 0.8; display: inline-block; margin-top: 4px;">
                    请先在超级标签表中配置超级标签。
                </span>
            </div>
        {:else}
            <div style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;">
                选择要挂载的超级标签 (Supertags)：
            </div>
            {#each availableTags as tag}
                {@const isChecked = selectedTags.includes(tag)}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div 
                    class="index-supertag-menu-item" 
                    style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 4px; cursor: pointer; border: 1px solid {isChecked ? 'var(--b3-theme-primary-light)' : 'var(--b3-border-color)'}; background-color: {isChecked ? 'var(--b3-theme-background-hover)' : 'transparent'}; transition: all 0.1s ease;"
                    on:click={() => toggleTag(tag)}
                >
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input 
                            type="checkbox" 
                            class="b3-checkbox" 
                            checked={isChecked} 
                            on:click|stopPropagation={() => toggleTag(tag)}
                        />
                        <span style="font-size: 12px; font-weight: {isChecked ? 'bold' : 'normal'}; color: var(--b3-theme-on-surface);">
                            {tag}
                        </span>
                    </div>
                </div>
            {/each}
        {/if}
    </div>

    <!-- Footer -->
    <div style="display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; border-top: 1px solid var(--b3-border-color); padding-top: 12px;">
        <button class="b3-button b3-button--cancel" style="padding: 4px 12px; font-size: 12px;" on:click={() => dialog.destroy()} disabled={isSaving}>
            取消
        </button>
        <button class="b3-button b3-button--primary" style="padding: 4px 16px; font-size: 12px; font-weight: 500;" on:click={handleSave} disabled={isSaving}>
            {isSaving ? "保存中..." : "保存"}
        </button>
    </div>
</div>

<style>
    .index-supertag-menu-item:hover {
        background-color: var(--b3-theme-background-hover) !important;
    }
</style>
