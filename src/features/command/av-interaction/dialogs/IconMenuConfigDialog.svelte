<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { commandRegistry } from "../../registry/command-registry";
    import { parseIconMenuConfig, serializeIconMenuConfig, type IconMenuConfig, type IconMenuEntry } from "../../utils/icon-menu-config";
    import { getSupertagAutoContextInfo } from "../../supertag/core/supertag-auto-context";
    import CommandSequenceEditor from "../../pipeline/CommandSequenceEditor.svelte";
    import { generateRuleScript, parseDispatchCallsFromText } from "../../pipeline/script-dsl";

    export let dialog: Dialog;
    export let supertag: string = "";
    export let availableCommands: { id: string; name: string; description: string; params?: any[] }[] = [];
    export let currentIconMenuVal: string = "";
    export let conditionalVal: string = "";
    export let onSave: (updatedVal: string) => Promise<void>;

    let config: IconMenuConfig = parseIconMenuConfig(currentIconMenuVal);
    let activeTab: "menu" | "button" = "button";
    let searchQuery = "";
    let editingMenuEntry: string | null = null;
    let saving = false;

    // 获取全量命令列表
    $: allCommands = availableCommands.length > 0
        ? availableCommands
        : commandRegistry.getAllCommands().map(c => ({
            id: c.id,
            name: c.name,
            description: c.description || "",
            params: c.params || []
        }));

    $: menuSelectedMap = Object.fromEntries(config.menu.map(e => [e.id, true]));

    $: filteredMenuCommands = allCommands.filter(cmd => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return cmd.name.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q);
    });

    // 构筑供 CommandSequenceEditor 装载的 Button 序列脚本
    function buildButtonScript(buttonEntries: IconMenuEntry[]): string {
        const ruleCmds = (buttonEntries || []).map(b => ({
            commandRef: b.id,
            params: b.params || {}
        }));
        return generateRuleScript("", ruleCmds);
    }

    let buttonInitialScript = buildButtonScript(config.button);

    function handleButtonScriptChange(scriptText: string) {
        const cmds = parseDispatchCallsFromText(scriptText);
        config = {
            ...config,
            button: cmds.map(c => ({
                id: c.commandRef,
                params: c.params && Object.keys(c.params).length > 0 ? c.params : undefined
            }))
        };
    }

    function toggleMenuCommand(id: string) {
        const sel = !!menuSelectedMap[id];
        if (sel) {
            config = { ...config, menu: config.menu.filter(e => e.id !== id) };
            if (editingMenuEntry === id) editingMenuEntry = null;
        } else {
            config = { ...config, menu: [...config.menu, { id }] };
        }
    }

    function openMenuParams(id: string) {
        editingMenuEntry = id;
    }

    function setMenuEntryParam(id: string, key: string, value: string) {
        const current = config.menu.find(e => e.id === id);
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
            menu: config.menu.map(e => e.id === id ? updated : e)
        };
    }

    async function handleSave() {
        saving = true;
        try {
            const value = serializeIconMenuConfig(config);
            await onSave(value);
            showMessage(`✓ 已成功保存 #${supertag} 的菜单与按钮配置 ⚡`);
            dialog.destroy();
        } catch (err: any) {
            showMessage(`保存失败: ${err?.message || err}`, 3000, "error");
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <!-- 头部标题 -->
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;">
        <span>🏷️ 配置 Supertag <span style="color: var(--indexos-accent-primary);">#{supertag}</span> 菜单与按钮</span>
    </div>

    <!-- 规范级 Segmented TabBar -->
    <div class="indexos-tabbar">
        <button
            type="button"
            class="indexos-tab-item"
            style="flex: 1;"
            class:active={activeTab === 'button'}
            on:click={() => { activeTab = "button"; }}
        >
            <span>🔘 Button 块下方按钮 (步骤编排)</span>
            <span class="indexos-tab-badge">{config.button.length}</span>
        </button>

        <button
            type="button"
            class="indexos-tab-item"
            style="flex: 1;"
            class:active={activeTab === 'menu'}
            on:click={() => { activeTab = "menu"; editingMenuEntry = null; }}
        >
            <span>📌 Icon Menu 菜单栏 (快捷菜单项)</span>
            <span class="indexos-tab-badge">{config.menu.length}</span>
        </button>
    </div>

    <!-- 主体视图区 -->
    <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
        <!-- Tab 1: Button 按钮命令序列编排 (100% 同源统一步骤编排器) -->
        <div style="height: 100%; display: {activeTab === 'button' ? 'flex' : 'none'}; flex-direction: column;">
            <CommandSequenceEditor
                initialScript={buttonInitialScript}
                showName={false}
                allowedCommands={null}
                onScriptChange={handleButtonScriptChange}
            />
        </div>

        <!-- Tab 2: Icon Menu 快捷菜单勾选与参数 -->
        {#if activeTab === "menu"}
            <div style="height: 100%; display: flex; flex-direction: column; gap: 8px;">
                <input
                    type="text"
                    class="b3-text-field fn__block"
                    style="font-size: 12px; padding: 5px 10px; flex-shrink: 0;"
                    placeholder="搜索菜单命令..."
                    bind:value={searchQuery}
                />

                <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 4px;">
                    {#each filteredMenuCommands as cmd}
                        {@const sel = !!menuSelectedMap[cmd.id]}
                        <div
                            role="button"
                            tabindex="0"
                            style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; border-left: 3px solid {sel ? 'var(--indexos-accent-primary)' : 'transparent'}; background: {sel ? 'rgba(40, 81, 127, 0.06)' : 'transparent'};"
                            on:click={() => toggleMenuCommand(cmd.id)}
                            on:keydown={e => { if (e.key === "Enter" || e.key === " ") { toggleMenuCommand(cmd.id); } }}
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
                                {@const itemData = config.menu.find(e => e.id === cmd.id)}
                                {@const hasLayer3Params = !!(itemData && itemData.params && Object.values(itemData.params).some(v => v !== undefined && String(v).trim() !== ''))}
                                {@const autoAnalysis = getSupertagAutoContextInfo(supertag, cmd.id, conditionalVal)}
                                {@const hasAutoContextMatch = Object.values(autoAnalysis).some(m => m.matched)}
                                {@const isCustomized = hasLayer3Params || hasAutoContextMatch}
                                <button
                                    type="button"
                                    class="indexos-btn-bordered"
                                    style="font-size: 10px; padding: 1px 7px; flex-shrink: 0; {isCustomized ? (editingMenuEntry === cmd.id ? 'background: var(--indexos-detached-gold, #D9A74A) !important; color: #fff !important; border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; font-weight: 700;' : 'border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; color: var(--indexos-detached-gold, #D9A74A) !important; background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.09)) !important; font-weight: 600;') : (editingMenuEntry === cmd.id ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : '')}"
                                    title={isCustomized ? (hasLayer3Params ? '👑 已配置客制化入参 (Golden Customization)' : '⚡ 已激活 Auto-Context 出参匹配感应') : '配置该命令的参数'}
                                    on:click={e => { e.stopPropagation(); e.preventDefault(); openMenuParams(cmd.id); }}
                                >⚙ 参数</button>
                            {/if}
                        </div>
                    {/each}
                    {#if filteredMenuCommands.length === 0}
                        <div style="text-align: center; padding: 24px; opacity: 0.5; font-size: 12px;">无匹配命令</div>
                    {/if}
                </div>

                <!-- 参数配置面板（内联，随 editingMenuEntry 出现） -->
                {#if editingMenuEntry}
                    {@const editingData = config.menu.find(e => e.id === editingMenuEntry)}
                    {@const editingDef = commandRegistry.getCommand(editingMenuEntry)}
                    {@const editingParams = editingData?.params || {}}
                    {@const editingAnalysis = getSupertagAutoContextInfo(supertag, editingMenuEntry, conditionalVal)}
                    <div style="flex-shrink: 0; border: 1px solid var(--indexos-accent-primary); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; background: rgba(40, 81, 127, 0.04);">
                        <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center;">
                            ⚙ {editingMenuEntry} 参数
                            <button type="button" style="margin-left: auto; font-size: 11px; padding: 0 4px; cursor: pointer; background: none; border: none; opacity: 0.5;" on:click={() => { editingMenuEntry = null; }}>✕</button>
                        </div>
                        {#if (editingDef?.params || []).length === 0}
                            <div style="font-size: 11px; color: var(--indexos-text-muted);">该命令没有可配置参数。</div>
                        {:else}
                            {#each (editingDef?.params || []) as p}
                                {@const autoMatch = editingAnalysis[p.key]}
                                {@const placeholderText = autoMatch && autoMatch.matched 
                                    ? `⚡ Auto-Context 感知出参: ${autoMatch.token} (留空自动继承)` 
                                    : "空 = 自动继承缺省/推荐；可写 {{变量}}"}
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0; width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{p.label || p.key}</span>
                                    <input
                                        type="text"
                                        style="flex: 1; min-width: 0; font-size: 11px; padding: 2px 6px; border: 1px solid {editingParams[p.key] ? 'rgba(40, 81, 127, 0.55)' : 'var(--indexos-border-light)'}; border-radius: 3px; background: var(--indexos-bg-container); color: var(--indexos-text-main);"
                                        value={editingParams[p.key] || ""}
                                        placeholder={placeholderText}
                                        on:input={e => setMenuEntryParam(editingMenuEntry, p.key, e.currentTarget.value)}
                                    />
                                    {#if autoMatch && autoMatch.matched && autoMatch.token}
                                        <button
                                            type="button"
                                            class="indexos-btn-bordered"
                                            style="font-size: 10px; padding: 1px 6px; flex-shrink: 0; white-space: nowrap; color: var(--indexos-accent-primary);"
                                            title={`一键充填前置出参: ${autoMatch.token}`}
                                            on:click={() => setMenuEntryParam(editingMenuEntry, p.key, autoMatch.token)}
                                        >⚡ 填 {autoMatch.token}</button>
                                    {/if}
                                </div>
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    <!-- 底部操作按钮 -->
    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 8px; border-top: 1px solid var(--indexos-border-divider);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存配置"}
        </button>
    </div>
</div>
