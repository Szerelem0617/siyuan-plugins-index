<script lang="ts">
    export let commands: any[] = [];
    export let onSelect: (cmd: any) => void;
    
    let searchQuery = "";
    
    $: filteredCommands = commands.filter(cmd => 
        (cmd.name || "").toLowerCase().includes(searchQuery.toLowerCase()) || 
        (cmd.id || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cmd.description || "").toLowerCase().includes(searchQuery.toLowerCase())
    );
</script>

<div style="display: flex; flex-direction: column; height: 100%; padding: 12px; box-sizing: border-box; background: var(--b3-theme-background);">
    <div style="margin-bottom: 12px; flex-shrink: 0;">
        <input 
            type="text" 
            class="b3-text-field fn__block" 
            placeholder="搜索内置命令..." 
            bind:value={searchQuery}
            style="padding: 6px 10px; font-size: 13px;"
        />
    </div>
    
    <div style="flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
        {#each filteredCommands as cmd}
            <div 
                class="b3-list-item" 
                style="padding: 8px 10px; border-radius: 4px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: background-color 0.15s ease;"
                on:click={() => onSelect(cmd)}
            >
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: bold; color: var(--b3-theme-on-background); font-size: 13px;">
                        {cmd.name}
                    </span>
                    <code style="font-size: 11px; padding: 2px 4px; border-radius: 3px; background: var(--b3-theme-surface); color: var(--b3-theme-primary);">
                        {cmd.id}
                    </code>
                </div>
                {#if cmd.description}
                    <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); line-height: 1.4;">
                        {cmd.description}
                    </div>
                {/if}
            </div>
        {/each}
        {#if filteredCommands.length === 0}
            <div style="text-align: center; color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 20px;">
                无匹配的命令
            </div>
        {/if}
    </div>
</div>

<style>
    .b3-list-item:hover {
        background-color: var(--b3-list-hover);
    }
</style>
