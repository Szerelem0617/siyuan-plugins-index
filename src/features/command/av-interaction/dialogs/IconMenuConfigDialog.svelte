<script lang="ts">
    import { Dialog } from "siyuan";
    import { commandRegistry } from "../../registry/command-registry";
    import { parseIconMenuConfig, serializeIconMenuConfig, type IconMenuConfig, type IconMenuEntry } from "../../utils/icon-menu-config";

    export let dialog: Dialog;
    export let supertag: string = "";
    export let availableCommands: { id: string; name: string; description: string; params?: any[] }[] = [];
    export let currentIconMenuVal: string = "";
    export let onSave: (updatedVal: string) => Promise<void>;

    let config: IconMenuConfig = parseIconMenuConfig(currentIconMenuVal);
    let activeTab: "menu" | "button" = "menu";
    let searchQuery = "";
    let editingEntry: { list: "menu" | "button"; id: string } | null = null;
    let saving = false;

    $: list = activeTab === "menu" ? config.menu : config.button;
    $: selectedMap = Object.fromEntries(list.map(e => [e.id, true]));

    $: filteredCommands = availableCommands.filter(cmd => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return cmd.name.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q);
    });

    function toggle(id: string) {
        const sel = !!selectedMap[id];
        if (sel) {
            config = { ...config, [activeTab]: list.filter(e => e.id !== id) };
            if (editingEntry?.id === id) editingEntry = null;
        } else {
            config = { ...config, [activeTab]: [...list, { id }] };
        }
        console.log(`[IconMenuConfig] toggle ${id} -> ${!sel}（${activeTab} 现 ${config[activeTab].length} 项）`);
    }

    function openParams(listKey: "menu" | "button", id: string) {
        editingEntry = { list: listKey, id };
        console.log(`[IconMenuConfig] 打开 ${listKey} 参数配置: ${id}`);
    }

    function setEntryParam(id: string, key: string, value: string) {
        if (!editingEntry) return;
        const target = editingEntry.list;
        const current = (target === "menu" ? config.menu : config.button).find(e => e.id === id);
        if (!current) return;
        const params = { ...(current.params || {}) };
        if (value === "") {
            delete params[key];
        } else {
            params[key] = value;
        }
        const updated: IconMenuEntry = Object.keys(params).length > 0 ? { id, params } : { id };
        config = {
            ...config,
            [target]: (target === "menu" ? config.menu : config.button).map(e => e.id === id ? updated : e)
        };
    }

    async function handleSave() {
        saving = true;
        try {
            const value = serializeIconMenuConfig(config);
            console.log(`[IconMenuConfig] 保存 #${supertag}:`, value);
            await onSave(value);
            dialog.destroy();
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <div style="font-size: 13px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">
        🏷️ 配置 Supertag <span style="color: var(--indexos-accent-primary);">#{supertag}</span> Icon menu &amp; Button
    </div>

    <!-- Tab -->
    <div style="display: flex; gap: 4px; flex-shrink: 0;">
        <button
            type="button"
            class="indexos-btn-bordered"
            style="font-size: 11px; padding: 3px 12px; {activeTab === 'menu' ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : ''}"
            on:click={() => { activeTab = "menu"; editingEntry = null; }}
        >Icon Menu（{config.menu.length}）</button>
        <button
            type="button"
            class="indexos-btn-bordered"
            style="font-size: 11px; padding: 3px 12px; {activeTab === 'button' ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : ''}"
            on:click={() => { activeTab = "button"; editingEntry = null; }}
        >Button（{config.button.length}）</button>
    </div>

    <input
        type="text"
        class="b3-text-field fn__block"
        style="font-size: 12px; padding: 5px 10px; flex-shrink: 0;"
        placeholder="搜索命令..."
        bind:value={searchQuery}
    />

    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 4px;">
        {#each filteredCommands as cmd}
            {@const sel = !!selectedMap[cmd.id]}
            <div
                style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; border-left: 3px solid {sel ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {sel ? 'rgba(40, 81, 127, 0.06)' : 'transparent'};"
                on:click={() => toggle(cmd.id)}
            >
                <span
                    style="width: 16px; height: 16px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; background: {sel ? 'var(--indexos-accent-primary)' : 'var(--indexos-border-light)'}; color: #fff;"
                    title="勾选/取消"
                >{sel ? "✓" : ""}</span>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">⚡ {cmd.name}</div>
                    <div style="font-family: monospace; font-size: 10px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{cmd.id}</div>
                </div>
                {#if sel}
                    <button
                        type="button"
                        class="indexos-btn-bordered"
                        style="font-size: 10px; padding: 1px 7px; flex-shrink: 0;"
                        title="配置该命令的参数"
                        on:click={e => { e.stopPropagation(); e.preventDefault(); openParams(activeTab, cmd.id); }}
                    >⚙ 参数</button>
                {/if}
            </div>
        {/each}
        {#if filteredCommands.length === 0}
            <div style="text-align: center; padding: 24px; opacity: 0.5; font-size: 12px;">无匹配命令</div>
        {/if}
    </div>

    <!-- 参数配置面板（内联，随 editingEntry 立即出现） -->
    {#if editingEntry}
        {@const editingList = editingEntry.list === "menu" ? config.menu : config.button}
        {@const editingData = editingList.find(e => e.id === editingEntry.id)}
        {@const editingDef = commandRegistry.getCommand(editingEntry.id)}
        {@const editingParams = editingData?.params || {}}
        <div style="flex-shrink: 0; border: 1px solid var(--indexos-accent-primary); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; background: rgba(40, 81, 127, 0.04);">
            <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center;">
                ⚙ {editingEntry.id} 参数
                <button type="button" style="margin-left: auto; font-size: 11px; padding: 0 4px; cursor: pointer; background: none; border: none; opacity: 0.5;" on:click={() => { editingEntry = null; }}>✕</button>
            </div>
            {#if (editingDef?.params || []).length === 0}
                <div style="font-size: 11px; color: var(--indexos-text-muted);">该命令没有可配置参数。</div>
            {:else}
                {#each (editingDef?.params || []) as p}
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0; width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{p.label || p.key}</span>
                        <input
                            type="text"
                            style="flex: 1; min-width: 0; font-size: 11px; padding: 2px 6px; border: 1px solid {editingParams[p.key] ? 'rgba(40, 81, 127, 0.55)' : 'var(--indexos-border-light)'}; border-radius: 3px; background: var(--indexos-bg-container); color: var(--indexos-text-main);"
                            value={editingParams[p.key] || ""}
                            placeholder="空 = 用 Command-DB 配置；可写 &#123;&#123;变量&#125;&#125;"
                            on:input={e => setEntryParam(editingEntry.id, p.key, e.currentTarget.value)}
                        />
                    </div>
                {/each}
            {/if}
        </div>
    {/if}

    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>保存配置</button>
    </div>
</div>
