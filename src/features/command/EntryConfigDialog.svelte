<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { commandRegistry } from "./registry/command-registry";
    import {
        loadEntryConfig, saveEntryConfig, ENTRY_POSITIONS, BLOCK_TYPES,
        type EntryConfig, type BlockMenuEntry
    } from "./entry-config";
    import { refreshTopBarCommands } from "./global-registration/top-bar";

    export let dialog: Dialog;

    let cfg: EntryConfig = loadEntryConfig();
    let activePos = "顶栏右";
    let searchQuery = "";
    let editingTypes: string | null = null; // 块菜单：正在配类型的命令 id
    let saving = false;

    $: commands = commandRegistry
        .getAllCommands()
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));

    $: visibleCommands = commands.filter(cmd =>
        !searchQuery.trim()
        || cmd.name.toLowerCase().includes(searchQuery.toLowerCase())
        || cmd.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    $: entries = cfg.positions[activePos] || [];
    $: selectedMap = Object.fromEntries(entries.map(e => [typeof e === "string" ? e : e.id, true]));

    function toggle(id: string) {
        const list = [...(cfg.positions[activePos] || [])];
        if (selectedMap[id]) {
            cfg.positions[activePos] = list.filter(e => (typeof e === "string" ? e : e.id) !== id);
        } else {
            cfg.positions[activePos] = activePos === "块菜单" ? [...list, { id }] : [...list, id];
        }
        cfg = { ...cfg, positions: { ...cfg.positions } };
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
        saving = true;
        try {
            await saveEntryConfig(cfg);
            await refreshTopBarCommands();
            console.log("[EntryConfig] 已保存入口配置", cfg);
            showMessage("✓ 入口配置已保存");
            dialog.destroy();
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">🧭 入口配置（位置 → 命令）</div>

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
            <input
                type="text"
                class="b3-text-field fn__block"
                style="font-size: 12px; padding: 5px 10px; flex-shrink: 0;"
                placeholder="搜索命令..."
                bind:value={searchQuery}
            />
            <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 4px;">
                {#each visibleCommands as cmd}
                    {@const sel = !!selectedMap[cmd.id]}
                    <div
                        style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; border-left: 3px solid {sel ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {sel ? 'rgba(40, 81, 127, 0.06)' : 'transparent'};"
                        on:click={() => toggle(cmd.id)}
                    >
                        <span
                            style="width: 16px; height: 16px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; background: {sel ? 'var(--indexos-accent-primary)' : 'var(--indexos-border-light)'}; color: #fff;"
                        >{sel ? "✓" : ""}</span>
                        <span style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{cmd.name}</span>
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
                {#if visibleCommands.length === 0}
                    <div style="text-align: center; padding: 24px; opacity: 0.5; font-size: 12px;">无匹配命令</div>
                {/if}
            </div>
            {#if activePos === "块菜单"}
                <div style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0;">块菜单命令默认出现在所有块类型上；点"⚙ 类型"可限定只出现在某些块。</div>
            {/if}
        </div>
    </div>

    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>保存并刷新</button>
    </div>
</div>
