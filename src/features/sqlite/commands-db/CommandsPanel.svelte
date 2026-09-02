<script lang="ts">
    import { onMount } from "svelte";
    import { refreshSupertagRegistry } from "../../command/utils/sync-service";
    import { showMessage } from "siyuan";
    import { constructCommandStorage } from "../../command/instantiate-storage";
    import { commandRegistry } from "../../command/registry/command-registry";
    import { encodeBtnHref } from "../../command/global-registration/inline-button";
    import { openConfigForCommand, openRegistryCommandSelectorDialog, openCustomUserCommandDialog } from "../../command/av-interaction/command-db-handler";
    import { openCompositeEditor, openCompositeEditorForRow } from "../../command/composite/manager";
    import { i18n } from "../../../shared/utils";
    import { dispatchCommand } from "../../command/command-dispatcher";
    import { getSeedCommandRows } from "../../command/indexos/seed-data";
    import { COMMAND_BINDINGS } from "../../command/registration";

    let loading = true;
    export let searchQuery = "";
    let selectedCategory: "all" | "atomic" | "composite" = "all";

    interface CmdCard {
        id: string;
        name: string;
        description: string;
        category: "atomic" | "composite";
        params?: any[];
        outputs?: any[];
        inputMapping?: string;
        outputMapping?: string;
        rowId?: string;
        script?: string;
    }

    let commandsList: CmdCard[] = [];

    async function loadData() {
        loading = true;
        try {
            const allCmds = commandRegistry.getAllCommands();
            const seedRows = getSeedCommandRows();
            const seedMap = new Map(seedRows.map(r => [r.commandID, r]));

            const map = new Map<string, CmdCard>();

            // 1. 从命令注册表 (Layer 1 + Layer 3) 读取
            for (const c of allCmds) {
                const isComposite = c.id.startsWith("composite.") || c.category === "custom" || c.category === "user";
                const seed = seedMap.get(c.id);
                const binding = Object.values(COMMAND_BINDINGS).find(b => b.commandRef === c.id || b.methodName === c.name);

                map.set(c.id, {
                    id: c.id,
                    name: binding?.methodName || seed?.label || c.name || c.id,
                    description: c.description || (isComposite ? "多步骤工作流与管道编排" : "原生原子系统操作"),
                    category: isComposite ? "composite" : "atomic",
                    params: c.params || [],
                    outputs: c.outputs || [],
                    inputMapping: binding?.inputMapping || seed?.inputMapping || "",
                    outputMapping: binding?.outputMapping || seed?.outputMapping || ""
                });
            }

            // 2. 补充 Layer 2 种子命令
            for (const row of seedRows) {
                if (!map.has(row.commandID)) {
                    const isComposite = row.commandID.startsWith("composite.");
                    const def = commandRegistry.getCommand(row.commandID);
                    map.set(row.commandID, {
                        id: row.commandID,
                        name: row.label || def?.name || row.commandID,
                        description: def?.description || (isComposite ? "多步骤工作流与管道编排" : "原生原子系统操作"),
                        category: isComposite ? "composite" : "atomic",
                        params: def?.params || [],
                        outputs: def?.outputs || [],
                        inputMapping: row.inputMapping,
                        outputMapping: row.outputMapping,
                        rowId: row.rowID
                    });
                }
            }

            commandsList = Array.from(map.values()).sort((a, b) => {
                if (a.category !== b.category) return a.category === "composite" ? -1 : 1;
                return a.name.localeCompare(b.name, "zh");
            });
        } catch (e) {
            console.error("[CommandsPanel] Failed to load commands:", e);
            commandsList = [];
        } finally {
            loading = false;
        }
    }

    function copyButtonLink(card: CmdCard) {
        if (!card.id) return;
        try {
            const href = encodeBtnHref({ command: card.id });
            navigator.clipboard.writeText(href).then(() => {
                showMessage(`📋 已复制命令按钮链接: ${card.name}`);
            }).catch(err => {
                console.error("Failed to copy link:", err);
                showMessage("复制链接失败", 5000, "error");
            });
        } catch (e: any) {
            console.error("Failed to copy button link:", e);
            showMessage(`复制出错: ${e.message}`, 5000, "error");
        }
    }

    async function handleRunCommand(card: CmdCard) {
        try {
            showMessage(`⚡ 正在执行命令: ${card.name}...`, 2000, "info");
            await dispatchCommand(card.id, {}, { blockEl: document.body, protyleEl: null });
            showMessage(`✓ 命令 "${card.name}" 执行成功`, 3000);
        } catch (e: any) {
            console.error("Execute command test error:", e);
            showMessage(`执行失败: ${e.message || e}`, 4000, "error");
        }
    }

    function handleConfigureCommand(card: CmdCard) {
        if (card.category === "composite") {
            if (card.rowId) {
                openCompositeEditorForRow(card.rowId, card.script || "", "steps", () => loadData());
            } else {
                openCompositeEditor("steps", () => loadData());
            }
        } else {
            const def = commandRegistry.getCommand(card.id) || { name: card.name, params: card.params, outputs: card.outputs };
            openConfigForCommand(def, card.name);
        }
    }

    function handleCreateComposite() {
        openCompositeEditor("steps", () => loadData());
    }

    function handleImportCommand() {
        openRegistryCommandSelectorDialog(() => loadData());
    }

    function handleCreateAtomicCommand() {
        openCustomUserCommandDialog(() => loadData());
    }

    $: filteredList = commandsList.filter(card => {
        if (selectedCategory === "atomic" && card.category !== "atomic") return false;
        if (selectedCategory === "composite" && card.category !== "composite") return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return card.name.toLowerCase().includes(q) ||
               card.id.toLowerCase().includes(q) ||
               card.description.toLowerCase().includes(q);
    });

    $: totalAtomicCount = commandsList.filter(c => c.category === "atomic").length;
    $: totalCompositeCount = commandsList.filter(c => c.category === "composite").length;

    onMount(() => {
        loadData();
    });
</script>

<div class="commands-db-panel" style="display: flex; flex-direction: column; gap: 12px; height: 100%;">
    <!-- 顶部分类 Pills 切换 -->
    <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;">
        <div class="fn__flex" style="align-items: center; gap: 6px;">
            <button
                class="indexos-tab-pill {selectedCategory === 'all' ? 'active' : ''}"
                on:click={() => selectedCategory = 'all'}
            >
                全部 ({commandsList.length})
            </button>
            <button
                class="indexos-tab-pill {selectedCategory === 'atomic' ? 'active' : ''}"
                on:click={() => selectedCategory = 'atomic'}
            >
                ⚡ 原子命令 ({totalAtomicCount})
            </button>
            <button
                class="indexos-tab-pill {selectedCategory === 'composite' ? 'active' : ''}"
                on:click={() => selectedCategory = 'composite'}
            >
                🔀 复合命令 ({totalCompositeCount})
            </button>
        </div>
    </div>

    <!-- 命令列表 / 卡片网格 -->
    <div style="flex: 1; overflow-y: auto; min-height: 0;">
        {#if loading}
            <div class="fn__flex-center" style="height: 120px;">
                <span class="loading fn__flex-center">
                    <svg class="fn__rotate" style="width: 24px; height: 24px;"><use xlink:href="#iconRefresh"></use></svg>
                </span>
            </div>
        {:else}
            <div class="cmd-cards-grid">
                <!-- 第一张卡片：操作卡片 (Action Card) -->
                {#if selectedCategory === 'all' || selectedCategory === 'atomic'}
                    <div class="cmd-item-card cmd-action-card">
                        <div class="cmd-card-header">
                            <div class="fn__flex" style="align-items: center; gap: 6px;">
                                <span class="cmd-icon-badge cmd-icon-badge--atomic">⚡</span>
                                <span class="cmd-name-label">普通命令管理</span>
                            </div>
                            <span class="indexos-tag-badge" style="font-size: 10px;">操作</span>
                        </div>
                        <div class="cmd-card-body">
                            <div class="cmd-desc-text">
                                从系统内置注册表导入指令，或创建新的系统原子命令。
                            </div>
                        </div>
                        <div class="cmd-card-actions">
                            <button
                                class="indexos-btn-bordered"
                                style="font-size: 11px; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;"
                                title="从系统内置注册表导入命令"
                                on:click={handleImportCommand}
                            >
                                <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconInbox"></use></svg>
                                <span>导入命令</span>
                            </button>
                            <button
                                class="indexos-btn-bordered"
                                style="font-size: 11px; padding: 3px 8px; color: var(--indexos-accent-primary); border-color: rgba(59, 130, 246, 0.4); display: inline-flex; align-items: center; gap: 4px;"
                                title="创建新的原子命令"
                                on:click={handleCreateAtomicCommand}
                            >
                                <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconAdd"></use></svg>
                                <span>创建命令</span>
                            </button>
                        </div>
                    </div>
                {:else if selectedCategory === 'composite'}
                    <div class="cmd-item-card cmd-action-card">
                        <div class="cmd-card-header">
                            <div class="fn__flex" style="align-items: center; gap: 6px;">
                                <span class="cmd-icon-badge cmd-icon-badge--composite">🔀</span>
                                <span class="cmd-name-label">复合命令编排</span>
                            </div>
                            <span class="indexos-tag-badge indexos-tag-badge--builtin" style="font-size: 10px;">编排</span>
                        </div>
                        <div class="cmd-card-body">
                            <div class="cmd-desc-text">
                                通过可视化流水线编辑器创建多步骤流式复合命令管道。
                            </div>
                        </div>
                        <div class="cmd-card-actions">
                            <button
                                class="indexos-btn-bordered"
                                style="font-size: 11px; padding: 3px 10px; color: var(--indexos-accent-primary); border-color: rgba(59, 130, 246, 0.4); font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"
                                title="创建多步骤流式复合命令管道"
                                on:click={handleCreateComposite}
                            >
                                <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconAdd"></use></svg>
                                <span>创建复合命令</span>
                            </button>
                        </div>
                    </div>
                {/if}

                {#if filteredList.length === 0}
                    <div class="fn__flex-column fn__flex-center" style="grid-column: 1 / -1; height: 120px; color: var(--b3-theme-on-surface-light);">
                        <p style="font-size: 13px;">未找到匹配的命令</p>
                    </div>
                {/if}

                {#each filteredList as card}
                    <div class="cmd-item-card">
                        <!-- 卡片头部：图标 + 标题 + 分类徽标 -->
                        <div class="cmd-card-header">
                            <div class="fn__flex" style="align-items: center; gap: 6px; overflow: hidden;">
                                <span class="cmd-icon-badge {card.category === 'composite' ? 'cmd-icon-badge--composite' : 'cmd-icon-badge--atomic'}">
                                    {card.category === 'composite' ? '🔀' : '⚡'}
                                </span>
                                <span class="cmd-name-label" title={card.name}>
                                    {card.name}
                                </span>
                            </div>

                            <span class="indexos-tag-badge {card.category === 'composite' ? 'indexos-tag-badge--builtin' : ''}" style="font-size: 10px; flex-shrink: 0;">
                                {card.category === 'composite' ? '复合命令' : '原子命令'}
                            </span>
                        </div>

                        <!-- 卡片中部：ID + 描述 -->
                        <div class="cmd-card-body">
                            <div class="cmd-id-code" title={card.id}>
                                {card.id}
                            </div>
                            <div class="cmd-desc-text" title={card.description}>
                                {card.description}
                            </div>
                            
                            <!-- 参数提示 -->
                            {#if card.params && card.params.length > 0}
                                <div class="fn__flex" style="gap: 4px; flex-wrap: wrap; margin-top: 2px;">
                                    <span class="param-chip" title="支持参数自定义配置">
                                        ⚙️ {card.params.length} 个参数
                                    </span>
                                </div>
                            {/if}
                        </div>

                        <!-- 卡片底部操作栏 -->
                        <div class="cmd-card-actions">
                            <button
                                class="indexos-btn-bordered"
                                style="font-size: 11px; padding: 2px 7px;"
                                title="复制可粘贴于笔记中的 Markdown 命令按钮链接"
                                on:click={() => copyButtonLink(card)}
                            >
                                <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconLink"></use></svg>
                                <span>复制链接</span>
                            </button>

                            {#if (card.params && card.params.length > 0) || card.category === 'composite'}
                                <button
                                    class="indexos-btn-bordered"
                                    style="font-size: 11px; padding: 2px 7px;"
                                    title="配置参数映射与执行规则"
                                    on:click={() => handleConfigureCommand(card)}
                                >
                                    <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconSettings"></use></svg>
                                    <span>配置</span>
                                </button>
                            {/if}

                            <button
                                class="indexos-btn-bordered"
                                style="font-size: 11px; padding: 2px 7px; color: var(--indexos-accent-primary); border-color: rgba(59, 130, 246, 0.4);"
                                title="在当前环境测试执行此命令"
                                on:click={() => handleRunCommand(card)}
                            >
                                <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconPlay"></use></svg>
                                <span>运行</span>
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .indexos-tab-pill {
        padding: 3px 10px;
        font-size: 12px;
        font-weight: 500;
        color: var(--indexos-text-muted, #5A6D82);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--indexos-radius-sm, 6px);
        cursor: pointer;
        transition: all 0.15s ease;
    }
    .indexos-tab-pill:hover {
        background: var(--indexos-bg-hover, rgba(0, 0, 0, 0.04));
        color: var(--indexos-text-main, #0F243B);
    }
    .indexos-tab-pill.active {
        background: var(--indexos-bg-container, rgba(0, 0, 0, 0.06));
        border-color: var(--indexos-border-subtle, rgba(0, 0, 0, 0.08));
        color: var(--indexos-accent-primary, #3B82F6);
        font-weight: 600;
    }
    .cmd-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
        align-content: start;
        padding: 2px;
    }
    .cmd-item-card {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 12px;
        background: var(--indexos-bg-base, var(--b3-theme-surface));
        border: 1px solid var(--indexos-border-subtle, var(--b3-border-color));
        border-radius: var(--indexos-radius-md, 8px);
        transition: all 0.2s ease;
        gap: 10px;
        min-height: 120px;
    }
    .cmd-item-card:hover {
        border-color: var(--indexos-accent-primary, #3B82F6);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        transform: translateY(-1px);
    }
    .cmd-action-card {
        background: var(--b3-theme-surface-lighter, var(--b3-theme-surface));
        border: 1px dashed rgba(59, 130, 246, 0.4);
    }
    .cmd-action-card:hover {
        border-color: var(--indexos-accent-primary, #3B82F6);
        background: var(--indexos-accent-light, rgba(59, 130, 246, 0.06));
    }
    .cmd-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .cmd-icon-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 4px;
        font-size: 11px;
        flex-shrink: 0;
    }
    .cmd-icon-badge--atomic {
        background: rgba(59, 130, 246, 0.1);
        color: var(--indexos-accent-primary, #3B82F6);
    }
    .cmd-icon-badge--composite {
        background: rgba(217, 167, 74, 0.12);
        color: var(--indexos-detached-gold, #D9A74A);
    }
    .cmd-name-label {
        font-weight: 600;
        font-size: 13px;
        color: var(--indexos-text-main, #0F243B);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .cmd-card-body {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
    }
    .cmd-id-code {
        font-family: var(--b3-font-family-code, monospace);
        font-size: 10px;
        color: var(--indexos-text-muted, #5A6D82);
        opacity: 0.8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .cmd-desc-text {
        font-size: 11px;
        color: var(--indexos-text-muted, #5A6D82);
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .param-chip {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 3px;
        background: var(--indexos-bg-container, rgba(0, 0, 0, 0.04));
        color: var(--indexos-text-muted, #5A6D82);
    }
    .cmd-card-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        padding-top: 6px;
        border-top: 1px dashed var(--indexos-border-subtle, var(--b3-border-color));
    }
</style>
