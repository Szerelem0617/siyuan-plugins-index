<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import {
        loadBlockAttributeData,
        updateBlockAttributeValue,
        updateAVCellAttributeValue,
        toggleSupertagOnBlock,
        type BlockAttributeData,
        type SupertagField,
        type AVDatabaseField
    } from "./attribute-model";
    import { supertagAVProjector } from "../projection/supertag-av-projector";

    export let blockId: string;
    export let dialog: any;
    export let protyle: any = null;

    let loading = true;
    let data: BlockAttributeData | null = null;
    let activeTab: "governed" | "base" = "governed";
    let showSystemMeta = false;

    let newTagInput = "";
    let isAddingTag = false;
    let addingTagFieldFor: string | null = null;
    let newTagFieldKey = "";
    let newCustomKey = "";
    let newCustomVal = "";
    let isAddingCustom = false;
    let saveStatus = "✓ 已自动实时同步";
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

    onMount(async () => {
        await reloadData();
    });

    async function reloadData() {
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

    function copyText(txt: string, tip = "已复制") {
        navigator.clipboard.writeText(txt);
        showMessage(`✓ ${tip}`);
    }

    const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
        "1": { bg: "rgba(59, 130, 246, 0.12)", text: "#2563EB", border: "rgba(59, 130, 246, 0.3)" },
        "2": { bg: "rgba(16, 185, 129, 0.12)", text: "#059669", border: "rgba(16, 185, 129, 0.3)" },
        "3": { bg: "rgba(245, 158, 11, 0.12)", text: "#D97706", border: "rgba(245, 158, 11, 0.3)" },
        "4": { bg: "rgba(239, 68, 68, 0.12)", text: "#DC2626", border: "rgba(239, 68, 68, 0.3)" },
        "5": { bg: "rgba(139, 92, 246, 0.12)", text: "#7C3AED", border: "rgba(139, 92, 246, 0.3)" },
        "6": { bg: "rgba(236, 72, 153, 0.12)", text: "#DB2777", border: "rgba(236, 72, 153, 0.3)" },
        "7": { bg: "rgba(20, 184, 166, 0.12)", text: "#0D9488", border: "rgba(20, 184, 166, 0.3)" },
        "8": { bg: "rgba(107, 114, 128, 0.12)", text: "#4B5563", border: "rgba(107, 114, 128, 0.3)" }
    };
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

    <!-- 双 Tab 导航栏 -->
    <div class="inspector-tabs">
        <button
            class="tab-item {activeTab === 'governed' ? 'active' : ''}"
            on:click={() => { activeTab = 'governed'; }}
        >
            🧩 统一结构化属性
        </button>
        <button
            class="tab-item {activeTab === 'base' ? 'active' : ''}"
            on:click={() => { activeTab = 'base'; }}
        >
            🏷️ 基础与零散属性
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
            <!-- ═══════════ Tab 1: 结构化属性 (Governed) ═══════════ -->
            {#if activeTab === 'governed'}
                <div class="governed-list">
                    <!-- A. Supertag 独占命名空间组件 -->
                    {#if data.supertagGroups.length > 0}
                        <div class="sub-header">🏷️ Supertag 属性组件</div>
                        {#each data.supertagGroups as group}
                            <div class="group-box">
                                <div class="group-box-header">
                                    <span class="group-title">#{group.tag}</span>
                                    <span class="group-tag-pill">Supertag 组件</span>
                                </div>

                                <div class="field-list">
                                    {#if group.fields.length === 0}
                                        <div class="empty-tip">当前标签暂无专属属性字段</div>
                                    {:else}
                                        {#each group.fields as field}
                                            <div class="field-card">
                                                <div class="field-header">
                                                    <div class="field-name-wrap">
                                                        <span class="field-label">{field.label}</span>
                                                        <span class="field-key-raw" title="物理键名: {field.rawKey}">{field.fullKey}</span>
                                                    </div>
                                                    <span class="field-type-pill">{field.type}</span>
                                                </div>

                                                <div class="field-control">
                                                    {#if field.type === 'select'}
                                                        <div class="capsule-options">
                                                            {#if field.options}
                                                                {#each field.options as opt}
                                                                    {@const colorInfo = COLOR_MAP[opt.color] || COLOR_MAP["1"]}
                                                                    <button
                                                                        class="capsule-btn {field.value === opt.name ? 'selected' : ''}"
                                                                        style="background: {field.value === opt.name ? colorInfo.bg : 'var(--b3-theme-background)'}; color: {field.value === opt.name ? colorInfo.text : 'var(--b3-theme-on-background)'}; border-color: {field.value === opt.name ? colorInfo.border : 'var(--b3-border-color)'};"
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
                                                            style="font-size: 12px; height: 30px; width: 100%; max-width: 220px;"
                                                            bind:value={field.value}
                                                            on:change={() => handleBlockFieldChange(field.rawKey, field.value)}
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
                                                            on:change={() => handleBlockFieldChange(field.rawKey, field.value)}
                                                        />
                                                    {:else}
                                                        <textarea
                                                            class="b3-text-field"
                                                            style="font-size: 12px; width: 100%; resize: vertical;"
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
                                                    style="font-size: 11px; height: 24px; flex: 1;"
                                                    placeholder="属性名 (如 cost, priority)"
                                                    bind:value={newTagFieldKey}
                                                    on:keydown={e => e.key === 'Enter' && handleAddNewTagField(group.tag)}
                                                />
                                                <button class="b3-button b3-button--primary" style="font-size: 11px; padding: 2px 8px;" on:click={() => handleAddNewTagField(group.tag)}>添加</button>
                                                <button class="b3-button b3-button--text" style="font-size: 11px; padding: 2px 6px; opacity: 0.6;" on:click={() => { addingTagFieldFor = null; }}>✕</button>
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

                    <!-- B. 所属原生 AV 数据库属性 -->
                    {#if data.avGroups.length > 0}
                        <div class="sub-header" style="margin-top: 14px;">⚡ 所属数据库属性</div>
                        {#each data.avGroups as avGroup}
                            <div class="group-box av-border">
                                <div class="group-box-header">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span class="group-title" style="color: #059669;">⚡ {avGroup.avName}</span>
                                        {#if avGroup.isDuplicateName}
                                            <span class="dup-badge" title="存在同名数据库，已附加 ID 标识区分">⚠️ 同名库 ({avGroup.avId.slice(0, 4)})</span>
                                        {/if}
                                    </div>
                                    <span class="group-tag-pill" style="color: #059669; border-color: rgba(16,185,129,0.3);">原生 AV</span>
                                </div>

                                <div class="field-list">
                                    {#each avGroup.fields as avField}
                                        <div class="field-card">
                                            <div class="field-header">
                                                <div class="field-name-wrap">
                                                    <span class="field-label">{avField.colName}</span>
                                                    <span class="field-key-raw">{avGroup.avName}.{avField.colName}</span>
                                                </div>
                                                <div style="display: flex; gap: 4px;">
                                                    {#if avField.isReadonly}
                                                        <span class="readonly-pill">只读计算列</span>
                                                    {/if}
                                                    <span class="field-type-pill">{avField.colType}</span>
                                                </div>
                                            </div>

                                            <div class="field-control">
                                                {#if avField.isReadonly}
                                                    <div class="readonly-box">{avField.displayValue || '(计算中或空)'}</div>
                                                {:else if avField.colType === 'select' || avField.colType === 'mSelect'}
                                                    <div class="capsule-options">
                                                        {#if avField.options}
                                                            {#each avField.options as opt}
                                                                {@const colorInfo = COLOR_MAP[opt.color] || COLOR_MAP["1"]}
                                                                <button
                                                                    class="capsule-btn {avField.displayValue === opt.name ? 'selected' : ''}"
                                                                    style="background: {avField.displayValue === opt.name ? colorInfo.bg : 'var(--b3-theme-background)'}; color: {avField.displayValue === opt.name ? colorInfo.text : 'var(--b3-theme-on-background)'}; border-color: {avField.displayValue === opt.name ? colorInfo.border : 'var(--b3-border-color)'};"
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
                                                        style="font-size: 12px; height: 30px; width: 100%; max-width: 220px;"
                                                        bind:value={avField.displayValue}
                                                        on:change={() => handleAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
                                                    />
                                                {:else if avField.colType === 'checkbox'}
                                                    <label class="switch-wrap">
                                                        <input
                                                            type="checkbox"
                                                            class="b3-switch"
                                                            checked={avField.displayValue === 'true' || avField.displayValue === '1'}
                                                            on:change={(e) => handleAVCheckboxToggle(avGroup.avId, avField, avGroup.itemId, e)}
                                                        />
                                                        <span style="font-size: 12px; font-weight: 500;">{avField.displayValue === 'true' ? '已启用 (True)' : '已关闭 (False)'}</span>
                                                    </label>
                                                {:else if avField.colType === 'number'}
                                                    <input
                                                        type="number"
                                                        class="b3-text-field"
                                                        style="font-size: 12px; height: 30px; width: 140px;"
                                                        bind:value={avField.displayValue}
                                                        on:change={() => handleAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
                                                    />
                                                {:else}
                                                    <textarea
                                                        class="b3-text-field"
                                                        style="font-size: 12px; width: 100%; resize: vertical;"
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
                        <div class="empty-field-state">
                            <span>当前块未绑定 Supertag，且未加入任何 AV 数据库</span>
                            <span style="font-size: 11px; opacity: 0.7;">可在上方添加如 <b>#task</b> 等标签快速启用类型化字段</span>
                        </div>
                    {/if}
                </div>

            <!-- ═══════════ Tab 2: 基础与零散属性 (Base) ═══════════ -->
            {:else if activeTab === 'base'}
                <div class="base-list">
                    <!-- A. 系统内置属性 -->
                    <div class="sub-header">⚙️ 思源内置属性</div>
                    <div class="builtin-card-group">
                        <div class="field-card">
                            <span class="field-label">🔖 书签 (Bookmark)</span>
                            <input
                                type="text"
                                class="b3-text-field"
                                style="font-size: 12px; width: 100%; margin-top: 4px;"
                                placeholder="书签标记..."
                                bind:value={data.builtin.bookmark}
                                on:change={() => handleBlockFieldChange('bookmark', data?.builtin.bookmark || '')}
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
                                on:change={() => handleBlockFieldChange('name', data?.builtin.name || '')}
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
                                on:change={() => handleBlockFieldChange('alias', data?.builtin.alias || '')}
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
                                on:change={() => handleBlockFieldChange('memo', data?.builtin.memo || '')}
                            ></textarea>
                        </div>
                    </div>

                    <!-- B. 自由自定义属性 -->
                    <div class="sub-header" style="margin-top: 14px;">🧩 自由自定义属性 (custom-*)</div>
                    <div class="custom-card-group">
                        {#if data.rawCustomFields.length === 0}
                            <div class="empty-tip">暂无自由 custom-* 自定义属性</div>
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
                                            on:change={() => handleBlockFieldChange(customItem.rawKey, customItem.value)}
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

                    <!-- C. 系统元数据折叠抽屉 -->
                    <div class="meta-drawer">
                        <button class="meta-toggle-btn" on:click={() => { showSystemMeta = !showSystemMeta; }}>
                            <span>ℹ️ 查看系统底层元数据 (只读)</span>
                            <span style="font-size: 11px; opacity: 0.6;">{showSystemMeta ? '▲ 折叠' : '▼ 展开'}</span>
                        </button>

                        {#if showSystemMeta && data.systemMeta}
                            <div class="meta-table">
                                <div class="meta-row">
                                    <span class="meta-k">块 ID (id):</span>
                                    <button type="button" class="meta-v-btn copyable" title="点击复制" on:click={() => copyText(data.systemMeta.id, "块 ID 已复制")}>{data.systemMeta.id} 📋</button>
                                </div>
                                <div class="meta-row">
                                    <span class="meta-k">文档根 ID (root_id):</span>
                                    <button type="button" class="meta-v-btn copyable" title="点击复制" on:click={() => copyText(data.systemMeta.rootId, "文档 ID 已复制")}>{data.systemMeta.rootId} 📋</button>
                                </div>
                                <div class="meta-row">
                                    <span class="meta-k">父块 ID (parent_id):</span>
                                    <button type="button" class="meta-v-btn copyable" title="点击复制" on:click={() => copyText(data.systemMeta.parentId, "父块 ID 已复制")}>{data.systemMeta.parentId} 📋</button>
                                </div>
                                <div class="meta-row">
                                    <span class="meta-k">块类型 (type):</span>
                                    <span class="meta-v">{data.systemMeta.type}</span>
                                </div>
                                <div class="meta-row">
                                    <span class="meta-k">更新时间 (updated):</span>
                                    <span class="meta-v">{data.systemMeta.updated || '-'}</span>
                                </div>
                                <div class="meta-row">
                                    <span class="meta-k">创建时间 (created):</span>
                                    <span class="meta-v">{data.systemMeta.created || '-'}</span>
                                </div>
                                <div class="meta-row">
                                    <span class="meta-k">内容字符数:</span>
                                    <span class="meta-v">{data.systemMeta.contentLength} 字符</span>
                                </div>
                            </div>
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

    .sub-header {
        font-size: 12px;
        font-weight: 700;
        color: var(--b3-theme-on-surface-light);
        margin-bottom: 6px;
    }

    .group-box {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 8px;
    }

    .av-border {
        border-left: 4px solid #059669;
    }

    .group-box-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 6px;
        border-bottom: 1px dashed var(--b3-border-color);
    }

    .group-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .dup-badge {
        font-size: 10px;
        background: rgba(245, 158, 11, 0.15);
        color: #D97706;
        padding: 1px 5px;
        border-radius: 3px;
        font-weight: 600;
    }

    .group-tag-pill {
        font-size: 10px;
        background: var(--b3-theme-background);
        padding: 1px 6px;
        border-radius: 4px;
        color: var(--b3-theme-on-surface-light);
        border: 1px solid var(--b3-border-color);
    }

    .readonly-pill {
        font-size: 10px;
        background: rgba(107, 114, 128, 0.12);
        color: #6B7280;
        padding: 1px 5px;
        border-radius: 3px;
    }

    .field-list, .builtin-card-group, .custom-card-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .field-card {
        background: var(--b3-theme-background);
        padding: 8px 10px;
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
        background: var(--b3-theme-surface);
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

    .readonly-box {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-surface);
        padding: 6px 8px;
        border-radius: 4px;
        border: 1px dashed var(--b3-border-color);
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
        width: 160px;
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

    .add-tag-field-wrap {
        margin-top: 4px;
    }

    .add-tag-field-btn {
        width: 100%;
        background: transparent;
        border: 1px dashed var(--b3-border-color);
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        padding: 5px 8px;
        border-radius: 6px;
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
        gap: 6px;
        background: var(--b3-theme-background);
        padding: 6px;
        border-radius: 6px;
        border: 1px dashed var(--indexos-accent-primary, #3B82F6);
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

    .meta-drawer {
        border-top: 1px solid var(--b3-border-color);
        padding-top: 10px;
        margin-top: 8px;
    }

    .meta-toggle-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        color: var(--b3-theme-on-background);
    }

    .meta-table {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 8px 10px;
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .meta-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
    }

    .meta-k {
        color: var(--b3-theme-on-surface-light);
        font-weight: 500;
    }

    .meta-v {
        font-family: monospace;
        color: var(--b3-theme-on-background);
    }

    .meta-v-btn {
        background: transparent;
        border: none;
        padding: 0;
        font-family: monospace;
        font-size: 11px;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        text-align: left;
    }

    .copyable {
        cursor: pointer;
    }

    .copyable:hover {
        color: var(--indexos-accent-primary, #3B82F6);
        text-decoration: underline;
    }

    .empty-tip {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
        text-align: center;
        padding: 8px 0;
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
