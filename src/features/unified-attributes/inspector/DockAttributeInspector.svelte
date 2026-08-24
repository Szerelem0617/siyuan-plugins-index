<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { showMessage } from "siyuan";
    import {
        loadBlockAttributeData,
        updateBlockAttributeValue,
        updateAVCellAttributeValue,
        type BlockAttributeData
    } from "./attribute-model";
    import { activeBlockTracker, type ActiveBlockContext } from "./active-block-tracker";
    import { supertagAVProjector } from "../projection/supertag-av-projector";
    import BaseAttributesTab from "./BaseAttributesTab.svelte";
    import GovernedAttributesTab from "./GovernedAttributesTab.svelte";

    let currentContext: ActiveBlockContext | null = null;
    let blockId: string = "";
    let loading = true;
    let data: BlockAttributeData | null = null;
    let activeTab: "base" | "governed" = "base";
    let isPinned = false;

    let saveStatus = "✓ 实时同步就绪";
    let saveStatusTimer: any = null;

    let unsubscribeTracker: (() => void) | null = null;

    onMount(() => {
        activeBlockTracker.init();
        unsubscribeTracker = activeBlockTracker.subscribe(async (ctx) => {
            currentContext = ctx;
            if (ctx && ctx.blockId !== blockId) {
                blockId = ctx.blockId;
                await reloadData();
            }
        });
    });

    onDestroy(() => {
        if (unsubscribeTracker) {
            unsubscribeTracker();
        }
    });

    async function reloadData() {
        if (!blockId) {
            data = null;
            loading = false;
            return;
        }
        loading = true;
        try {
            data = await loadBlockAttributeData(blockId);
        } catch (e) {
            console.error("[DockInspector] 加载属性异常:", e);
        } finally {
            loading = false;
        }
    }

    function triggerSaveFeedback() {
        saveStatus = "💾 正在同步...";
        if (saveStatusTimer) clearTimeout(saveStatusTimer);
        saveStatusTimer = setTimeout(() => {
            saveStatus = "✓ 已自动实时同步";
        }, 500);
    }

    async function handleBlockFieldChange(attrKey: string, attrValue: string) {
        if (!blockId) return;
        triggerSaveFeedback();
        await updateBlockAttributeValue(blockId, attrKey, attrValue);
        if (data?.projectionInfo?.isProjected) {
            supertagAVProjector.notifyFrontendToRerender(data.projectionInfo.tableName || "", blockId);
        }
    }

    async function handleAVCellChange(avId: string, keyId: string, itemId: string, newValue: string, colType: string) {
        triggerSaveFeedback();
        await updateAVCellAttributeValue(avId, keyId, itemId, newValue, colType);
    }

    function togglePin() {
        isPinned = !isPinned;
        activeBlockTracker.setPin(isPinned ? blockId : null);
        if (isPinned) {
            showMessage("📌 已锁定检查当前块属性");
        } else {
            showMessage("🔓 已解除锁定，恢复跟随光标");
            activeBlockTracker.detectCurrentActiveBlock();
        }
    }

    function inspectDocRoot() {
        activeBlockTracker.forceInspectDocRoot();
    }

    function copyText(txt: string, tip = "已复制") {
        if (!txt) return;
        navigator.clipboard.writeText(txt).then(() => {
            showMessage(`✓ ${tip}`);
        }).catch(() => {
            showMessage(txt);
        });
    }

    function copyBlockId() {
        copyText(blockId, "块 ID 已复制");
    }

    function getFriendlyTypeName(t: string): string {
        switch (t) {
            case "NodeDocument": return "📄 文档";
            case "NodeListItem": return "📝 列表项";
            case "NodeList": return "📋 列表";
            case "NodeHeading": return "🔖 标题";
            case "NodeParagraph": return "¶ 段落";
            case "NodeBlockquote": return "💬 引述";
            case "NodeCodeBlock": return "💻 代码块";
            case "NodeSuperBlock": return "📦 超级块";
            case "NodeAttributeView": return "⚡ 数据库";
            default: return t ? t.replace("Node", "") : "块";
        }
    }
</script>

<div class="indexos-dock-inspector">
    <!-- 智能当前块上下文感知栏 -->
    <div class="dock-header">
        <div class="context-banner">
            <div class="banner-left">
                <span class="block-type-chip">{getFriendlyTypeName(currentContext?.blockType || data?.blockType || 'NodeBlock')}</span>
                {#if currentContext?.textSnippet}
                    <span class="block-snippet" title={currentContext.textSnippet}>
                        {currentContext.textSnippet}
                    </span>
                {/if}
            </div>
            <div class="banner-actions">
                <button
                    class="action-icon-btn {isPinned ? 'pinned' : ''}"
                    title={isPinned ? "解锁跟随光标" : "锁定当前块"}
                    on:click={togglePin}
                >
                    📌
                </button>
                <button
                    class="action-icon-btn"
                    title="检查整篇文档根属性"
                    on:click={inspectDocRoot}
                >
                    📄
                </button>
                <button
                    class="action-icon-btn"
                    title="刷新属性"
                    on:click={reloadData}
                >
                    🔄
                </button>
            </div>
        </div>

        {#if blockId}
            <div class="meta-subline">
                <span class="meta-block-id" role="button" tabindex="0" title="点击复制 Block ID" on:click={() => copyBlockId()} on:keydown={e => e.key === 'Enter' && copyBlockId()}>
                    ID: {blockId.slice(0, 14)}...
                </span>
                {#if data?.projectionInfo?.isProjected}
                    <span class="meta-proj-badge">⚡ 虚拟投影已就绪</span>
                {/if}
            </div>
        {/if}
    </div>

    <!-- 双 Tab 导航栏 (基础属性在左，结构化属性在右) -->
    <div class="dock-tabs">
        <button
            class="tab-btn {activeTab === 'base' ? 'active' : ''}"
            on:click={() => { activeTab = 'base'; }}
        >
            ⚙️ 基础属性
        </button>
        <button
            class="tab-btn {activeTab === 'governed' ? 'active' : ''}"
            on:click={() => { activeTab = 'governed'; }}
        >
            🧩 结构化属性
        </button>
    </div>

    <!-- 内容滚动区 -->
    <div class="dock-body">
        {#if loading}
            <div class="loading-wrap">
                <div class="spinner"></div>
                <span>正在感知并读取属性...</span>
            </div>
        {:else if !blockId}
            <div class="empty-state">
                <span style="font-size: 20px; opacity: 0.3;">🎯</span>
                <span>请在编辑器中点击或选择一个块</span>
            </div>
        {:else if data}
            {#if activeTab === 'base'}
                <BaseAttributesTab
                    {blockId}
                    {data}
                    onFieldChange={handleBlockFieldChange}
                    onReload={reloadData}
                />
            {:else if activeTab === 'governed'}
                <GovernedAttributesTab
                    {blockId}
                    {data}
                    onBlockFieldChange={handleBlockFieldChange}
                    onAVCellChange={handleAVCellChange}
                    onReload={reloadData}
                />
            {/if}
        {/if}
    </div>

    <!-- 底部状态指示栏 -->
    <div class="dock-footer">
        <span class="status-indicator">{saveStatus}</span>
    </div>
</div>

<style>
    .indexos-dock-inspector {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font-size: 12px;
        overflow: hidden;
        user-select: text;
    }

    .dock-header {
        padding: 8px 10px;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex-shrink: 0;
    }

    .context-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .banner-left {
        display: flex;
        align-items: center;
        gap: 6px;
        overflow: hidden;
        flex: 1;
    }

    .block-type-chip {
        font-size: 11px;
        font-weight: 700;
        background: rgba(59, 130, 246, 0.15);
        color: var(--indexos-accent-primary, #3B82F6);
        padding: 2px 6px;
        border-radius: 4px;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .block-snippet {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .banner-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
    }

    .action-icon-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 3px;
        border-radius: 4px;
        font-size: 12px;
        opacity: 0.6;
        transition: all 0.15s;
    }

    .action-icon-btn:hover {
        opacity: 1;
        background: var(--b3-theme-background);
    }

    .action-icon-btn.pinned {
        opacity: 1;
        background: rgba(245, 158, 11, 0.18);
        border: 1px solid rgba(245, 158, 11, 0.4);
    }

    .meta-subline {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .meta-block-id {
        font-size: 10px;
        font-family: monospace;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
    }

    .meta-block-id:hover {
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .meta-proj-badge {
        font-size: 9px;
        background: rgba(16, 185, 129, 0.12);
        color: #059669;
        padding: 1px 4px;
        border-radius: 3px;
        font-weight: 600;
    }

    .dock-tabs {
        display: flex;
        background: var(--b3-theme-surface);
        padding: 4px 8px;
        gap: 4px;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .tab-btn {
        flex: 1;
        background: transparent;
        border: none;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 6px;
        border-radius: 4px;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        transition: all 0.15s;
    }

    .tab-btn.active {
        background: var(--b3-theme-background);
        color: var(--indexos-accent-primary, #3B82F6);
        font-weight: 700;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }

    .dock-body {
        flex: 1;
        overflow-y: auto;
        padding: 8px 10px;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .loading-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 30px 0;
        gap: 8px;
        color: var(--b3-theme-on-surface-light);
    }

    .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(59, 130, 246, 0.2);
        border-top-color: var(--indexos-accent-primary, #3B82F6);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 10px;
        gap: 8px;
        color: var(--b3-theme-on-surface-light);
        text-align: center;
    }

    .dock-footer {
        padding: 4px 10px;
        background: var(--b3-theme-surface);
        border-top: 1px solid var(--b3-border-color);
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }

    .status-indicator {
        opacity: 0.8;
    }
</style>
