<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { showMessage } from "siyuan";
    import {
        loadBlockAttributeData,
        updateBlockAttributeValue,
        toggleSupertagOnBlock,
        type BlockAttributeData,
        type TypedField
    } from "./attribute-model";
    import { activeBlockTracker, type ActiveBlockContext } from "./active-block-tracker";
    import { supertagAVProjector } from "../projection/supertag-av-projector";

    let currentContext: ActiveBlockContext | null = null;
    let blockId: string = "";
    let loading = true;
    let data: BlockAttributeData | null = null;
    let activeTab: "typed" | "builtin" | "custom" = "typed";
    let isPinned = false;

    let newTagInput = "";
    let isAddingTag = false;
    let newCustomKey = "";
    let newCustomVal = "";
    let isAddingCustom = false;
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
            if (data.typedFields.length === 0 && data.rawCustomFields.length > 0) {
                activeTab = "custom";
            } else if (data.typedFields.length === 0 && data.supertags.length === 0) {
                activeTab = "builtin";
            } else {
                activeTab = "typed";
            }
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

    async function handleFieldChange(attrKey: string, attrValue: string) {
        if (!blockId) return;
        triggerSaveFeedback();
        await updateBlockAttributeValue(blockId, attrKey, attrValue);
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
        if (!blockId) return;
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
        if (!blockId) return;
        await toggleSupertagOnBlock(blockId, tag, "remove");
        await reloadData();
        showMessage(`✓ 已移除 Supertag: #${tag}`);
    }

    async function handleAddCustomField() {
        if (!blockId) return;
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
        if (!blockId) return;
        await updateBlockAttributeValue(blockId, rawKey, "");
        await reloadData();
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

    function copyBlockId() {
        if (!blockId) return;
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
                <span class="meta-block-id" role="button" tabindex="0" title="点击复制 Block ID" on:click={copyBlockId} on:keydown={e => e.key === 'Enter' && copyBlockId()}>
                    ID: {blockId.slice(0, 14)}...
                </span>
                {#if data?.projectionInfo?.isProjected}
                    <span class="meta-proj-badge">⚡ 投影已就绪</span>
                {/if}
            </div>
        {/if}

        <!-- Supertag 标签胶囊区 -->
        <div class="supertags-section">
            <div class="supertags-wrap">
                {#if data && data.supertags.length > 0}
                    {#each data.supertags as tag}
                        <span class="supertag-chip">
                            <span class="tag-hash">#</span>{tag}
                            <button class="chip-del-btn" title="移除标签" on:click={() => handleRemoveTag(tag)}>✕</button>
                        </span>
                    {/each}
                {:else}
                    <span class="no-tag-tip">暂无标签</span>
                {/if}

                {#if isAddingTag}
                    <div class="inline-add-tag">
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 11px; padding: 2px 4px; height: 20px; width: 75px;"
                            placeholder="标签名"
                            bind:value={newTagInput}
                            on:keydown={e => e.key === 'Enter' && handleAddTag()}
                            autoFocus
                        />
                        <button class="b3-button b3-button--text" style="font-size: 11px; padding: 0 3px;" on:click={handleAddTag}>✓</button>
                        <button class="b3-button b3-button--text" style="font-size: 11px; padding: 0 3px; opacity: 0.5;" on:click={() => { isAddingTag = false; }}>✕</button>
                    </div>
                {:else}
                    <button class="add-tag-btn" on:click={() => { isAddingTag = true; }}>+ 标签</button>
                {/if}
            </div>
        </div>
    </div>

    <!-- Tab 导航 -->
    <div class="dock-tabs">
        <button
            class="tab-btn {activeTab === 'typed' ? 'active' : ''}"
            on:click={() => { activeTab = 'typed'; }}
        >
            ✨ 强类型 ({data?.typedFields.length || 0})
        </button>
        <button
            class="tab-btn {activeTab === 'builtin' ? 'active' : ''}"
            on:click={() => { activeTab = 'builtin'; }}
        >
            ⚙️ 内置 (4)
        </button>
        <button
            class="tab-btn {activeTab === 'custom' ? 'active' : ''}"
            on:click={() => { activeTab = 'custom'; }}
        >
            🧩 自定义 ({data?.rawCustomFields.length || 0})
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
                <span>请在编辑器中点击或选择一个块</span>
            </div>
        {:else if data}
            <!-- 1. 强类型属性区 (Supertag Schema) -->
            {#if activeTab === 'typed'}
                <div class="fields-container">
                    {#if data.typedFields.length === 0}
                        <div class="empty-state">
                            <span>当前块未绑定含强类型属性的 Supertag</span>
                            <span style="font-size: 11px; opacity: 0.6;">可在上方添加 <b>#task</b> 体验状态/优先级字段</span>
                        </div>
                    {:else}
                        {#each data.typedFields as field}
                            <div class="field-item">
                                <div class="field-item-header">
                                    <span class="field-label-text">{field.label}</span>
                                    <span class="field-pill">{field.type}</span>
                                </div>

                                <div class="field-control-wrap">
                                    {#if field.type === 'select'}
                                        <div class="capsules-flow">
                                            {#if field.options}
                                                {#each field.options as opt}
                                                    {@const c = COLOR_MAP[opt.color] || COLOR_MAP["1"]}
                                                    <button
                                                        class="capsule-opt {field.value === opt.name ? 'selected' : ''}"
                                                        style="background: {field.value === opt.name ? c.bg : 'var(--b3-theme-background)'}; color: {field.value === opt.name ? c.text : 'var(--b3-theme-on-background)'}; border-color: {field.value === opt.name ? c.border : 'var(--b3-border-color)'};"
                                                        on:click={() => {
                                                            field.value = (field.value === opt.name ? "" : opt.name);
                                                            handleFieldChange(field.key, field.value);
                                                        }}
                                                    >
                                                        {opt.name}
                                                    </button>
                                                {/each}
                                            {/if}
                                        </div>
                                    {:else if field.type === 'date'}
                                        <input
                                            type="date"
                                            class="b3-text-field"
                                            style="font-size: 11px; height: 26px; width: 100%;"
                                            bind:value={field.value}
                                            on:change={() => handleFieldChange(field.key, field.value)}
                                        />
                                    {:else if field.type === 'checkbox'}
                                        <label class="switch-row">
                                            <input
                                                type="checkbox"
                                                class="b3-switch"
                                                checked={field.value === 'true' || field.value === '1'}
                                                on:change={(e) => handleCheckboxToggle(field, e)}
                                            />
                                            <span style="font-size: 11px;">{field.value === 'true' ? 'True (开启)' : 'False (关闭)'}</span>
                                        </label>
                                    {:else if field.type === 'number'}
                                        <input
                                            type="number"
                                            class="b3-text-field"
                                            style="font-size: 11px; height: 26px; width: 100%;"
                                            bind:value={field.value}
                                            on:change={() => handleFieldChange(field.key, field.value)}
                                        />
                                    {:else}
                                        <textarea
                                            class="b3-text-field"
                                            style="font-size: 11px; width: 100%; resize: vertical;"
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

            <!-- 2. 系统内置属性区 -->
            {:else if activeTab === 'builtin'}
                <div class="fields-container">
                    <div class="field-item">
                        <span class="field-label-text">🔖 书签 (Bookmark)</span>
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 11px; width: 100%; margin-top: 2px;"
                            placeholder="书签标记..."
                            bind:value={data.builtin.bookmark}
                            on:change={() => handleFieldChange('bookmark', data?.builtin.bookmark || '')}
                        />
                    </div>

                    <div class="field-item">
                        <span class="field-label-text">🏷️ 命名 (Name)</span>
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 11px; width: 100%; margin-top: 2px;"
                            placeholder="块命名..."
                            bind:value={data.builtin.name}
                            on:change={() => handleFieldChange('name', data?.builtin.name || '')}
                        />
                    </div>

                    <div class="field-item">
                        <span class="field-label-text">🔤 别名 (Alias)</span>
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 11px; width: 100%; margin-top: 2px;"
                            placeholder="别名..."
                            bind:value={data.builtin.alias}
                            on:change={() => handleFieldChange('alias', data?.builtin.alias || '')}
                        />
                    </div>

                    <div class="field-item">
                        <span class="field-label-text">📝 备注 (Memo)</span>
                        <textarea
                            class="b3-text-field"
                            style="font-size: 11px; width: 100%; margin-top: 2px; resize: vertical;"
                            rows="2"
                            placeholder="备注内容..."
                            bind:value={data.builtin.memo}
                            on:change={() => handleFieldChange('memo', data?.builtin.memo || '')}
                        ></textarea>
                    </div>
                </div>

            <!-- 3. 自定义属性区 -->
            {:else if activeTab === 'custom'}
                <div class="fields-container">
                    {#if data.rawCustomFields.length === 0}
                        <div class="empty-state">
                            <span>暂无 custom-* 自定义属性</span>
                        </div>
                    {:else}
                        {#each data.rawCustomFields as customItem}
                            <div class="custom-row">
                                <div class="custom-header">
                                    <span class="custom-key-text">{customItem.rawKey}</span>
                                    <button class="custom-del" title="删除" on:click={() => handleRemoveCustomField(customItem.rawKey)}>✕</button>
                                </div>
                                <input
                                    type="text"
                                    class="b3-text-field"
                                    style="font-size: 11px; width: 100%;"
                                    bind:value={customItem.value}
                                    on:change={() => handleFieldChange(customItem.rawKey, customItem.value)}
                                />
                            </div>
                        {/each}
                    {/if}

                    <div class="add-custom-section">
                        {#if isAddingCustom}
                            <div class="add-custom-box">
                                <input
                                    type="text"
                                    class="b3-text-field"
                                    style="font-size: 11px; width: 100%;"
                                    placeholder="属性名 (如 my-attr)"
                                    bind:value={newCustomKey}
                                />
                                <input
                                    type="text"
                                    class="b3-text-field"
                                    style="font-size: 11px; width: 100%; margin-top: 4px;"
                                    placeholder="属性值..."
                                    bind:value={newCustomVal}
                                />
                                <div style="display: flex; gap: 4px; margin-top: 6px;">
                                    <button class="b3-button b3-button--primary" style="font-size: 11px; flex: 1;" on:click={handleAddCustomField}>确定</button>
                                    <button class="b3-button b3-button--cancel" style="font-size: 11px;" on:click={() => { isAddingCustom = false; }}>取消</button>
                                </div>
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
        width: 100%;
        box-sizing: border-box;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        overflow: hidden;
        font-family: var(--b3-font-family);
    }

    .dock-header {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 10px;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .context-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
    }

    .banner-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1;
    }

    .block-type-chip {
        font-size: 10px;
        font-weight: 700;
        background: var(--indexos-weak-accent, rgba(59, 130, 246, 0.15));
        color: var(--indexos-accent-primary, #3B82F6);
        padding: 1px 5px;
        border-radius: 4px;
        flex-shrink: 0;
    }

    .block-snippet {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
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

    .supertags-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 2px;
    }

    .supertags-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
    }

    .supertag-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 10px;
        font-weight: 600;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        padding: 1px 5px;
        border-radius: 10px;
    }

    .tag-hash {
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .chip-del-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0;
        font-size: 9px;
        opacity: 0.4;
    }

    .chip-del-btn:hover {
        opacity: 1;
        color: #DC2626;
    }

    .no-tag-tip {
        font-size: 10px;
        opacity: 0.5;
    }

    .add-tag-btn {
        background: transparent;
        border: 1px dashed var(--b3-border-color);
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 8px;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
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

    .dock-tabs {
        display: flex;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
        padding: 2px 6px;
        gap: 4px;
    }

    .tab-btn {
        flex: 1;
        background: transparent;
        border: none;
        font-size: 10px;
        font-weight: 500;
        padding: 5px 2px;
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
    }

    .fields-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .field-item {
        background: var(--b3-theme-surface);
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .field-item-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .field-label-text {
        font-size: 11px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .field-pill {
        font-size: 9px;
        background: var(--b3-theme-background);
        padding: 1px 4px;
        border-radius: 3px;
        color: var(--b3-theme-on-surface-light);
        border: 1px solid var(--b3-border-color);
        text-transform: uppercase;
    }

    .capsules-flow {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
    }

    .capsule-opt {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 10px;
        border: 1px solid var(--b3-border-color);
        cursor: pointer;
        transition: all 0.15s;
    }

    .switch-row {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
    }

    .custom-row {
        background: var(--b3-theme-surface);
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .custom-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .custom-key-text {
        font-size: 10px;
        font-family: monospace;
        font-weight: 600;
    }

    .custom-del {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 10px;
        opacity: 0.4;
    }

    .custom-del:hover {
        opacity: 1;
        color: #DC2626;
    }

    .add-custom-box {
        background: var(--b3-theme-surface);
        padding: 6px;
        border-radius: 6px;
        border: 1px dashed var(--b3-border-color);
        margin-top: 4px;
    }

    .empty-state {
        text-align: center;
        padding: 40px 10px;
        color: var(--b3-theme-on-surface-light);
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
    }

    .loading-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 0;
        gap: 8px;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--b3-border-color);
        border-top-color: var(--indexos-accent-primary, #3B82F6);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .dock-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 4px 8px;
        background: var(--b3-theme-surface);
        border-top: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .status-indicator {
        font-size: 10px;
        color: #059669;
        font-weight: 500;
    }
</style>
