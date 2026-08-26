<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { 
        commandRegistry, 
        inferCommandSource, 
        inferCommandDomain, 
        inferCommandScope,
        type CommandSourceType,
        type CommandDomainType,
        type CommandScopeType
    } from "../registry/command-registry";
    import { COMMAND_BINDINGS } from "../registration";
    import { getSeedCommandRows } from "../indexos/seed-data";
    import { encodeBtnHref } from "./inline-button";

    export let dialog: Dialog;
    export let targetRange: Range | null = null;
    export let initialCommandId: string = "";

    let selectedCommandId: string = initialCommandId || "";
    let searchQuery = "";
    let showFilterPopover = false;

    // 多维筛选状态
    let filterSource: "all" | CommandSourceType = "all";
    let filterDomain: "all" | CommandDomainType = "all";
    let filterScope: "all" | CommandScopeType = "all";

    $: activeFilterCount = (filterSource !== "all" ? 1 : 0) + (filterDomain !== "all" ? 1 : 0) + (filterScope !== "all" ? 1 : 0);

    $: allCommands = (() => {
        const bindings = Object.values(COMMAND_BINDINGS);
        if (bindings.length > 0) {
            return bindings.map(b => {
                const def = commandRegistry.getCommand(b.commandRef) || commandRegistry.findByNameOrId(b.methodName);
                return {
                    id: b.commandRef,
                    name: b.methodName || def?.name || b.commandRef,
                    description: def?.description || "",
                    source: def ? inferCommandSource(def) : ("composite" as CommandSourceType),
                    domain: def ? inferCommandDomain(def) : ("other" as CommandDomainType),
                    scope: def ? inferCommandScope(def) : ("focused_block" as CommandScopeType)
                };
            });
        }

        return getSeedCommandRows().map(row => {
            const def = commandRegistry.getCommand(row.commandID) || commandRegistry.findByNameOrId(row.label);
            return {
                id: row.commandID,
                name: row.label || def?.name || row.commandID,
                description: def?.description || "",
                source: def ? inferCommandSource(def) : ("builtin" as CommandSourceType),
                domain: def ? inferCommandDomain(def) : ("other" as CommandDomainType),
                scope: def ? inferCommandScope(def) : ("focused_block" as CommandScopeType)
            };
        });
    })().sort((a, b) => a.name.localeCompare(b.name, "zh"));

    $: filteredCommands = allCommands.filter(cmd => {
        if (filterSource !== "all" && cmd.source !== filterSource) return false;
        if (filterDomain !== "all" && cmd.domain !== filterDomain) return false;
        if (filterScope !== "all" && cmd.scope !== filterScope) return false;

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchName = (cmd.name || "").toLowerCase().includes(q);
            const matchId = (cmd.id || "").toLowerCase().includes(q);
            const matchDesc = (cmd.description || "").toLowerCase().includes(q);
            const matchDomain = String(cmd.domain || "").toLowerCase().includes(q);
            if (!matchName && !matchId && !matchDesc && !matchDomain) return false;
        }
        return true;
    });

    $: selectedCmd = allCommands.find(c => c.id === selectedCommandId) || null;

    function handleSelect(cmdId: string) {
        selectedCommandId = cmdId;
    }

    function handleDoubleClick(cmdId: string) {
        selectedCommandId = cmdId;
        handleConfirm();
    }

    function getDomainBadge(domain: string, source: string) {
        if (source === "composite") return { label: "复合", emoji: "⚡" };
        switch (domain) {
            case "block": return { label: "块操作", emoji: "🧱" };
            case "attribute": return { label: "属性", emoji: "🏷️" };
            case "interaction": return { label: "视效", emoji: "✨" };
            case "document": return { label: "文档", emoji: "📄" };
            case "data_flow": return { label: "数据流", emoji: "🔄" };
            case "composite": return { label: "复合", emoji: "⚡" };
            default: return { label: "通用", emoji: "🧩" };
        }
    }

    function handleConfirm() {
        if (!selectedCommandId) {
            showMessage("请选择一个要绑定的命令", 3000, "info");
            return;
        }

        const cmd = selectedCmd || commandRegistry.findByNameOrId(selectedCommandId);
        const finalLabel = cmd?.name || selectedCommandId;
        const href = encodeBtnHref({ command: selectedCommandId });

        insertButtonHtml(href, finalLabel);
        showMessage(`✓ 已插入命令按钮：${finalLabel}`);
        dialog.destroy();
    }

    function insertButtonHtml(href: string, label: string) {
        const inlineDOM = `<span data-type="a" data-href="${href}">${label}</span>&#8203;`;
        if (targetRange) {
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(targetRange);
                document.execCommand("insertHTML", false, inlineDOM);
            }
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 18px 20px; box-sizing: border-box; gap: 14px; background: var(--indexos-bg-base);">
    <!-- 头部标题栏 -->
    <div style="flex-shrink: 0; display: flex; flex-direction: column; gap: 2px;">
        <div style="font-size: 15px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; gap: 6px;">
            <span>🔘 选择要绑定的命令</span>
        </div>
        <span style="font-size: 12px; color: var(--indexos-text-muted);">
            点击单选要触发的命令，支持双击直接插入
        </span>
    </div>

    <!-- 顶部搜索与筛选栏 -->
    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; position: relative;">
        <!-- 漏斗筛选按钮 -->
        <button
            type="button"
            class="b3-button {activeFilterCount > 0 ? 'b3-button--text' : 'b3-button--outline'}"
            style="height: 32px; padding: 0 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; flex-shrink: 0; cursor: pointer; {activeFilterCount > 0 ? 'background: var(--indexos-accent-primary); color: #fff;' : ''}"
            title="筛选命令来源、领域与范围"
            on:click={() => showFilterPopover = !showFilterPopover}
        >
            <svg style="width: 13px; height: 13px;"><use xlink:href="#iconFilter"></use></svg>
            <span>筛选</span>
            {#if activeFilterCount > 0}
                <span style="font-weight: bold; font-size: 11px; margin-left: 1px;">({activeFilterCount})</span>
            {/if}
        </button>

        <!-- 搜索框 (搜索图标在右侧) -->
        <div style="position: relative; flex: 1;">
            <input
                type="text"
                class="b3-text-field fn__block"
                style="font-size: 12px; height: 32px; padding: 4px 30px 4px 10px; box-sizing: border-box; width: 100%; border-radius: 6px;"
                placeholder="搜索命令名称、ID 或功能领域 (如 烟花 / 属性 / 新建)..."
                bind:value={searchQuery}
            />
            <svg style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; opacity: 0.45; pointer-events: none;"><use xlink:href="#iconSearch"></use></svg>
        </div>

        <!-- 筛选浮动面板 -->
        {#if showFilterPopover}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div 
                style="position: fixed; inset: 0; z-index: 100;" 
                on:click={() => showFilterPopover = false}
            ></div>
            
            <div 
                class="b3-menu"
                style="position: absolute; top: calc(100% + 4px); left: 0; z-index: 101; width: 250px; padding: 12px; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); border-radius: 8px; box-shadow: var(--b3-dialog-shadow); display: flex; flex-direction: column; gap: 10px;"
            >
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--indexos-text-muted); border-bottom: 1px solid var(--indexos-border-divider); padding-bottom: 6px;">
                    <span>🎯 维度筛选</span>
                    {#if activeFilterCount > 0}
                        <button 
                            class="b3-button b3-button--cancel" 
                            style="font-size: 11px; padding: 1px 6px; height: 20px; line-height: 18px;" 
                            on:click={() => { filterSource = 'all'; filterDomain = 'all'; filterScope = 'all'; }}
                        >
                            重置
                        </button>
                    {/if}
                </div>

                <!-- 来源 -->
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span style="font-size: 11px; color: var(--indexos-text-muted);">来源 (Source):</span>
                    <select class="b3-select" style="font-size: 11px; height: 28px; padding: 2px 6px;" bind:value={filterSource}>
                        <option value="all">全部来源</option>
                        <option value="builtin">🧩 内置 (Builtin)</option>
                        <option value="composite">⚡ 复合 (Composite)</option>
                        <option value="user">👤 自建 (User)</option>
                        <option value="plugin">🔌 插件 (Plugin)</option>
                    </select>
                </div>

                <!-- 领域 -->
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span style="font-size: 11px; color: var(--indexos-text-muted);">功能领域 (Domain):</span>
                    <select class="b3-select" style="font-size: 11px; height: 28px; padding: 2px 6px;" bind:value={filterDomain}>
                        <option value="all">全部领域</option>
                        <option value="block">🧱 块操作 (Block)</option>
                        <option value="attribute">🏷️ 属性标签 (Attribute)</option>
                        <option value="interaction">✨ 视效交互 (Interaction)</option>
                        <option value="document">📄 文档大纲 (Document)</option>
                        <option value="data_flow">🔄 数据流 (Data Flow)</option>
                        <option value="composite">⚡ 复合编排 (Composite)</option>
                    </select>
                </div>

                <!-- 范围 -->
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span style="font-size: 11px; color: var(--indexos-text-muted);">作用范围 (Scope):</span>
                    <select class="b3-select" style="font-size: 11px; height: 28px; padding: 2px 6px;" bind:value={filterScope}>
                        <option value="all">全部范围</option>
                        <option value="focused_block">🎯 聚焦块 (Focused Block)</option>
                        <option value="document">📄 文档级 (Document)</option>
                        <option value="global">🌐 全局 (Global)</option>
                    </select>
                </div>
            </div>
        {/if}
    </div>

    <!-- 命令卡片列表主体 -->
    <div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;">
        {#if filteredCommands.length === 0}
            <div style="text-align: center; color: var(--indexos-text-muted); padding: 50px 0; font-size: 13px;">
                🔍 未找到匹配的命令
            </div>
        {:else}
            {#each filteredCommands as cmd}
                {@const isSelected = selectedCommandId === cmd.id}
                {@const badge = getDomainBadge(cmd.domain, cmd.source)}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                    class="indexos-command-option-card"
                    style="padding: 10px 14px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1); border: {isSelected ? '1.5px solid var(--indexos-accent-primary)' : '1px solid var(--indexos-border-light)'}; background: {isSelected ? 'rgba(40, 81, 127, 0.08)' : 'var(--indexos-bg-card)'}; box-shadow: {isSelected ? '0 1px 4px rgba(40, 81, 127, 0.12)' : 'none'};"
                    on:click={() => handleSelect(cmd.id)}
                    on:dblclick={() => handleDoubleClick(cmd.id)}
                >
                    <!-- 单选圆圈指示器 (明确告知用户这是单选) -->
                    <div style="width: 18px; height: 18px; border-radius: 50%; border: {isSelected ? '1.5px solid var(--indexos-accent-primary)' : '1.5px solid var(--b3-border-color)'}; background: {isSelected ? 'var(--indexos-accent-primary)' : 'transparent'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s ease;">
                        {#if isSelected}
                            <span style="width: 6px; height: 6px; border-radius: 50%; background: #ffffff;"></span>
                        {/if}
                    </div>

                    <!-- 领域标签徽标 -->
                    <span 
                        style="font-size: 11px; padding: 2px 7px; border-radius: 4px; background: rgba(0,0,0,0.04); color: var(--indexos-text-main); font-weight: 500; flex-shrink: 0; border: 1px solid var(--indexos-border-light);"
                    >
                        {badge.emoji} {badge.label}
                    </span>

                    <!-- 命令核心信息 -->
                    <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 13px; font-weight: 600; color: {isSelected ? 'var(--indexos-accent-primary)' : 'var(--indexos-text-main)'};">
                                {cmd.name}
                            </span>
                            <span style="font-size: 10px; opacity: 0.5; font-family: monospace;">
                                {cmd.id}
                            </span>
                        </div>
                        {#if cmd.description}
                            <span style="font-size: 11px; color: var(--indexos-text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; line-height: 1.3;">
                                {cmd.description}
                            </span>
                        {/if}
                    </div>

                    <!-- 右侧已选提示 -->
                    {#if isSelected}
                        <span style="font-size: 11px; color: var(--indexos-accent-primary); font-weight: 600; flex-shrink: 0;">
                            已选择
                        </span>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- 底部操作与预览 -->
    <div class="fn__flex" style="justify-content: space-between; align-items: center; gap: 10px; flex-shrink: 0; padding-top: 10px; border-top: 1px solid var(--indexos-border-divider);">
        <div style="font-size: 12px; color: var(--indexos-text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {#if selectedCmd}
                <span>已选命令：<strong style="color: var(--indexos-accent-primary); font-size: 13px;">{selectedCmd.name}</strong></span>
            {:else}
                <span style="opacity: 0.7;">请在上方单选一个命令</span>
            {/if}
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0;">
            <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
            <button class="b3-button b3-button--text" on:click={handleConfirm} disabled={!selectedCommandId}>
                确认绑定并插入
            </button>
        </div>
    </div>
</div>

<style>
    .indexos-command-option-card:hover {
        border-color: var(--indexos-accent-primary) !important;
        background: var(--indexos-bg-container) !important;
    }
</style>
