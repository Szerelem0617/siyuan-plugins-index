<script lang="ts">
    import type { BlockAttributeData } from "./attribute-model";
    import { updateBlockAttributeValue } from "./attribute-model";
    import { showMessage } from "siyuan";

    export let blockId: string;
    export let data: BlockAttributeData;
    export let onFieldChange: (attrKey: string, attrVal: string) => Promise<void>;
    export let onReload: () => Promise<void>;

    let newCustomKey = "";
    let newCustomVal = "";
    let isAddingCustom = false;

    async function handleAddCustomField() {
        if (!blockId) return;
        const key = newCustomKey.trim();
        const val = newCustomVal.trim();
        if (!key) return;
        const rawKey = ["bookmark", "name", "alias", "memo"].includes(key.toLowerCase())
            ? key.toLowerCase()
            : (key.startsWith("custom-") ? key : `custom-${key}`);
        await updateBlockAttributeValue(blockId, rawKey, val);
        newCustomKey = "";
        newCustomVal = "";
        isAddingCustom = false;
        await onReload();
        showMessage(`✓ 已新增属性: ${key}`);
    }

    async function handleRemoveCustomField(rawKey: string) {
        if (!blockId) return;
        await updateBlockAttributeValue(blockId, rawKey, "");
        await onReload();
    }
    let showSystemMeta = false;

    function copyText(txt: string, tip = "已复制") {
        if (!txt) return;
        navigator.clipboard.writeText(txt).then(() => {
            showMessage(`✓ ${tip}`);
        }).catch(() => {
            showMessage(txt);
        });
    }
</script>

<div class="base-tab-container">
    <!-- 统一基础属性列表 -->
    <div class="section-title">⚙️ 属性列表</div>
    <div class="builtin-box">
        <div class="field-item">
            <span class="field-label-text">🔖 书签 (Bookmark)</span>
            <input
                type="text"
                class="b3-text-field"
                style="font-size: 11px; width: 100%; margin-top: 2px;"
                placeholder="书签标记..."
                bind:value={data.builtin.bookmark}
                on:change={() => onFieldChange('bookmark', data.builtin.bookmark || '')}
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
                on:change={() => onFieldChange('name', data.builtin.name || '')}
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
                on:change={() => onFieldChange('alias', data.builtin.alias || '')}
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
                on:change={() => onFieldChange('memo', data.builtin.memo || '')}
            ></textarea>
        </div>

        <!-- 自定义属性无缝融入属性列表 -->
        {#if data.rawCustomFields && data.rawCustomFields.length > 0}
            {#each data.rawCustomFields as customItem}
                <div class="custom-row" style="margin-top: 6px;">
                    <div class="custom-header">
                        <span class="custom-key-title">🔧 {customItem.key}</span>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button
                                class="b3-button b3-button--text"
                                style="font-size: 10px; padding: 0 4px; opacity: 0.5;"
                                title="删除此属性"
                                on:click={() => handleRemoveCustomField(customItem.rawKey)}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                    <textarea
                        class="b3-text-field"
                        style="font-size: 11px; width: 100%; resize: vertical;"
                        rows="2"
                        bind:value={customItem.value}
                        on:change={() => onFieldChange(customItem.rawKey, customItem.value)}
                        placeholder="属性值..."
                    ></textarea>
                </div>
            {/each}
        {/if}

        <div class="add-custom-wrap" style="margin-top: 8px;">
            {#if isAddingCustom}
                <div class="add-custom-card">
                    <div style="display: flex; gap: 6px;">
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 11px; flex: 1;"
                            placeholder="属性名 (如 weight, cost)"
                            bind:value={newCustomKey}
                        />
                        <input
                            type="text"
                            class="b3-text-field"
                            style="font-size: 11px; flex: 1.5;"
                            placeholder="属性值"
                            bind:value={newCustomVal}
                            on:keydown={e => e.key === 'Enter' && handleAddCustomField()}
                        />
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 4px; margin-top: 6px;">
                        <button class="b3-button b3-button--primary" style="font-size: 11px; padding: 2px 8px;" on:click={handleAddCustomField}>保存</button>
                        <button class="b3-button b3-button--text" style="font-size: 11px; padding: 2px 6px;" on:click={() => { isAddingCustom = false; }}>取消</button>
                    </div>
                </div>
            {:else}
                <button class="add-custom-btn" on:click={() => { isAddingCustom = true; }}>
                    + 新增属性
                </button>
            {/if}
        </div>
    </div>

    <!-- 只读系统属性折叠抽屉 -->
    {#if data.systemMeta}
        <div class="meta-drawer-wrap" style="margin-top: 10px;">
            <button class="meta-toggle-btn" on:click={() => { showSystemMeta = !showSystemMeta; }}>
                <span>ℹ️ 查看只读属性</span>
                <span class="toggle-arrow">{showSystemMeta ? '▲ 折叠' : '▼ 展开'}</span>
            </button>

            {#if showSystemMeta}
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
    {/if}
</div>

<style>
    .meta-drawer-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .meta-toggle-btn {
        background: transparent;
        border: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 6px;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.15s;
    }

    .meta-toggle-btn:hover {
        background: var(--b3-theme-surface);
    }

    .toggle-arrow {
        font-size: 10px;
        opacity: 0.6;
    }

    .meta-content-card {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .meta-item-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
    }

    .meta-k {
        color: var(--b3-theme-on-surface-light);
    }

    .meta-v {
        font-family: monospace;
        color: var(--b3-theme-on-surface);
    }

    .meta-v-btn {
        background: transparent;
        border: none;
        font-family: monospace;
        font-size: 10px;
        color: var(--indexos-accent-primary, #3B82F6);
        cursor: pointer;
        padding: 1px 4px;
        border-radius: 3px;
    }

    .meta-v-btn:hover {
        background: var(--b3-theme-background);
    }

    .base-tab-container {
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

    .builtin-box {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .field-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .field-label-text {
        font-size: 11px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .custom-row {
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .custom-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .custom-key-title {
        font-size: 11px;
        font-weight: 700;
        color: var(--b3-theme-on-background);
    }

    .add-custom-wrap {
        margin-top: 4px;
    }

    .add-custom-btn {
        width: 100%;
        background: transparent;
        border: 1px dashed var(--b3-border-color);
        border-radius: 4px;
        padding: 4px;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        transition: all 0.15s;
    }

    .add-custom-btn:hover {
        border-color: var(--indexos-accent-primary, #3B82F6);
        color: var(--indexos-accent-primary, #3B82F6);
    }

    .add-custom-card {
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        padding: 6px;
    }
</style>
