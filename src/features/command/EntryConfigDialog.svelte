<script lang="ts">
    import { onMount } from "svelte";
    import { Dialog, showMessage } from "siyuan";
    import { commandRegistry } from "./registry/command-registry";
    import type { ContextNeed, TargetScope } from "./registry/command-registry";
    import {
        loadEntryConfig, saveEntryConfig, resolveEntryConfigBlockId, suitableForPosition, ENTRY_POSITIONS, BLOCK_TYPES, POSITION_HINTS,
        type EntryConfig, type BlockMenuEntry
    } from "./entry-config";
    import { refreshEntryRegistrations } from "./global-registration/entry-registration";

    export let dialog: Dialog;

    let cfg: EntryConfig | null = null;
    let loading = true;
    let isInstantiated = false;
    let activePos = "顶栏右";
    let searchQuery = "";
    let editingTypes: string | null = null; // 块菜单：正在配类型的命令 id
    let saving = false;
    let showAll = false;

    onMount(async () => {
        isInstantiated = !!(await resolveEntryConfigBlockId());
        cfg = await loadEntryConfig();
        loading = false;
        console.log(`[EntryConfig] 已加载（实例化=${isInstantiated}）`, cfg);
    });

    $: commands = commandRegistry
        .getAllCommands()
        .map((c) => ({
            id: c.id,
            name: c.name,
            contextNeed: (c.meta?.contextNeed || "none") as ContextNeed,
            constraints: c.constraints
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));

    $: visibleCommands = commands.filter(cmd =>
        !searchQuery.trim()
        || cmd.name.toLowerCase().includes(searchQuery.toLowerCase())
        || cmd.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    $: entries = cfg ? (cfg.positions[activePos] || []) : [];
    $: selectedMap = Object.fromEntries(entries.map(e => [typeof e === "string" ? e : e.id, true]));
    // 已绑定的命令始终显示（便于移除旧配置）；showAll 时展示全部并标注不适用
    $: displayCommands = visibleCommands.filter(cmd => showAll || suitableForPosition(cmd.constraints?.targetScope, activePos) || !!selectedMap[cmd.id]);

    function toggle(id: string) {
        const cmd = commands.find(c => c.id === id);
        // 只拦截"新增绑定"不适用命令；已绑定的允许取消
        if (cmd && !suitableForPosition(cmd.constraints?.targetScope, activePos) && !selectedMap[id]) {
            showMessage(`该命令不适用于「${activePos}」`, 2500, "info");
            return;
        }
        const list = [...(cfg.positions[activePos] || [])];
        if (selectedMap[id]) {
            cfg.positions[activePos] = list.filter(e => (typeof e === "string" ? e : e.id) !== id);
        } else {
            cfg.positions[activePos] = activePos === "块菜单" ? [...list, { id }] : [...list, id];
        }
        cfg = { ...cfg, positions: { ...cfg.positions } };
    }

    function targetScopeText(scope: TargetScope | undefined): string {
        if (scope === "block") return "块专用";
        if (scope === "doc") return "页面专用";
        if (scope === "none") return "全局独立";
        return "通用多态";
    }

    function typesOf(id: string): string[] {
        const e = entries.find(x => (typeof x === "string" ? x : x.id) === id);
        return e && typeof e !== "string" ? (e.types || []) : [];
    }

    function setTypes(id: string, type: string) {
        const current = typesOf(id);
        const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type];
        cfg.positions[activePos] = entries.map(e => {
            const eId = typeof e === "string" ? e : e.id;
            if (eId !== id) return e;
            const entry: BlockMenuEntry = { id, ...(next.length > 0 ? { types: next } : {}) };
            return entry;
        });
        cfg = { ...cfg, positions: { ...cfg.positions } };
    }

    async function handleSave() {
        if (!cfg) return;
        if (!cfg) return;
        saving = true;
        try {
            await saveEntryConfig(cfg);
            await refreshEntryRegistrations();
            console.log("[EntryConfig] 已保存入口配置", cfg);
            showMessage("✓ 入口配置已保存");
            dialog.destroy();
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">🧭 UI 入口（位置 → 命令）</div>

    {#if loading}
        <div style="text-align: center; padding: 40px; opacity: 0.6; font-size: 12px;">加载中...</div>
    {:else if cfg}
        {#if !isInstantiated}
            <div style="font-size: 11px; padding: 6px 10px; border-radius: 5px; background: rgba(59, 130, 246, 0.1); color: var(--indexos-primary, #3b82f6); flex-shrink: 0;">
                ⓘ 当前为本地配置模式：保存后将立刻在本地生效。将数据“存到思源”后，会自动双写备份至 Command-DB 数据库属性中。
            </div>
        {/if}
        <div style="display: flex; gap: 12px; flex: 1; min-height: 0;">
        <!-- 左：位置列表 -->
        <div style="width: 150px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; border-right: 1px solid var(--indexos-border-divider, rgba(161,196,230,0.2)); padding-right: 8px;">
            {#each ENTRY_POSITIONS as pos}
                <button
                    type="button"
                    class="indexos-btn-bordered"
                    style="text-align: left; font-size: 11px; padding: 5px 10px; {activePos === pos ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : ''}"
                    on:click={() => { activePos = pos; editingTypes = null; }}
                >{pos}<span style="opacity: .7; margin-left: 6px;">{(cfg.positions[pos] || []).length}</span></button>
            {/each}
        </div>

        <!-- 右：命令勾选 -->
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                <input
                    type="text"
                    class="b3-text-field fn__block"
                    style="font-size: 12px; padding: 5px 10px; flex: 1; min-width: 0;"
                    placeholder="搜索命令..."
                    bind:value={searchQuery}
                />
                <button
                    type="button"
                    class="indexos-btn-bordered"
                    style="font-size: 11px; padding: 4px 10px; flex-shrink: 0;"
                    on:click={() => { showAll = !showAll; }}
                >{showAll ? "隐藏不适用" : "显示全部"}</button>
            </div>
            <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 4px;">
                {#each displayCommands as cmd}
                    {@const sel = !!selectedMap[cmd.id]}
                    {@const suitable = suitableForPosition(cmd.constraints?.targetScope, activePos)}
                    <div
                        role="button"
                        tabindex="0"
                        style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; border-left: 3px solid {sel ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {sel ? 'rgba(40, 81, 127, 0.06)' : 'transparent'}; opacity: {suitable ? 1 : 0.45};"
                        on:click={() => toggle(cmd.id)}
                        on:keydown={e => (e.key === 'Enter' || e.key === ' ') && toggle(cmd.id)}
                    >
                        <span
                            style="width: 16px; height: 16px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; background: {sel ? 'var(--indexos-accent-primary)' : 'var(--indexos-border-light)'}; color: #fff;"
                        >{sel ? "✓" : ""}</span>
                        <span style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{cmd.name}</span>
                        {#if !suitable}
                            <span style="font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(240, 173, 78, 0.14); color: var(--indexos-text-warn, #e6a23c); flex-shrink: 0;" title="不适用于当前位置">⚠ {targetScopeText(cmd.constraints?.targetScope)}</span>
                        {/if}
                        {#if activePos === "块菜单" && sel}
                            <button
                                type="button"
                                class="indexos-btn-bordered"
                                style="font-size: 10px; padding: 1px 7px; flex-shrink: 0;"
                                title="限定块类型（空 = 所有类型）"
                                on:click={e => { e.stopPropagation(); e.preventDefault(); editingTypes = editingTypes === cmd.id ? null : cmd.id; }}
                            >⚙ 类型{typesOf(cmd.id).length > 0 ? `（${typesOf(cmd.id).length}）` : ""}</button>
                        {/if}
                    </div>
                    {#if activePos === "块菜单" && editingTypes === cmd.id}
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px 6px 24px; border-left: 3px solid var(--indexos-accent-primary); background: rgba(40,81,127,0.04); border-radius: 0 5px 5px 0;">
                            {#each BLOCK_TYPES as t}
                                <button
                                    type="button"
                                    class="indexos-btn-bordered"
                                    style="font-size: 10px; padding: 1px 7px; {typesOf(cmd.id).includes(t) ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : ''}"
                                    on:click={() => setTypes(cmd.id, t)}
                                >{t}</button>
                            {/each}
                        </div>
                    {/if}
                {/each}
                {#if displayCommands.length === 0}
                    <div style="text-align: center; padding: 24px; opacity: 0.5; font-size: 12px;">无匹配命令</div>
                {/if}
            </div>
            {#if POSITION_HINTS[activePos]}
                <div style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0;">💡 {POSITION_HINTS[activePos]}</div>
            {/if}
            {#if activePos === "块菜单"}
                <div style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0;">块菜单命令默认出现在所有块类型上；点"⚙ 类型"可限定只出现在某些块。</div>
            {/if}
        </div>
        </div>

        <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0;">
            <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
            <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>保存并刷新</button>
        </div>
    {/if}
</div>
