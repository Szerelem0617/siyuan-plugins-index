<script lang="ts">
    import { onMount } from "svelte";

    export let dialog: any;
    export let supertag: string;
    export let boundCommands: { label: string; rowId: string }[];
    export let currentValue: string;
    export let onSave: (updatedValue: string) => Promise<void>;

    // List of selected command labels in order
    let selectedList: string[] = [];

    onMount(() => {
        // Parse current value
        if (currentValue) {
            selectedList = currentValue.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        }
    });

    function toggleSelect(label: string) {
        const index = selectedList.indexOf(label);
        if (index > -1) {
            // Remove from selected list
            selectedList = selectedList.filter(item => item !== label);
        } else {
            // Add to the end of selected list
            selectedList = [...selectedList, label];
        }
    }

    function getSelectedIndex(label: string): number {
        return selectedList.indexOf(label);
    }

    async function handleSave() {
        const updatedVal = selectedList.join(", ");
        await onSave(updatedVal);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box;">
    <!-- Dialog Header -->
    <div style="margin-bottom: 16px; flex-shrink: 0;">
        <div style="font-size: 16px; font-weight: bold; color: var(--b3-theme-on-surface); display: flex; align-items: center; gap: 8px;">
            <svg class="b3-list-item__graphic" style="height: 18px; width: 18px; color: var(--b3-theme-primary);"><use xlink:href="#iconPlay"></use></svg>
            <span>配置创建时触发命令 (On Create)</span>
        </div>
        <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 6px; padding: 6px; border-radius: 4px; background-color: var(--b3-theme-surface); border: 1px solid var(--b3-border-color);">
            <div style="font-weight: bold;">超级标签: <span style="color: var(--b3-theme-primary); font-family: monospace;">{supertag}</span></div>
            <div style="margin-top: 2px;">说明：在给块添加此标签时，将按选择的顺序依次自动执行以下命令。</div>
        </div>
    </div>

    <!-- Scrollable Checklist Content -->
    <div style="flex: 1; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 8px;">
        {#if boundCommands.length === 0}
            <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 40px 0; font-size: 13px;">
                ⚠️ 该超级标签未绑定任何命令。<br/>
                <span style="font-size: 12px; opacity: 0.8; display: inline-block; margin-top: 6px;">
                    请先在【绑定命令】列中为该行关联命令，然后重试。
                </span>
            </div>
        {:else}
            <div style="font-size: 12px; font-weight: bold; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;">
                可选的绑定命令 (点击以按顺序选择)：
            </div>
            {#each boundCommands as cmd}
                {@const selIndex = getSelectedIndex(cmd.label)}
                <div 
                    class="b3-list-item" 
                    style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 4px; cursor: pointer; border: 1px solid {selIndex > -1 ? 'var(--b3-theme-primary)' : 'var(--b3-border-color)'}; background-color: {selIndex > -1 ? 'var(--b3-theme-background-hover)' : 'transparent'};"
                    on:click={() => toggleSelect(cmd.label)}
                >
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                        <input 
                            type="checkbox" 
                            class="b3-checkbox" 
                            checked={selIndex > -1} 
                            style="pointer-events: none;"
                        />
                        <span style="font-weight: {selIndex > -1 ? 'bold' : 'normal'}; color: var(--b3-theme-on-surface); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                            {cmd.label}
                        </span>
                    </div>

                    {#if selIndex > -1}
                        <span 
                            style="background-color: var(--b3-theme-primary); color: var(--b3-theme-on-primary); font-size: 11px; font-weight: bold; height: 18px; width: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"
                            title="第 {selIndex + 1} 个执行"
                        >
                            {selIndex + 1}
                        </span>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- Dialog Footer -->
    <div class="fn__hr" style="margin: 16px 0 12px 0; flex-shrink: 0;"></div>
    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>
            取消
        </button>
        <button 
            class="b3-button b3-button--primary" 
            disabled={boundCommands.length === 0} 
            on:click={handleSave}
        >
            保存配置
        </button>
    </div>
</div>
