<script lang="ts">
    import type { BlockAttributeData, SupertagField, AVDatabaseField } from "./attribute-model";
    import { updateBlockAttributeValue } from "./attribute-model";
    import { showMessage } from "siyuan";

    export let blockId: string;
    export let data: BlockAttributeData;
    export let onBlockFieldChange: (attrKey: string, attrVal: string) => Promise<void>;
    export let onAVCellChange: (avId: string, keyId: string, itemId: string, value: any, colType: string) => Promise<void>;
    export let onReload: () => Promise<void>;

    let addingTagFieldFor: string | null = null;
    let newTagFieldKey = "";

    let collapsedTagGroups = new Set<string>();
    let collapsedAvGroups = new Set<string>();

    function toggleTagGroupCollapse(tag: string) {
        if (collapsedTagGroups.has(tag)) {
            collapsedTagGroups.delete(tag);
        } else {
            collapsedTagGroups.add(tag);
        }
        collapsedTagGroups = new Set(collapsedTagGroups);
    }

    function toggleAvGroupCollapse(avId: string) {
        if (collapsedAvGroups.has(avId)) {
            collapsedAvGroups.delete(avId);
        } else {
            collapsedAvGroups.add(avId);
        }
        collapsedAvGroups = new Set(collapsedAvGroups);
    }

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
        await onReload();
        showMessage(`✓ 已为 #${tag} 挂载专属属性: ${cleanKey}`);
    }

    function handleCheckboxToggle(field: SupertagField, e: Event) {
        const target = e.target as HTMLInputElement;
        field.value = target?.checked ? 'true' : 'false';
        onBlockFieldChange(field.rawKey, field.value);
    }

    function handleAVCheckboxToggle(avId: string, field: AVDatabaseField, itemId: string, e: Event) {
        const target = e.target as HTMLInputElement;
        field.displayValue = target?.checked ? 'true' : 'false';
        onAVCellChange(avId, field.keyId, itemId, field.displayValue, field.colType);
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

<div class="governed-tab-container">
    <!-- A. Supertag 独占命名空间组件卡片 -->
    {#if data.supertagGroups.length > 0}
        <div class="section-title">🏷️ Supertag 属性组件</div>
        {#each data.supertagGroups as group}
            {@const isCollapsed = collapsedTagGroups.has(group.tag)}
            <div class="group-card">
                <div
                    class="group-header group-header--clickable"
                    role="button"
                    tabindex="0"
                    on:click={() => toggleTagGroupCollapse(group.tag)}
                    on:keydown={e => (e.key === 'Enter' || e.key === ' ') && toggleTagGroupCollapse(group.tag)}
                >
                    <div class="group-header-left">
                        <svg class="collapse-icon {isCollapsed ? 'collapsed' : ''}" style="width: 10px; height: 10px; fill: currentColor;"><use xlink:href="#iconDown"></use></svg>
                        <span class="group-tag-name">#{group.tag}</span>
                        <span class="group-count-badge">{group.fields.length} 属性</span>
                    </div>
                    {#if group.boundAvName}
                        <span class="group-pill" style="background: rgba(16, 185, 129, 0.12); color: #059669; border-color: rgba(16, 185, 129, 0.3);" title="已关联数据库: {group.boundAvName}">⚡ 关联库: {group.boundAvName}</span>
                    {:else}
                        <span class="group-pill">Supertag 组件</span>
                    {/if}
                </div>

                {#if !isCollapsed}
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
                                        {#if field.type === 'select' || field.type === 'mSelect'}
                                            <div class="capsules-flow">
                                                {#if field.options && field.options.length > 0}
                                                    {#each field.options as opt}
                                                        {@const c = COLOR_MAP[opt.color] || COLOR_MAP["1"]}
                                                        {@const isSelected = field.type === 'mSelect'
                                                            ? (field.value || "").split(/[,;\s]+/).includes(opt.name)
                                                            : field.value === opt.name}
                                                        <button
                                                            class="capsule-opt {isSelected ? 'selected' : ''}"
                                                            style="background: {isSelected ? c.bg : 'var(--b3-theme-background)'}; color: {isSelected ? c.text : 'var(--b3-theme-on-background)'}; border-color: {isSelected ? c.border : 'var(--b3-border-color)'};"
                                                            on:click={() => {
                                                                if (field.type === 'mSelect') {
                                                                    const currentList = (field.value || "").split(/[,;\s]+/).filter(Boolean);
                                                                    const nextList = currentList.includes(opt.name)
                                                                        ? currentList.filter(x => x !== opt.name)
                                                                        : [...currentList, opt.name];
                                                                    field.value = nextList.join(", ");
                                                                } else {
                                                                    field.value = (field.value === opt.name ? "" : opt.name);
                                                                }
                                                                onBlockFieldChange(field.rawKey, field.value);
                                                            }}
                                                        >
                                                            {opt.name}
                                                        </button>
                                                    {/each}
                                                {:else}
                                                    <input
                                                        type="text"
                                                        class="b3-text-field"
                                                        style="font-size: 11px; height: 26px; width: 100%;"
                                                        placeholder="输入选项值..."
                                                        bind:value={field.value}
                                                        on:change={() => onBlockFieldChange(field.rawKey, field.value)}
                                                    />
                                                {/if}
                                            </div>
                                        {:else if field.type === 'date'}
                                            <input
                                                type="date"
                                                class="b3-text-field"
                                                style="font-size: 11px; height: 26px; width: 100%;"
                                                bind:value={field.value}
                                                on:change={() => onBlockFieldChange(field.rawKey, field.value)}
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
                                                on:change={() => onBlockFieldChange(field.rawKey, field.value)}
                                            />
                                        {:else}
                                            <textarea
                                                class="b3-text-field"
                                                style="font-size: 11px; width: 100%; resize: vertical;"
                                                rows="2"
                                                bind:value={field.value}
                                                on:change={() => onBlockFieldChange(field.rawKey, field.value)}
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
                {/if}
            </div>
        {/each}
    {/if}

    <!-- B. 所属原生 AV 数据库属性卡片 -->
    {#if data.avGroups.length > 0}
        <div class="section-title" style="margin-top: 10px;">⚡ 所属数据库属性</div>
        {#each data.avGroups as avGroup}
            {@const isCollapsed = collapsedAvGroups.has(avGroup.avId)}
            <div class="group-card av-card">
                <div
                    class="group-header group-header--clickable"
                    role="button"
                    tabindex="0"
                    on:click={() => toggleAvGroupCollapse(avGroup.avId)}
                    on:keydown={e => (e.key === 'Enter' || e.key === ' ') && toggleAvGroupCollapse(avGroup.avId)}
                >
                    <div class="group-header-left">
                        <svg class="collapse-icon {isCollapsed ? 'collapsed' : ''}" style="width: 10px; height: 10px; fill: currentColor;"><use xlink:href="#iconDown"></use></svg>
                        <div class="av-title-wrap">
                            <span class="group-av-name">⚡ {avGroup.avName}</span>
                            {#if avGroup.isDuplicateName}
                                <span class="dup-warning-badge" title="存在同名数据库，已附加 ID 标识区分">⚠️ 同名库 ({avGroup.avId.slice(0, 4)})</span>
                            {/if}
                        </div>
                        <span class="group-count-badge">{avGroup.fields.length} 字段</span>
                    </div>
                    <span class="group-pill" style="color: #059669; border-color: rgba(16,185,129,0.3);">原生 AV</span>
                </div>

                {#if !isCollapsed}
                    <div class="group-fields">
                        {#if avGroup.fields.length === 0}
                            <div class="sub-empty-tip">该数据库暂无其他属性列</div>
                        {:else}
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
                                                                onAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType);
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
                                                on:change={() => onAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
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
                                                on:change={() => onAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
                                            />
                                        {:else}
                                            <textarea
                                                class="b3-text-field"
                                                style="font-size: 11px; width: 100%; resize: vertical;"
                                                rows="2"
                                                bind:value={avField.displayValue}
                                                on:change={() => onAVCellChange(avGroup.avId, avField.keyId, avGroup.itemId, avField.displayValue, avField.colType)}
                                                placeholder="输入单元格值..."
                                            ></textarea>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        {/each}
    {/if}

    {#if data.supertagGroups.length === 0 && data.avGroups.length === 0}
        <div class="empty-state">
            <span>当前块未挂载 Supertag，且未加入任何 AV 数据库</span>
            <span style="font-size: 11px; opacity: 0.6;">可在编辑器中添加 <b>#task</b> 等标签快速启用结构化组件</span>
        </div>
    {/if}
</div>

<style>
    .governed-tab-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
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

    .group-header--clickable {
        cursor: pointer;
        user-select: none;
        padding: 4px 6px;
        margin: -4px -4px 2px -4px;
        border-radius: 4px;
        transition: background 0.15s;
    }

    .group-header--clickable:hover {
        background: var(--b3-theme-background-hover, rgba(0, 0, 0, 0.04));
    }

    .group-header-left {
        display: flex;
        align-items: center;
        gap: 6px;
        overflow: hidden;
    }

    .collapse-icon {
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-light);
        transition: transform 0.2s ease;
    }

    .collapse-icon.collapsed {
        transform: rotate(-90deg);
    }

    .group-count-badge {
        font-size: 10px;
        opacity: 0.65;
        font-family: ui-monospace, monospace;
        background: var(--b3-theme-background);
        padding: 1px 5px;
        border-radius: 8px;
        border: 1px solid var(--b3-border-color);
        flex-shrink: 0;
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

    .group-fields {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .sub-empty-tip {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
        text-align: center;
        padding: 8px 0;
    }

    .field-item {
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        padding: 6px;
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
        overflow: hidden;
    }

    .field-label-text {
        font-size: 11px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .field-scoped-key {
        font-size: 9px;
        font-family: monospace;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
    }

    .readonly-pill {
        font-size: 9px;
        background: rgba(107, 114, 128, 0.12);
        color: #6B7280;
        padding: 1px 4px;
        border-radius: 3px;
    }

    .field-pill {
        font-size: 9px;
        background: var(--b3-theme-surface);
        padding: 1px 4px;
        border-radius: 3px;
        color: var(--b3-theme-on-surface-light);
        border: 1px solid var(--b3-border-color);
    }

    .field-control-wrap {
        width: 100%;
    }

    .capsules-flow {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .capsule-opt {
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 10px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s;
    }

    .capsule-opt.selected {
        font-weight: 700;
        box-shadow: 0 0 0 1px currentColor;
    }

    .switch-row {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
    }

    .readonly-display-box {
        font-size: 11px;
        padding: 4px 6px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        color: var(--b3-theme-on-surface-light);
        font-style: italic;
    }

    .add-tag-field-wrap {
        margin-top: 4px;
    }

    .add-tag-field-btn {
        width: 100%;
        background: transparent;
        border: 1px dashed var(--b3-border-color);
        border-radius: 4px;
        padding: 3px;
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        transition: all 0.15s;
    }

    .add-tag-field-btn:hover {
        border-color: var(--indexos-accent-primary, #3B82F6);
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .inline-add-field-box {
        display: flex;
        gap: 4px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        padding: 4px;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px 12px;
        gap: 6px;
        color: var(--b3-theme-on-surface-light);
        text-align: center;
        font-size: 12px;
    }
</style>
