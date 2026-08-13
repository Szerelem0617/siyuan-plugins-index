<script lang="ts">
    import { Dialog } from "siyuan";
    import { commandRegistry } from "../../registry/command-registry";
    import { parseIconMenuConfig, serializeIconMenuConfig, type IconMenuConfig, type IconMenuEntry } from "../../utils/icon-menu-config";
    import { getSupertagAutoContextInfo } from "../../supertag/core/supertag-auto-context";

    export let dialog: Dialog;
    export let supertag: string = "";
    export let availableCommands: { id: string; name: string; description: string; params?: any[] }[] = [];
    export let currentIconMenuVal: string = "";
    export let conditionalVal: string = "";
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

    <!-- 极客工业风高光 TabBar -->
    <div style="display: flex; gap: 8px; flex-shrink: 0; background: var(--indexos-bg-surface); padding: 4px; border-radius: 8px; border: 1px solid var(--indexos-border-subtle);">
        <button
            type="button"
            style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; padding: 7px 14px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; border: 1px solid {activeTab === 'menu' ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {activeTab === 'menu' ? 'var(--indexos-bg-card)' : 'transparent'}; color: {activeTab === 'menu' ? 'var(--indexos-accent-primary)' : 'var(--indexos-text-muted)'}; font-weight: {activeTab === 'menu' ? '700' : '500'}; box-shadow: {activeTab === 'menu' ? '0 2px 6px rgba(0, 0, 0, 0.08)' : 'none'};"
            on:click={() => { activeTab = "menu"; editingEntry = null; }}
        >
            <span>📌 Icon Menu 菜单栏</span>
            <span style="font-size: 10px; padding: 1px 6px; border-radius: 10px; background: {activeTab === 'menu' ? 'var(--indexos-accent-primary)' : 'rgba(161, 196, 230, 0.3)'}; color: {activeTab === 'menu' ? '#FFFFFF' : 'var(--indexos-text-muted)'};">
                {config.menu.length}
            </span>
        </button>

        <button
            type="button"
            style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; padding: 7px 14px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; border: 1px solid {activeTab === 'button' ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {activeTab === 'button' ? 'var(--indexos-bg-card)' : 'transparent'}; color: {activeTab === 'button' ? 'var(--indexos-accent-primary)' : 'var(--indexos-text-muted)'}; font-weight: {activeTab === 'button' ? '700' : '500'}; box-shadow: {activeTab === 'button' ? '0 2px 6px rgba(0, 0, 0, 0.08)' : 'none'};"
            on:click={() => { activeTab = "button"; editingEntry = null; }}
        >
            <span>🔘 Button 块下方按钮</span>
            <span style="font-size: 10px; padding: 1px 6px; border-radius: 10px; background: {activeTab === 'button' ? 'var(--indexos-accent-primary)' : 'rgba(161, 196, 230, 0.3)'}; color: {activeTab === 'button' ? '#FFFFFF' : 'var(--indexos-text-muted)'};">
                {config.button.length}
            </span>
        </button>
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
                role="button"
                tabindex="0"
                style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; border-left: 3px solid {sel ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {sel ? 'rgba(40, 81, 127, 0.06)' : 'transparent'};"
                on:click={() => toggle(cmd.id)}
                on:keydown={e => { if (e.key === "Enter" || e.key === " ") { toggle(cmd.id); } }}
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
                    {@const itemData = (activeTab === 'menu' ? config.menu : config.button).find(e => e.id === cmd.id)}
                    {@const hasLayer3Params = !!(itemData && itemData.params && Object.values(itemData.params).some(v => v !== undefined && String(v).trim() !== ''))}
                    {@const autoAnalysis = getSupertagAutoContextInfo(supertag, cmd.id, conditionalVal)}
                    {@const hasAutoContextMatch = Object.values(autoAnalysis).some(m => m.matched)}
                    {@const isCustomized = hasLayer3Params || hasAutoContextMatch}
                    <button
                        type="button"
                        class="indexos-btn-bordered"
                        style="font-size: 10px; padding: 1px 7px; flex-shrink: 0; {isCustomized ? 'border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; color: var(--indexos-detached-gold, #D9A74A) !important; background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.09)) !important; font-weight: 600;' : ''}"
                        title={isCustomized ? (hasLayer3Params ? '👑 已配置客制化入参 (Golden Customization)' : '⚡ 已激活 Auto-Context 出参匹配感应') : '配置该命令的参数'}
                        on:click={e => { e.stopPropagation(); e.preventDefault(); openParams(activeTab, cmd.id); }}
                    >⚙ 参数{isCustomized ? " •" : ""}</button>
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
        {@const editingAnalysis = getSupertagAutoContextInfo(supertag, editingEntry.id, conditionalVal)}
        <div style="flex-shrink: 0; border: 1px solid var(--indexos-accent-primary); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; background: rgba(40, 81, 127, 0.04);">
            <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center;">
                ⚙ {editingEntry.id} 参数
                <button type="button" style="margin-left: auto; font-size: 11px; padding: 0 4px; cursor: pointer; background: none; border: none; opacity: 0.5;" on:click={() => { editingEntry = null; }}>✕</button>
            </div>
            {#if (editingDef?.params || []).length === 0}
                <div style="font-size: 11px; color: var(--indexos-text-muted);">该命令没有可配置参数。</div>
            {:else}
                {#each (editingDef?.params || []) as p}
                    {@const isBlockIdParam = p.key === 'id' || p.type === 'blockid'}
                    {@const autoMatch = editingAnalysis[p.key]}
                    {@const placeholderText = autoMatch && autoMatch.matched 
                        ? `⚡ Auto-Context 感知出参: ${autoMatch.token} (留空自动继承)` 
                        : "空 = 用 Command-DB 配置；可写 {{变量}}"}
                    {@const capsuleToken = autoMatch && autoMatch.matched ? autoMatch.token : "{{block_id}}"}
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0; width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{p.label || p.key}</span>
                        <input
                            type="text"
                            style="flex: 1; min-width: 0; font-size: 11px; padding: 2px 6px; border: 1px solid {editingParams[p.key] ? 'rgba(40, 81, 127, 0.55)' : 'var(--indexos-border-light)'}; border-radius: 3px; background: var(--indexos-bg-container); color: var(--indexos-text-main);"
                            value={editingParams[p.key] || ""}
                            placeholder={placeholderText}
                            on:input={e => setEntryParam(editingEntry.id, p.key, e.currentTarget.value)}
                        />
                        {#if autoMatch && autoMatch.matched && autoMatch.token}
                            <button
                                type="button"
                                class="indexos-btn-bordered"
                                style="font-size: 10px; padding: 1px 6px; flex-shrink: 0; white-space: nowrap; color: var(--indexos-accent-primary);"
                                title={`一键充填前置出参: ${autoMatch.token}`}
                                on:click={() => setEntryParam(editingEntry.id, p.key, autoMatch.token)}
                            >⚡ 填 {autoMatch.token}</button>
                        {/if}
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
