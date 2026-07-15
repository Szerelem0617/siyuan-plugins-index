<script lang="ts">
    import { onMount } from "svelte";

    export let dialog: any;
    export let commandName: string;
    export let currentValue: string;
    export let onSave: (updatedValue: string) => Promise<void>;

    const ALL_ENTRIES = [
        { id: "topbar", label: "顶栏 (Top Bar)" },
        { id: "inline", label: "行内按钮 (Inline Button)" },
        { id: "palette", label: "快捷命令 (Command Palette)" }
    ];

    let selectedMap: Record<string, boolean> = {
        topbar: false,
        inline: false,
        palette: false
    };

    onMount(() => {
        if (currentValue) {
            const items = currentValue.split(/[,，]/).map(s => s.trim()).filter(Boolean);
            selectedMap.topbar = items.includes("顶栏");
            selectedMap.inline = items.includes("行内按钮");
            selectedMap.palette = items.includes("快捷命令");
        }
    });

    function toggleSelect(id: string) {
        selectedMap[id] = !selectedMap[id];
        selectedMap = { ...selectedMap };
    }

    async function handleSave() {
        const result: string[] = [];
        if (selectedMap.topbar) result.push("顶栏");
        if (selectedMap.inline) result.push("行内按钮");
        if (selectedMap.palette) result.push("快捷命令");

        const updatedVal = result.join(", ");
        await onSave(updatedVal);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box;">
    <!-- Dialog Header -->
    <div style="margin-bottom: 16px; flex-shrink: 0;">
        <div style="font-size: 16px; font-weight: bold; color: var(--b3-theme-on-surface); display: flex; align-items: center; gap: 8px;">
            <svg class="b3-list-item__graphic" style="height: 18px; width: 18px; color: var(--b3-theme-primary);"><use xlink:href="#iconLayout"></use></svg>
            <span>配置注册位置 (UI Entries)</span>
        </div>
        <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 6px; padding: 6px; border-radius: 4px; background-color: var(--b3-theme-surface); border: 1px solid var(--b3-border-color);">
            <div style="font-weight: bold;">命令: <span style="color: var(--b3-theme-primary); font-family: monospace;">{commandName}</span></div>
            <div style="margin-top: 2px;">说明：请选择该命令在思源 UI 中的注册展示入口。</div>
        </div>
    </div>

    <!-- Scrollable Checklist Content -->
    <div style="flex: 1; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 8px;">
        <div style="font-size: 12px; font-weight: bold; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;">
            请勾选需要显示的入口：
        </div>
        {#each ALL_ENTRIES as entry}
            {@const isSelected = selectedMap[entry.id]}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div 
                class="b3-list-item" 
                style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 4px; cursor: pointer; border: 1px solid {isSelected ? 'var(--b3-theme-primary)' : 'var(--b3-border-color)'}; background-color: {isSelected ? 'var(--b3-theme-background-hover)' : 'transparent'}; transition: all 0.15s ease;"
                on:click={() => toggleSelect(entry.id)}
            >
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                    <input 
                        type="checkbox" 
                        class="b3-checkbox" 
                        checked={isSelected} 
                        style="pointer-events: none;"
                    />
                    <span style="font-weight: {isSelected ? 'bold' : 'normal'}; color: var(--b3-theme-on-surface); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; font-size: 13px;">
                        {entry.label}
                    </span>
                </div>
            </div>
        {/each}
    </div>

    <!-- Dialog Footer -->
    <div style="margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" style="padding: 6px 16px; font-size: 13px;" on:click={() => dialog.destroy()}>
            取消
        </button>
        <button class="b3-button b3-button--primary" style="padding: 6px 20px; font-size: 13px; font-weight: 500;" on:click={handleSave}>
            保存配置
        </button>
    </div>
</div>
