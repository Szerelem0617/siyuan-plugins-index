<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import {
        loadBlockAttributeData,
        updateBlockAttributeValue,
        updateAVCellAttributeValue,
        type BlockAttributeData
    } from "./attribute-model";
    import { supertagAVProjector } from "../projection/supertag-av-projector";
    import BaseAttributesTab from "./BaseAttributesTab.svelte";
    import GovernedAttributesTab from "./GovernedAttributesTab.svelte";

    export let blockId: string;
    export let dialog: any;
    export let protyle: any = null;

    let loading = true;
    let data: BlockAttributeData | null = null;
    let activeTab: "base" | "governed" = "base";

    let saveStatus = "✓ 已自动实时同步";
    let saveStatusTimer: any = null;

    onMount(async () => {
        await reloadData();
    });

    async function reloadData() {
        loading = true;
        try {
            data = await loadBlockAttributeData(blockId);
        } catch (e) {
            console.error("[UnifiedInspector] 加载属性异常:", e);
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

    function copyText(txt: string, tip = "已复制") {
        navigator.clipboard.writeText(txt);
        showMessage(`✓ ${tip}`);
    }
</script>

<div class="indexos-inspector-container">
    <!-- 头部：块概要与 Supertag 快速管理 -->
    <div class="inspector-header">
        <div class="header-top">
            <div class="block-meta">
                <span class="block-type-badge">{data?.blockType || 'NodeBlock'}</span>
                <span class="block-id-badge" role="button" tabindex="0" title="点击复制 Block ID" on:click={() => copyText(blockId, "块 ID 已复制")} on:keydown={e => e.key === 'Enter' && copyText(blockId, "块 ID 已复制")}>
                    📋 {blockId}
                </span>
            </div>
            {#if data?.projectionInfo?.isProjected}
                <div class="projection-tag" title="当前 Supertag 已通过 Hot-SQLite 投影至数据库">
                    ⚡ 虚拟投影已就绪 ({data.projectionInfo.tableName})
                </div>
            {/if}
        </div>
    </div>

    <!-- 双 Tab 导航栏 (基础属性在左，结构化属性在右) -->
    <div class="inspector-tabs">
        <button
            class="tab-item {activeTab === 'base' ? 'active' : ''}"
            on:click={() => { activeTab = 'base'; }}
        >
            ⚙️ 基础属性
        </button>
        <button
            class="tab-item {activeTab === 'governed' ? 'active' : ''}"
            on:click={() => { activeTab = 'governed'; }}
        >
            🧩 结构化属性
        </button>
    </div>

    <!-- 主内容区 -->
    <div class="inspector-body">
        {#if loading}
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <span>正在加载统一属性...</span>
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

    <!-- 底部状态栏 -->
    <div class="inspector-footer">
        <span class="status-msg">{saveStatus}</span>
        <button class="b3-button b3-button--text" style="font-size: 11px;" on:click={() => dialog?.destroy()}>
            关闭
        </button>
    </div>
</div>

<style>
    .indexos-inspector-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 80vh;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        box-sizing: border-box;
        padding: 12px 16px;
        gap: 10px;
    }

    .inspector-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .block-meta {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .block-type-badge {
        font-size: 11px;
        font-weight: 700;
        background: rgba(59, 130, 246, 0.12);
        color: var(--indexos-accent-primary, #3B82F6);
        padding: 2px 8px;
        border-radius: 4px;
    }

    .block-id-badge {
        font-size: 11px;
        font-family: monospace;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        transition: background 0.15s;
    }

    .block-id-badge:hover {
        background: var(--b3-theme-surface);
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .projection-tag {
        font-size: 11px;
        background: rgba(16, 185, 129, 0.12);
        color: #059669;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 500;
    }

    .inspector-tabs {
        display: flex;
        gap: 4px;
        background: var(--b3-theme-surface);
        padding: 4px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .tab-item {
        flex: 1;
        background: transparent;
        border: none;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        transition: all 0.15s;
    }

    .tab-item.active {
        background: var(--b3-theme-background);
        color: var(--indexos-accent-primary, #3B82F6);
        font-weight: 700;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .inspector-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
    }

    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 0;
        gap: 10px;
        color: var(--b3-theme-on-surface-light);
    }

    .loading-spinner {
        width: 24px;
        height: 24px;
        border: 2px solid rgba(59, 130, 246, 0.2);
        border-top-color: var(--indexos-accent-primary, #3B82F6);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .inspector-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 8px;
        border-top: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .status-msg {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }
</style>
