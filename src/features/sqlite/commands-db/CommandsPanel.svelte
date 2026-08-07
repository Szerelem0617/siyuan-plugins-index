<script lang="ts">
    import { onMount } from "svelte";
    import { refreshSupertagRegistry } from "../../command/utils/sync-service";
    import { showMessage } from "siyuan";
    import { constructCommandStorage } from "../../command/instantiate-storage";
    import { commandRegistry } from "../../command/registry/command-registry";
    import { encodeBtnHref } from "../../command/global-registration/inline-button";
    import { openGlobalAutomationDialog } from "../../command/av-interaction/command-db-handler";
    import { i18n } from "../../../shared/utils";
    import { openEntryConfigDialog } from "../../command/entry-config-ui";

    let loading = true;

    interface CmdCard {
        name: string;
        id: string;
        paramMapping: string;
    }

    let cards: CmdCard[] = [];

    async function loadData() {
        loading = true;
        try {
            const allCmds = commandRegistry.getAllCommands();
            cards = allCmds.map(c => ({
                name: c.name,
                id: c.id,
                paramMapping: JSON.stringify(c.params || [])
            }));
            console.log(`[CommandsPanel] Loaded ${cards.length} commands from registry.`);
        } catch (e) {
            console.error("[CommandsPanel] Failed to load commands:", e);
            cards = [];
        } finally {
            loading = false;
        }
    }

    async function handleInitSystem() {
        try {
            showMessage("正在从默认模板将数据存储到思源...", 3000, "info");
            await constructCommandStorage();
            await refreshSupertagRegistry();
            showMessage("✓ 数据已存储到思源，可自行修改配置！", 3000, "info");
            await loadData();
        } catch (e: any) {
            console.error("System init failed", e);
            showMessage(`存储失败: ${e.message}`, 5000, "error");
        }
    }

    function copyButtonLink(card: CmdCard) {
        if (!card.id) return;
        try {
            const href = encodeBtnHref({ command: card.id });
            navigator.clipboard.writeText(href).then(() => {
                showMessage(`📋 已复制命令按钮链接: ${card.name || card.id}`);
            }).catch(err => {
                console.error("Failed to copy link:", err);
                showMessage("复制链接失败", 5000, "error");
            });
        } catch (e: any) {
            console.error("Failed to copy button link:", e);
            showMessage(`复制出错: ${e.message}`, 5000, "error");
        }
    }

    onMount(() => {
        loadData();
    });
</script>

<div class="commands-db-panel" style="display: flex; flex-direction: column; gap: 10px; height: 100%;">
    {#if loading}
        <div style="text-align: center; padding: 40px; opacity: 0.4;">加载指令数据中...</div>
    {:else}
        <!-- 顶部操作栏 -->
        <div style="flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <button class="indexos-btn-bordered" style="font-size: 11px; padding: 4px 10px;" on:click={handleInitSystem}>
                    <svg style="width: 12px; height: 12px; fill: currentColor; margin-right: 2px;"><use xlink:href="#iconDatabase"></use></svg>
                    <span>{i18n.initSystemDB}</span>
                </button>
                <button class="indexos-btn-bordered" style="font-size: 11px; padding: 4px 10px;" on:click={openEntryConfigDialog}>
                    <span>🧭 UI 入口</span>
                </button>
                <button class="indexos-btn-bordered" style="font-size: 11px; padding: 4px 10px; color: var(--indexos-accent-primary);" on:click={openGlobalAutomationDialog}>
                    <span>⚡ 后台执行</span>
                </button>
            </div>
            <div style="font-size: 11px; opacity: 0.6; line-height: 1.4; color: var(--b3-theme-on-surface-light);">
                {i18n.initSystemDBHint}
            </div>
        </div>

        <!-- 卡片提示 + 卡片网格 -->
        <div style="font-size: 11px; opacity: 0.8; color: var(--b3-theme-primary); font-weight: 500; flex-shrink: 0;">
            💡 点击任意指令卡片，即可快速复制对应的"按钮链接"到剪贴板。
        </div>

        <div style="flex: 1; overflow-y: auto; border: 1px solid var(--b3-border-color); border-radius: 8px; padding: 12px;">
            {#if cards.length === 0}
                <div style="text-align: center; padding: 20px; opacity: 0.4; font-size: 11px;">未找到指令</div>
            {:else}
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; align-content: start;">
                    {#each cards as card}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div
                            class="cmd-item-card"
                            on:click={() => copyButtonLink(card)}
                        >
                            <div style="display: flex; flex-direction: column; width: 100%; gap: 6px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px;">
                                    <span class="cmd-name-label" style="font-weight: 500; font-size: 12px; color: var(--b3-theme-on-background); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        {card.name}
                                    </span>
                                    <span class="copy-hint-icon" style="font-size: 12px; opacity: 0.3; transition: opacity 0.2s ease;">🔗</span>
                                </div>
                                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10px; opacity: 0.6; font-family: monospace;">
                                    <span>{card.id}</span>
                                    <span style="color: var(--indexos-accent-primary);">Kernel 3.7+</span>
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .cmd-item-card {
        display: flex;
        align-items: center;
        padding: 10px 14px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
    }
    .cmd-item-card:hover {
        background: var(--b3-theme-surface-lighter, var(--b3-theme-surface));
        border-color: var(--b3-theme-primary);
        transform: translateY(-1px);
        box-shadow: var(--b3-point-shadow);
    }
    .cmd-item-card:hover .copy-hint-icon {
        opacity: 0.9 !important;
        color: var(--b3-theme-primary);
    }
</style>
