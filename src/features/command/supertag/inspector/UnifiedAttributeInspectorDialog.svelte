<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import {
        loadBlockAttributeData,
        updateBlockAttributeValue,
        toggleSupertagOnBlock,
        type BlockAttributeData,
        type TypedField
    } from "./attribute-model";
    import { supertagAVProjector } from "../projection/supertag-av-projector";

    export let blockId: string;
    export let dialog: any;
    export let protyle: any = null;

    let loading = true;
    let data: BlockAttributeData | null = null;
    let activeTab: "typed" | "builtin" | "custom" = "typed";
    let newTagInput = "";
    let isAddingTag = false;
    let newCustomKey = "";
    let newCustomVal = "";
    let isAddingCustom = false;
    let saveStatus = "✓ 已自动实时同步";
    let saveStatusTimer: any = null;

    onMount(async () => {
        await reloadData();
    });

    async function reloadData() {
        loading = true;
        try {
            data = await loadBlockAttributeData(blockId);
            if (data.typedFields.length === 0 && data.rawCustomFields.length > 0) {
                activeTab = "custom";
            } else if (data.typedFields.length === 0 && data.supertags.length === 0) {
                activeTab = "builtin";
            }
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
        }, 600);
    }

    async function handleFieldChange(attrKey: string, attrValue: string) {
        triggerSaveFeedback();
        await updateBlockAttributeValue(blockId, attrKey, attrValue);
        // 通知可能存在的活动编辑器局部重绘
        if (data?.projectionInfo?.isProjected) {
            supertagAVProjector.notifyFrontendToRerender(data.projectionInfo.tableName || "", blockId);
        }
    }

    function handleCheckboxToggle(field: TypedField, e: Event) {
        const target = e.target as HTMLInputElement;
        field.value = target?.checked ? 'true' : 'false';
        handleFieldChange(field.key, field.value);
    }

    async function handleAddTag() {
        const tag = newTagInput.replace(/#/g, "").trim();
        if (!tag) {
            isAddingTag = false;
            return;
        }
        await toggleSupertagOnBlock(blockId, tag, "add");
        newTagInput = "";
        isAddingTag = false;
        await reloadData();
        showMessage(`✓ 已为当前块挂载 Supertag: #${tag}`);
    }

    async function handleRemoveTag(tag: string) {
        await toggleSupertagOnBlock(blockId, tag, "remove");
        await reloadData();
        showMessage(`✓ 已移除 Supertag: #${tag}`);
    }

    async function handleAddCustomField() {
        const key = newCustomKey.trim();
        const val = newCustomVal.trim();
        if (!key) return;
        await updateBlockAttributeValue(blockId, key, val);
        newCustomKey = "";
        newCustomVal = "";
        isAddingCustom = false;
        await reloadData();
        showMessage(`✓ 已新增自定义属性: custom-${key}`);
    }

    async function handleRemoveCustomField(rawKey: string) {
        await updateBlockAttributeValue(blockId, rawKey, "");
        await reloadData();
    }

    function copyBlockId() {
        navigator.clipboard.writeText(blockId);
        showMessage("✓ 块 ID 已复制到剪贴板");
    }

    const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
        "1": { bg: "rgba(59, 130, 246, 0.12)", text: "#2563EB", border: "rgba(59, 130, 246, 0.3)" },  // Blue
        "2": { bg: "rgba(16, 185, 129, 0.12)", text: "#059669", border: "rgba(16, 185, 129, 0.3)" },  // Green
        "3": { bg: "rgba(245, 158, 11, 0.12)", text: "#D97706", border: "rgba(245, 158, 11, 0.3)" },  // Amber/Orange
        "4": { bg: "rgba(239, 68, 68, 0.12)", text: "#DC2626", border: "rgba(239, 68, 68, 0.3)" },    // Red
        "5": { bg: "rgba(139, 92, 246, 0.12)", text: "#7C3AED", border: "rgba(139, 92, 246, 0.3)" },  // Purple
        "6": { bg: "rgba(236, 72, 153, 0.12)", text: "#DB2777", border: "rgba(236, 72, 153, 0.3)" },  // Pink
        "7": { bg: "rgba(20, 184, 166, 0.12)", text: "#0D9488", border: "rgba(20, 184, 166, 0.3)" },  // Teal
        "8": { bg: "rgba(107, 114, 128, 0.12)", text: "#4B5563", border: "rgba(107, 114, 128, 0.3)" }  // Gray
    };
</script>

<div class="indexos-inspector-container">
    <!-- 头部：块概要与 Supertag 快速管理 -->
    <div class="inspector-header">
        <div class="header-top">
            <div class="block-meta">
                <span class="block-type-badge">{data?.blockType || 'NodeBlock'}</span>
                <span class="block-id-badge" role="button" tabindex="0" title="点击复制 Block ID" on:click={copyBlockId} on:keydown={e => e.key === 'Enter' && copyBlockId()}>
                    📋 {blockId}
                </span>
            </div>
            {#if data?.projectionInfo?.isProjected}
                <div class="projection-tag" title="当前 Supertag 已通过 Hot-SQLite 投影至数据库">
                    ⚡ 投影已就绪 ({data.projectionInfo.tableName})
                </div>
            {/if}
        </div>

        <!-- Supertag 标签列表与快速添加 -->
        <div class="supertags-bar">
            <span class="supertags-label">🏷️ 挂载标签：</span>
            <div class="supertags-list">
                {#if data && data.supertags.length > 0}
                    {#each data.supertags as tag}
                        <span class="supertag-chip">
                            <span class="tag-hash">#</span>{tag}
                            <button class="chip-del-btn" title="移除标签" on:click={() => handleRemoveTag(tag)}>✕</button>
                        </span>
                    {/each}
                {:else}
                    <span class="no-tag-tip">暂无挂载标签</span>
                {/if}

                {#if isAddingTag}
                    <div class="inline-add-tag">
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 11px; padding: 2px 6px; height: 22px; width: 90px;"
                            placeholder="标签名称"
                            bind:value={newTagInput}
                            on:keydown={e => e.key === 'Enter' && handleAddTag()}
                            autoFocus
                        />
                        <button class="b3-button b3-button--text" style="font-size: 11px; padding: 0 4px;" on:click={handleAddTag}>✓</button>
                        <button class="b3-button b3-button--text" style="font-size: 11px; padding: 0 4px; opacity: 0.6;" on:click={() => { isAddingTag = false; }}>✕</button>
                    </div>
                {:else}
                    <button class="add-tag-btn" on:click={() => { isAddingTag = true; }}>+ 标签</button>
                {/if}
            </div>
        </div>
    </div>

    <!-- Tab 导航栏 -->
    <div class="inspector-tabs">
        <button
            class="tab-item {activeTab === 'typed' ? 'active' : ''}"
            on:click={() => { activeTab = 'typed'; }}
        >
            ✨ 强类型属性 ({data?.typedFields.length || 0})
        </button>
        <button
            class="tab-item {activeTab === 'builtin' ? 'active' : ''}"
            on:click={() => { activeTab = 'builtin'; }}
        >
            ⚙️ 系统内置属性 (4)
        </button>
        <button
            class="tab-item {activeTab === 'custom' ? 'active' : ''}"
            on:click={() => { activeTab = 'custom'; }}
        >
            🧩 自定义属性 ({data?.rawCustomFields.length || 0})
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
            <!-- 1. 强类型属性面板 (Supertag Schema) -->
            {#if activeTab === 'typed'}
                <div class="field-list">
                    {#if data.typedFields.length === 0}
                        <div class="empty-field-state">
                            <span>当前块尚未绑定包含强类型字段的 Supertag</span>
                            <span style="font-size: 11px; opacity: 0.7;">可在上方添加如 <b>#task</b> 等标签快速启用类型化字段</span>
                        </div>
                    {:else}
                        {#each data.typedFields as field}
                            <div class="field-card">
                                <div class="field-header">
                                    <div class="field-name-wrap">
                                        <span class="field-label">{field.label}</span>
                                        <span class="field-key-raw">custom-{field.key}</span>
                                    </div>
                                    <span class="field-type-pill">{field.type}</span>
                                </div>

                                <!-- 根据类型渲染强类型输入控件 -->
                                <div class="field-control">
                                    {#if field.type === 'select'}
                                        <!-- 单选胶囊列表 -->
                                        <div class="capsule-options">
                                            {#if field.options}
                                                {#each field.options as opt}
                                                    {@const colorInfo = COLOR_MAP[opt.color] || COLOR_MAP["1"]}
                                                    <button
                                                        class="capsule-btn {field.value === opt.name ? 'selected' : ''}"
                                                        style="background: {field.value === opt.name ? colorInfo.bg : 'var(--b3-theme-background)'}; color: {field.value === opt.name ? colorInfo.text : 'var(--b3-theme-on-background)'}; border-color: {field.value === opt.name ? colorInfo.border : 'var(--b3-border-color)'};"
                                                        on:click={() => {
                                                            field.value = (field.value === opt.name ? "" : opt.name);
                                                            handleFieldChange(field.key, field.value);
                                                        }}
                                                    >
                                                        {opt.name}
                                                    </button>
                                                {/each}
                                            {/if}
                                            <!-- 自定义输入 -->
                                            <input
                                                type="text"
                                                class="b3-text-field"
                                                style="font-size: 11px; height: 26px; width: 100px;"
                                                placeholder="自定义值..."
                                                bind:value={field.value}
                                                on:change={() => handleFieldChange(field.key, field.value)}
                                            />
                                        </div>

                                    {:else if field.type === 'date'}
                                        <input
                                            type="date"
                                            class="b3-text-field"
                                            style="font-size: 12px; height: 30px; width: 100%; max-width: 220px;"
                                            bind:value={field.value}
                                            on:change={() => handleFieldChange(field.key, field.value)}
                                        />

                                    {:else if field.type === 'checkbox'}
                                        <label class="switch-wrap">
                                            <input
                                                type="checkbox"
                                                class="b3-switch"
                                                checked={field.value === 'true' || field.value === '1'}
                                                on:change={(e) => handleCheckboxToggle(field, e)}
                                            />
                                            <span style="font-size: 12px; font-weight: 500;">{field.value === 'true' ? '已启用 (True)' : '已关闭 (False)'}</span>
                                        </label>

                                    {:else if field.type === 'number'}
                                        <input
                                            type="number"
                                            class="b3-text-field"
                                            style="font-size: 12px; height: 30px; width: 140px;"
                                            bind:value={field.value}
                                            on:change={() => handleFieldChange(field.key, field.value)}
                                        />

                                    {:else}
                                        <textarea
                                            class="b3-text-field"
                                            style="font-size: 12px; width: 100%; resize: vertical;"
                                            rows="2"
                                            bind:value={field.value}
                                            on:change={() => handleFieldChange(field.key, field.value)}
                                            placeholder="输入属性值..."
                                        ></textarea>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    {/if}
                </div>

            <!-- 2. 系统内置属性面板 (Builtin) -->
            {:else if activeTab === 'builtin'}
                <div class="builtin-list">
                    <div class="field-card">
                        <span class="field-label">🔖 书签 (Bookmark)</span>
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 12px; width: 100%; margin-top: 4px;"
                            placeholder="书签标记..."
                            bind:value={data.builtin.bookmark}
                            on:change={() => handleFieldChange('bookmark', data?.builtin.bookmark || '')}
                        />
                    </div>

                    <div class="field-card">
                        <span class="field-label">🏷️ 命名 (Name)</span>
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 12px; width: 100%; margin-top: 4px;"
                            placeholder="块命名..."
                            bind:value={data.builtin.name}
                            on:change={() => handleFieldChange('name', data?.builtin.name || '')}
                        />
                    </div>

                    <div class="field-card">
                        <span class="field-label">🔤 别名 (Alias)</span>
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 12px; width: 100%; margin-top: 4px;"
                            placeholder="多个别名用逗号隔开..."
                            bind:value={data.builtin.alias}
                            on:change={() => handleFieldChange('alias', data?.builtin.alias || '')}
                        />
                    </div>

                    <div class="field-card">
                        <span class="field-label">📝 备注 (Memo)</span>
                        <textarea
                            class="b3-text-field"
                            style="font-size: 12px; width: 100%; margin-top: 4px; resize: vertical;"
                            rows="2"
                            placeholder="块备注内容..."
                            bind:value={data.builtin.memo}
                            on:change={() => handleFieldChange('memo', data?.builtin.memo || '')}
                        ></textarea>
                    </div>
                </div>

            <!-- 3. 自定义属性面板 (Custom) -->
            {:else if activeTab === 'custom'}
                <div class="custom-list">
                    {#if data.rawCustomFields.length === 0}
                        <div class="empty-field-state">
                            <span>暂无未分类的 custom-* 自定义属性</span>
                        </div>
                    {:else}
                        {#each data.rawCustomFields as customItem}
                            <div class="custom-field-row">
                                <div class="custom-key-col">
                                    <span class="custom-key-text">{customItem.rawKey}</span>
                                </div>
                                <div class="custom-val-col">
                                    <input
                                        type="text"
                                        class="b3-text-field"
                                        style="font-size: 12px; width: 100%;"
                                        bind:value={customItem.value}
                                        on:change={() => handleFieldChange(customItem.rawKey, customItem.value)}
                                    />
                                </div>
                                <button
                                    class="custom-del-btn"
                                    title="删除此自定义属性"
                                    on:click={() => handleRemoveCustomField(customItem.rawKey)}
                                >✕</button>
                            </div>
                        {/each}
                    {/if}

                    <!-- 新建自定义属性 -->
                    <div class="add-custom-box">
                        {#if isAddingCustom}
                            <div class="add-custom-form">
                                <input
                                    type="text"
                                    class="b3-text-field"
                                    style="font-size: 11px; width: 120px;"
                                    placeholder="属性名 (如 my-attr)"
                                    bind:value={newCustomKey}
                                />
                                <input
                                    type="text"
                                    class="b3-text-field"
                                    style="font-size: 11px; flex: 1;"
                                    placeholder="属性初始值..."
                                    bind:value={newCustomVal}
                                />
                                <button class="b3-button b3-button--primary" style="font-size: 11px; padding: 2px 10px;" on:click={handleAddCustomField}>添加</button>
                                <button class="b3-button b3-button--text" style="font-size: 11px; padding: 2px 6px;" on:click={() => { isAddingCustom = false; }}>取消</button>
                            </div>
                        {:else}
                            <button class="b3-button b3-button--outline" style="font-size: 11px; width: 100%;" on:click={() => { isAddingCustom = true; }}>
                                + 添加自定义属性
                            </button>
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
    </div>

    <!-- 底部状态与操作栏 -->
    <div class="inspector-footer">
        <span class="save-status-text">{saveStatus}</span>
        <button class="b3-button b3-button--primary" style="font-size: 12px; padding: 4px 16px;" on:click={() => dialog?.destroy()}>
            完成
        </button>
    </div>
</div>

<style>
    .indexos-inspector-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
        padding: 14px;
        gap: 10px;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        overflow: hidden;
    }

    .inspector-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: var(--b3-theme-surface);
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .block-meta {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .block-type-badge {
        font-size: 10px;
        font-weight: 600;
        background: var(--indexos-weak-accent, rgba(59, 130, 246, 0.15));
        color: var(--indexos-accent-primary, #3B82F6);
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
    }

    .block-id-badge {
        font-size: 11px;
        font-family: monospace;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        background: var(--b3-theme-background);
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px dashed var(--b3-border-color);
        transition: all 0.15s ease;
    }

    .block-id-badge:hover {
        color: var(--indexos-accent-primary, #3B82F6);
        border-color: var(--indexos-accent-primary, #3B82F6);
    }

    .projection-tag {
        font-size: 10px;
        background: rgba(16, 185, 129, 0.12);
        color: #059669;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
    }

    .supertags-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .supertags-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--b3-theme-on-surface-light);
    }

    .supertags-list {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .supertag-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        padding: 2px 6px;
        border-radius: 12px;
        color: var(--b3-theme-on-background);
    }

    .tag-hash {
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .chip-del-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0;
        font-size: 10px;
        opacity: 0.4;
        transition: opacity 0.15s;
    }

    .chip-del-btn:hover {
        opacity: 1;
        color: #DC2626;
    }

    .no-tag-tip {
        font-size: 11px;
        opacity: 0.5;
    }

    .add-tag-btn {
        background: transparent;
        border: 1px dashed var(--b3-border-color);
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        transition: all 0.15s;
    }

    .add-tag-btn:hover {
        border-color: var(--indexos-accent-primary, #3B82F6);
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .inline-add-tag {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .inspector-tabs {
        display: flex;
        gap: 4px;
        background: var(--b3-theme-surface);
        padding: 3px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .tab-item {
        flex: 1;
        background: transparent;
        border: none;
        font-size: 11px;
        font-weight: 500;
        padding: 5px 8px;
        border-radius: 4px;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        transition: all 0.15s;
    }

    .tab-item.active {
        background: var(--b3-theme-background);
        color: var(--indexos-accent-primary, #3B82F6);
        font-weight: 600;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .inspector-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
    }

    .field-list, .builtin-list, .custom-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .field-card {
        background: var(--b3-theme-surface);
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .field-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .field-name-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .field-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .field-key-raw {
        font-size: 10px;
        font-family: monospace;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
    }

    .field-type-pill {
        font-size: 9px;
        background: var(--b3-theme-background);
        padding: 1px 5px;
        border-radius: 3px;
        color: var(--b3-theme-on-surface-light);
        border: 1px solid var(--b3-border-color);
        text-transform: uppercase;
    }

    .capsule-options {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .capsule-btn {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 12px;
        border: 1px solid var(--b3-border-color);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .switch-wrap {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
    }

    .custom-field-row {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--b3-theme-surface);
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
    }

    .custom-key-col {
        width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .custom-key-text {
        font-size: 11px;
        font-family: monospace;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .custom-val-col {
        flex: 1;
    }

    .custom-del-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        opacity: 0.4;
        font-size: 12px;
        padding: 2px 6px;
    }

    .custom-del-btn:hover {
        opacity: 1;
        color: #DC2626;
    }

    .add-custom-box {
        margin-top: 4px;
    }

    .add-custom-form {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--b3-theme-surface);
        padding: 8px;
        border-radius: 6px;
        border: 1px dashed var(--b3-border-color);
    }

    .empty-field-state {
        text-align: center;
        padding: 40px 10px;
        color: var(--b3-theme-on-surface-light);
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
    }

    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 50px 0;
        gap: 10px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }

    .loading-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--b3-border-color);
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
        padding-top: 6px;
        border-top: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .save-status-text {
        font-size: 11px;
        color: #059669;
        font-weight: 500;
    }
</style>
