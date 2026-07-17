<script lang="ts">
    import { onMount } from "svelte";

    export let dialog: any;
    export let supertag: string;
    export let boundCommands: { label: string; rowId: string }[];
    export let currentValue: string;
    export let onSave: (updatedValue: string) => Promise<void>;

    // Target structure
    let eventType: string = "tag_created";
    let condition: string = "";
    let selectedList: string[] = [];

    // Helper parser
    function parseConditional(text: string) {
        const textTrim = (text || "").trim();
        if (!textTrim) return;

        // Try matching the standard format: [event](condition) -> cmd1, cmd2
        const match = textTrim.match(/^\[([^\]]+)\](?:\(([^\)]+)\))?\s*->\s*(.+)$/);
        if (match) {
            const rawEvent = match[1].trim();
            condition = match[2] ? match[2].trim() : "";
            const cmdsText = match[3].trim();

            if (rawEvent === "打上标签时" || rawEvent === "tag_created") {
                eventType = "tag_created";
            } else {
                eventType = rawEvent;
            }
            selectedList = cmdsText.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        } else {
            // Legacy format fallback: comma-separated command labels
            eventType = "tag_created";
            condition = "";
            selectedList = textTrim.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        }
    }

    onMount(() => {
        console.log("[TriggerDialog-Debug] mounted with:", { supertag, boundCommands, currentValue });
        parseConditional(currentValue);
        console.log("[TriggerDialog-Debug] parsed selectedList:", selectedList, "condition:", condition, "eventType:", eventType);
    });

    function toggleSelect(label: string) {
        console.log("[TriggerDialog-Debug] toggleSelect clicked for label:", label);
        const index = selectedList.indexOf(label);
        if (index > -1) {
            selectedList = selectedList.filter(item => item !== label);
        } else {
            selectedList = [...selectedList, label];
        }
        console.log("[TriggerDialog-Debug] selectedList is now:", selectedList);
    }

    async function handleSave() {
        if (selectedList.length === 0) {
            await onSave("");
            dialog.destroy();
            return;
        }

        let eventLabel = "打上标签时";
        if (eventType === "tag_created") eventLabel = "打上标签时";

        const condPart = condition.trim() ? `(${condition.trim()})` : "";
        const cmdsPart = selectedList.join(", ");
        const serialized = `[${eventLabel}]${condPart} -> ${cmdsPart}`;

        await onSave(serialized);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box;">
    <!-- Dialog Header -->
    <div style="margin-bottom: 12px; flex-shrink: 0;">
        <div style="font-size: 16px; font-weight: bold; color: var(--b3-theme-on-surface); display: flex; align-items: center; gap: 8px;">
            <svg class="b3-list-item__graphic" style="height: 18px; width: 18px; color: var(--b3-theme-primary);"><use xlink:href="#iconPlay"></use></svg>
            <span>配置条件触发器 (Conditional Triggers)</span>
        </div>
        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 6px; padding: 6px; border-radius: 4px; background-color: var(--b3-theme-surface); border: 1px solid var(--b3-border-color);">
            <div style="font-weight: bold;">超级标签: <span style="color: var(--b3-theme-primary); font-family: monospace;">{supertag}</span></div>
        </div>
    </div>

    <!-- Trigger Event & Condition Settings -->
    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; flex-shrink: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--b3-border-color); background: var(--b3-theme-surface);">
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light);">触发事件 (Event)</label>
            <select class="b3-select" style="font-size: 12px; padding: 4px;" bind:value={eventType}>
                <option value="tag_created">打上标签时 (tag_created)</option>
            </select>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light);">触发条件 (Condition) - 可选</label>
            <input 
                type="text" 
                class="b3-text-field" 
                style="font-size: 12px; padding: 4px 8px;" 
                placeholder="例如: is_task_completed，留空代表无条件执行" 
                bind:value={condition} 
            />
        </div>
    </div>

    <!-- Scrollable Checklist Content -->
    <div style="flex: 1; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 6px;">
        {#if boundCommands.length === 0}
            <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 30px 0; font-size: 12px;">
                ⚠️ 该超级标签未绑定任何命令。<br/>
                <span style="font-size: 11px; opacity: 0.8; display: inline-block; margin-top: 4px;">
                    请先在【绑定命令】列中为该行关联命令。
                </span>
            </div>
        {:else}
            <div style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light); margin-bottom: 2px;">
                选择并排序动作命令 (Actions)：
            </div>
            {#each boundCommands as cmd}
                {@const selIndex = selectedList.indexOf(cmd.label)}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div 
                    class="index-trigger-list-item" 
                    style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-radius: 4px; cursor: pointer; border: 1px solid {selIndex > -1 ? 'var(--b3-theme-primary)' : 'var(--b3-border-color)'}; background-color: {selIndex > -1 ? 'var(--b3-theme-background-hover)' : 'transparent'}; transition: all 0.1s ease;"
                    on:click={() => toggleSelect(cmd.label)}
                >
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                        <input 
                            type="checkbox" 
                            class="b3-checkbox" 
                            checked={selIndex > -1} 
                            on:click|stopPropagation={() => toggleSelect(cmd.label)}
                        />
                        <span style="font-size: 12px; font-weight: {selIndex > -1 ? 'bold' : 'normal'}; color: var(--b3-theme-on-surface); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                            {cmd.label}
                        </span>
                    </div>

                    {#if selIndex > -1}
                        <span 
                            style="background-color: var(--b3-theme-primary); color: var(--b3-theme-on-primary); font-size: 10px; font-weight: bold; height: 16px; width: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"
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
    <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" style="padding: 4px 12px; font-size: 12px;" on:click={() => dialog.destroy()}>
            取消
        </button>
        <button class="b3-button b3-button--primary" style="padding: 4px 16px; font-size: 12px; font-weight: 500;" on:click={handleSave}>
            保存配置
        </button>
    </div>
</div>

<style>
    .index-trigger-list-item:hover {
        background-color: var(--b3-theme-background-hover) !important;
    }
</style>
