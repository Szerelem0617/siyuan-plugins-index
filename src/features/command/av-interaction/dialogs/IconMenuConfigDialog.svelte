<script lang="ts">
    import { Dialog } from "siyuan";
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";

    export let dialog: Dialog;
    export let supertag: string = "";
    export let availableCommands: { id: string; name: string; description: string }[] = [];
    export let currentIconMenuVal: string = "";
    export let onSave: (updatedVal: string) => Promise<void>;

    let searchQuery = "";
    
    // Parse current checked Command IDs
    let selectedIds: string[] = currentIconMenuVal
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

    onMount(() => {
        console.log("[IconMenu-Dialog] opened", {
            supertag,
            availableCommands: availableCommands.map(c => c.id),
            currentIconMenuVal,
            selectedIds
        });
    });

    $: filteredCommands = availableCommands.filter(cmd => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return cmd.name.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q);
    });

    function toggleSelect(cmdId: string) {
        const isAdding = !selectedIds.includes(cmdId);
        selectedIds = isAdding ? [...selectedIds, cmdId] : selectedIds.filter(id => id !== cmdId);
        console.log(`[IconMenu-Dialog] toggleSelect ${isAdding ? "ADD" : "REMOVE"} ${cmdId} -> selectedIds:`, selectedIds);
    }

    async function handleSave() {
        const newVal = selectedIds.join(", ");
        console.log(`[IconMenu-Dialog] handleSave newVal="${newVal}"`);
        try {
            await onSave(newVal);
            console.log("[IconMenu-Dialog] onSave succeeded, closing dialog");
            dialog.destroy();
        } catch (e) {
            console.error("[IconMenu-Dialog] onSave failed:", e);
            showMessage(`保存 Icon Menu 配置失败: ${e.message}`, 5000, "error");
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 12px;">
    <div style="font-size: 13px; font-weight: 600; color: var(--indexos-text-main);">
        🏷️ 配置 Supertag <span style="color: var(--indexos-accent-primary);">#{supertag}</span> 图标菜单 (Icon Menu)
    </div>

    <div style="font-size: 11px; opacity: 0.7; color: var(--indexos-text-muted);">
        从该 Supertag 已绑定的命令中选择需要挂载到行内 Icon Menu 的项目：
    </div>

    <input
        type="text"
        class="b3-text-field fn__block"
        style="font-size: 12px; padding: 6px 10px;"
        placeholder="搜索命令名称或 Command ID..."
        bind:value={searchQuery}
    />

    <div class="fn__flex-1" style="overflow-y: auto; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--indexos-border-light); border-radius: 6px; padding: 8px; background: var(--indexos-bg-container);">
        {#if filteredCommands.length === 0}
            <div style="text-align: center; padding: 24px; opacity: 0.5; font-size: 12px;">
                {availableCommands.length === 0 ? "该 Supertag 尚未在'绑定命令'中加入命令" : "未匹配到相关命令"}
            </div>
        {:else}
            {#each filteredCommands as cmd}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div 
                    class="b3-list-item"
                    style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 6px; cursor: pointer; border: 1px solid {selectedIds.includes(cmd.id) ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {selectedIds.includes(cmd.id) ? 'var(--indexos-weak-accent)' : 'transparent'};"
                    on:click={() => toggleSelect(cmd.id)}
                >
                    <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; overflow: hidden; margin-right: 8px;">
                        <div style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ⚡ {cmd.name}
                        </div>
                        <div style="font-family: monospace; font-size: 10px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            {cmd.id}
                        </div>
                    </div>
                    <input 
                        type="checkbox" 
                        class="b3-switch" 
                        checked={selectedIds.includes(cmd.id)}
                        on:change={() => toggleSelect(cmd.id)}
                        on:click|stopPropagation
                    />
                </div>
            {/each}
        {/if}
    </div>

    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; margin-top: 4px;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave}>保存配置</button>
    </div>
</div>
