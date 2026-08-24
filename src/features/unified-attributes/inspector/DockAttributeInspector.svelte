<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { showMessage } from "siyuan";
    import {
        loadBlockAttributeData,
        updateBlockAttributeValue,
        updateAVCellAttributeValue,
        type BlockAttributeData,
        type SupertagField,
        type AVDatabaseField
    } from "./attribute-model";
    import { activeBlockTracker, type ActiveBlockContext } from "./active-block-tracker";
    import { supertagAVProjector } from "../projection/supertag-av-projector";

    let currentContext: ActiveBlockContext | null = null;
    let blockId: string = "";
    let loading = true;
    let data: BlockAttributeData | null = null;
    let activeTab: "governed" | "base" = "governed";
    let isPinned = false;
    let showSystemMeta = false;

    let addingTagFieldFor: string | null = null;
    let newTagFieldKey = "";
    let newCustomKey = "";
    let newCustomVal = "";
    let isAddingCustom = false;
    let saveStatus = "✓ 实时同步就绪";
    let saveStatusTimer: any = null;

    async function handleAddNewTagField(tag: string) {
        if (!blockId || !newTagFieldKey.trim()) {
            addingTagFieldFor = null;
            newTagFieldKey = "";
            return;
        }
        const cleanKey = newTagFieldKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
        const attrKey = `custom-${tag}-${cleanKey}`;
        await updateBlockAttributeValue(blockId, attrKey, "");
        addingTagFieldFor = null;
        newTagFieldKey = "";
        await reloadData();
        showMessage(`✓ 已为 #${tag} 挂载专属属性: ${cleanKey}`);
    }

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
            const hasGoverned = (data.supertagGroups.some(g => g.fields.length > 0) || data.avGroups.length > 0);
            if (!hasGoverned && (data.rawCustomFields.length > 0 || data.builtin.name || data.builtin.memo)) {
                activeTab = "base";
            } else {
                activeTab = "governed";
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

    function handleCheckboxToggle(field: SupertagField, e: Event) {
        const target = e.target as HTMLInputElement;
        field.value = target?.checked ? 'true' : 'false';
        handleBlockFieldChange(field.rawKey, field.value);
    }

    function handleAVCheckboxToggle(avId: string, field: AVDatabaseField, itemId: string, e: Event) {
        const target = e.target as HTMLInputElement;
        field.displayValue = target?.checked ? 'true' : 'false';
        handleAVCellChange(avId, field.keyId, itemId, field.displayValue, field.colType);
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
                <span class="meta-block-id" role="button" tabindex="0" title="点击复制 Block ID" on:click={() => copyBlockId()} on:keydown={e => e.key === 'Enter' && copyBlockId()}>
                    ID: {blockId.slice(0, 14)}...
                </span>
                {#if data?.projectionInfo?.isProjected}
                    <span class="meta-proj-badge">⚡ 虚拟投影已就绪</span>
                {/if}
            </div>
        {/if}
    </div>

    <!-- 双 Tab 导航栏 -->
    <div class="dock-tabs">
        <button
            class="tab-btn {activeTab === 'governed' ? 'active' : ''}"
            on:click={() => { activeTab = 'governed'; }}
        >
            🧩 统一结构化属性
        </button>
        <button
            class="tab-btn {activeTab === 'base' ? 'active' : ''}"
            on:click={() => { activeTab = 'base'; }}
        >
            🏷️ 基础与零散属性
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
            <!-- ═══════════ Tab 1: 统一结构化属性 (Governed) ═══════════ -->
            {#if activeTab === 'governed'}
                <div class="governed-container">
                    <!-- A. Supertag 独占命名空间组件卡片 -->
                    {#if data.supertagGroups.length > 0}
                        <div class="section-title">🏷️ Supertag 属性组件</div>
                        {#each data.supertagGroups as group}
                            <div class="group-card">
                                <div class="group-header">
                                    <span class="group-tag-name">#{group.tag}</span>
                                    <span class="group-pill">Supertag 组件</span>
                                </div>

                                <div class="group-fields">
                                    {#if group.fields.length === 0}
                                        <div class="sub-empty-tip">当前标签暂无专属属性字段</div>
                                    {:else}
                                        {#each group.fields as field}
                                            <div class="field-item">
                                                <div class="field-item-header">
                                                    <div class="field-name-block">
                                                        <span class="field-label-text">{field.label}</span>
                                                        <span class="field-scoped-key" title="物理存储键: {field.rawKey}">{field.fullKey}</span>
                                                    </div>
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
                                                                            handleBlockFieldChange(field.rawKey, field.value);
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
                                                            on:change={() => handleBlockFieldChange(field.rawKey, field.value)}
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
                                                            on:change={() => handleBlockFieldChange(field.rawKey, field.value)}
                                                        />
                                                    {:else}
                                                        <textarea
                                                            class="b3-text-field"
                                                            style="font-size: 11px; width: 100%; resize: vertical;"
                                                            rows="2"
                                                            bind:value={field.value}
                                                            on:change={() => handleBlockFieldChange(field.rawKey, field.value)}
                                                            placeholder="输入属性值..."
                                                        ></textarea>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/each}
                                    {/if}
                                    <div class="add-tag-field-wrap">
                                        {#if addingTagFieldFor === group.tag}
                                            <div class="inline-add-field-box">
                                                <input
                                                    type="text"
                                                    class="b3-text-field"
                                                    style="font-size: 11px; height: 22px; flex: 1;"
                                                    placeholder="属性名 (如 cost, due)"
                                                    bind:value={newTagFieldKey}
                                                    on:keydown={e => e.key === 'Enter' && handleAddNewTagField(group.tag)}
                                                />
                                                <button class="b3-button b3-button--primary" style="font-size: 10px; padding: 0 6px;" on:click={() => handleAddNewTagField(group.tag)}>添加</button>
                                                <button class="b3-button b3-button--text" style="font-size: 10px; padding: 0 4px; opacity: 0.6;" on:click={() => { addingTagFieldFor = null; }}>✕</button>
                                            </div>
                                        {:else}
                                            <button class="add-tag-field-btn" on:click={() => { addingTagFieldFor = group.tag; newTagFieldKey = ""; }}>
                                                + 为 #{group.tag} 添加专属属性
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                            </div>
                        {/each}
                    {/if}

                    <!-- B. 所属原生 AV 数据库属性卡片 -->
                    {#if data.avGroups.length > 0}
                        <div class="section-title" style="margin-top: 10px;">⚡ 所属数据库属性</div>
                        {#each data.avGroups as avGroup}
                            <div class="group-card av-card">
                                <div class="group-header">
                                    <div class="av-title-wrap">
                                        <span class="group-av-name">⚡ {avGroup.avName}</span>
                                        {#if avGroup.isDuplicateName}
                                            <span class="dup-warning-badge" title="存在同名数据库，已附加 ID 标识区分">⚠️ 同名库 ({avGroup.avId.slice(0, 4)})</span>
                                        {/if}
                                    </div>
                                    <span class="group-pill" style="color: #059669; border-color: rgba(16,185,129,0.3);">原生 AV</span>
                                </div>

                                <div class="group-fields">
                                    {#each avGroup.fields as avField}
                                        <div class="field-item">
                                            <div class="field-item-header">
                                                <div class="field-name-block">
                                                    <span class="field-label-text">{avField.colName}</span>
                                                    <span class="field-scoped-key">{avGroup.avName}.{avField.colName}</span>
                                                </div>
                                                <div style="display: flex; gap: 4px;">
                                                    {#if avField.isReadonly}
                                                        <span class="readonly-pill">只读计算列</span>
                                                    {/if}
                                                    <span class="field-pill">{avField.colType}</span>
                                                </div>
                                            </div>

                                            <div class="field-control-wrap">
                                                {#if avField.isReadonly}
                                                    <div class="readonly-display-box">{avField.displayValue || '(计算中或空)'}</div>
                                                {:else if avField.colType === 'select' || avField.colType === 'mSelect'}
                                                    <div class="capsules-flow">
                                                        {#if avField.options}
                                                            {#each avField.options as opt}
                                                                {@const c = COLOR_MAP[opt.color] || COLOR_MAP["1"]}
                                                                <button
                                                                    class="capsule-opt {avField.displayValue === opt.name ? 'selected' : ''}"
                                                                    style="background: {avField.displayValue === opt.name ? c.bg : 'var(--b3-theme-background)'}; color: {avField.displayValue === opt.name ? c.text : 'var(--b3-theme-on-background)'}; border-color: {avField.displayValue === opt.name ? c.border : 'var(--b3-border-color)'};"
                                                                    on:click={() => {
                                                                        avField.displayValue = (avField.displayValue === opt.name ? "" : opt.name);
                                                                        handleAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType);
                                                                    }}
                                                                >
                                                                    {opt.name}
                                                                </button>
                                                            {/each}
                                                        {/if}
                                                    </div>
                                                {:else if avField.colType === 'date'}
                                                    <input
                                                        type="date"
                                                        class="b3-text-field"
                                                        style="font-size: 11px; height: 26px; width: 100%;"
                                                        bind:value={avField.displayValue}
                                                        on:change={() => handleAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
                                                    />
                                                {:else if avField.colType === 'checkbox'}
                                                    <label class="switch-row">
                                                        <input
                                                            type="checkbox"
                                                            class="b3-switch"
                                                            checked={avField.displayValue === 'true' || avField.displayValue === '1'}
                                                            on:change={(e) => handleAVCheckboxToggle(avGroup.avId, avField, avGroup.itemId, e)}
                                                        />
                                                        <span style="font-size: 11px;">{avField.displayValue === 'true' ? 'True (开启)' : 'False (关闭)'}</span>
                                                    </label>
                                                {:else if avField.colType === 'number'}
                                                    <input
                                                        type="number"
                                                        class="b3-text-field"
                                                        style="font-size: 11px; height: 26px; width: 100%;"
                                                        bind:value={avField.displayValue}
                                                        on:change={() => handleAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
                                                    />
                                                {:else}
                                                    <textarea
                                                        class="b3-text-field"
                                                        style="font-size: 11px; width: 100%; resize: vertical;"
                                                        rows="2"
                                                        bind:value={avField.displayValue}
                                                        on:change={() => handleAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
                                                        placeholder="输入单元格值..."
                                                    ></textarea>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    {/if}

                    {#if data.supertagGroups.length === 0 && data.avGroups.length === 0}
                        <div class="empty-state">
                            <span>当前块未挂载 Supertag，且未加入任何 AV 数据库</span>
                            <span style="font-size: 11px; opacity: 0.6;">可在上方添加 <b>#task</b> 快速启用结构化组件</span>
                        </div>
                    {/if}
                </div>

            <!-- ═══════════ Tab 2: 基础与零散属性 (Base) ═══════════ -->
            {:else if activeTab === 'base'}
                <div class="base-container">
                    <!-- A. 系统可编辑内置属性 -->
                    <div class="section-title">⚙️ 思源内置属性</div>
                    <div class="builtin-box">
                        <div class="field-item">
                            <span class="field-label-text">🔖 书签 (Bookmark)</span>
                            <input
                                type="text"
                                class="b3-text-field"
                                style="font-size: 11px; width: 100%; margin-top: 2px;"
                                placeholder="书签标记..."
                                bind:value={data.builtin.bookmark}
                                on:change={() => handleBlockFieldChange('bookmark', data?.builtin.bookmark || '')}
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
                                on:change={() => handleBlockFieldChange('name', data?.builtin.name || '')}
                            />
                        </div>

                        <div class="field-item">
                            <span class="field-label-text">🔤 别名 (Alias)</span>
                            <input
                                type="text"
                                class="b3-text-field"
                                style="font-size: 11px; width: 100%; margin-top: 2px;"
                                placeholder="别名 (逗号隔开)..."
                                bind:value={data.builtin.alias}
                                on:change={() => handleBlockFieldChange('alias', data?.builtin.alias || '')}
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
                                on:change={() => handleBlockFieldChange('memo', data?.builtin.memo || '')}
                            ></textarea>
                        </div>
                    </div>

                    <!-- B. 自由自定义属性 -->
                    <div class="section-title" style="margin-top: 10px;">🧩 自由自定义属性 (custom-*)</div>
                    <div class="custom-box">
                        {#if data.rawCustomFields.length === 0}
                            <div class="sub-empty-tip">暂无自由 custom-* 属性</div>
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
                                        on:change={() => handleBlockFieldChange(customItem.rawKey, customItem.value)}
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

                    <!-- C. 只读系统元数据折叠抽屉 -->
                    <div class="meta-drawer-wrap">
                        <button class="meta-toggle-btn" on:click={() => { showSystemMeta = !showSystemMeta; }}>
                            <span>ℹ️ 查看系统底层元数据</span>
                            <span class="toggle-arrow">{showSystemMeta ? '▲ 折叠' : '▼ 展开'}</span>
                        </button>

                        {#if showSystemMeta && data.systemMeta}
                            <div class="meta-content-card">
                                <div class="meta-item-row">
                                    <span class="meta-k">块 ID (id):</span>
                                    <button type="button" class="meta-v-btn click-copy" title="点击复制" on:click={() => copyText(data.systemMeta.id, "块 ID 已复制")}>{data.systemMeta.id} 📋</button>
                                </div>
                                <div class="meta-item-row">
                                    <span class="meta-k">根文档 ID (root_id):</span>
                                    <button type="button" class="meta-v-btn click-copy" title="点击复制" on:click={() => copyText(data.systemMeta.rootId, "文档 ID 已复制")}>{data.systemMeta.rootId} 📋</button>
                                </div>
                                <div class="meta-item-row">
                                    <span class="meta-k">父块 ID (parent_id):</span>
                                    <button type="button" class="meta-v-btn click-copy" title="点击复制" on:click={() => copyText(data.systemMeta.parentId, "父块 ID 已复制")}>{data.systemMeta.parentId} 📋</button>
                                </div>
                                <div class="meta-item-row">
                                    <span class="meta-k">块类型 (type):</span>
                                    <span class="meta-v">{data.systemMeta.type}</span>
                                </div>
                                <div class="meta-item-row">
                                    <span class="meta-k">更新时间 (updated):</span>
                                    <span class="meta-v">{data.systemMeta.updated || '-'}</span>
                                </div>
                                <div class="meta-item-row">
                                    <span class="meta-k">创建时间 (created):</span>
                                    <span class="meta-v">{data.systemMeta.created || '-'}</span>
                                </div>
                                <div class="meta-item-row">
                                    <span class="meta-k">字符长度:</span>
                                    <span class="meta-v">{data.systemMeta.contentLength} 字符</span>
                                </div>
                            </div>
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

    .dock-tabs {
        display: flex;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
        padding: 3px 6px;
        gap: 4px;
    }

    .tab-btn {
        flex: 1;
        background: transparent;
        border: none;
        font-size: 11px;
        font-weight: 600;
        padding: 6px 2px;
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

    .section-title {
        font-size: 11px;
        font-weight: 700;
        color: var(--b3-theme-on-surface-light);
        margin-bottom: 4px;
    }

    .group-card {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 6px;
    }

    .av-card {
        border-left: 3px solid #059669;
    }

    .group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 4px;
        border-bottom: 1px dashed var(--b3-border-color);
    }

    .group-tag-name {
        font-size: 11px;
        font-weight: 700;
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .group-av-name {
        font-size: 11px;
        font-weight: 700;
        color: #059669;
    }

    .av-title-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .dup-warning-badge {
        font-size: 9px;
        background: rgba(245, 158, 11, 0.15);
        color: #D97706;
        padding: 1px 4px;
        border-radius: 3px;
        font-weight: 600;
    }

    .group-pill {
        font-size: 9px;
        background: var(--b3-theme-background);
        padding: 1px 4px;
        border-radius: 3px;
        color: var(--b3-theme-on-surface-light);
        border: 1px solid var(--b3-border-color);
    }

    .readonly-pill {
        font-size: 9px;
        background: rgba(107, 114, 128, 0.12);
        color: #6B7280;
        padding: 1px 4px;
        border-radius: 3px;
    }

    .group-fields {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .field-item {
        background: var(--b3-theme-background);
        padding: 6px 8px;
        border-radius: 4px;
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

    .field-name-block {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .field-label-text {
        font-size: 11px;
        font-weight: 600;
    }

    .field-scoped-key {
        font-size: 9px;
        font-family: monospace;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
    }

    .field-pill {
        font-size: 9px;
        background: var(--b3-theme-surface);
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

    .readonly-display-box {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-surface);
        padding: 4px 6px;
        border-radius: 4px;
        border: 1px dashed var(--b3-border-color);
    }

    .builtin-box, .custom-box {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .custom-row {
        background: var(--b3-theme-surface);
        padding: 6px 8px;
        border-radius: 4px;
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

    .add-tag-field-wrap {
        margin-top: 4px;
    }

    .add-tag-field-btn {
        width: 100%;
        background: transparent;
        border: 1px dashed var(--b3-border-color);
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        padding: 4px 6px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
    }

    .add-tag-field-btn:hover {
        color: var(--indexos-accent-primary, #3B82F6);
        border-color: var(--indexos-accent-primary, #3B82F6);
        background: var(--b3-theme-background);
    }

    .inline-add-field-box {
        display: flex;
        align-items: center;
        gap: 4px;
        background: var(--b3-theme-background);
        padding: 4px;
        border-radius: 4px;
        border: 1px dashed var(--indexos-accent-primary, #3B82F6);
    }

    .meta-drawer-wrap {
        margin-top: 10px;
        border-top: 1px solid var(--b3-border-color);
        padding-top: 8px;
    }

    .meta-toggle-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        color: var(--b3-theme-on-background);
    }

    .toggle-arrow {
        font-size: 10px;
        opacity: 0.6;
    }

    .meta-content-card {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        padding: 8px;
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .meta-item-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
    }

    .meta-k {
        color: var(--b3-theme-on-surface-light);
        font-weight: 500;
    }

    .meta-v {
        font-family: monospace;
        color: var(--b3-theme-on-background);
    }

    .click-copy {
        cursor: pointer;
    }

    .click-copy:hover {
        color: var(--indexos-accent-primary, #3B82F6);
        text-decoration: underline;
    }

    .sub-empty-tip {
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
        text-align: center;
        padding: 6px 0;
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
