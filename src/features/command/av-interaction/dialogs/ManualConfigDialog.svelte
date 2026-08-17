<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { commandRegistry } from "../../registry/command-registry";
    import { parseManualConfig, serializeManualConfig, type ManualConfig, type ManualCommandEntry, createDefaultManualEntry } from "../../utils/manual-config";
    import { PRESET_CONDITIONS } from "../../supertag/core/block-filter";

    export let dialog: Dialog;
    export let supertag: string = "";
    export let availableCommands: { id: string; name: string; description?: string; params?: any[] }[] = [];
    export let currentVal: string = "";
    export let onSave: (updatedVal: string) => Promise<void>;

    let entries: ManualConfig = parseManualConfig(currentVal || "");
    let searchQuery = "";
    let expandedCmdId: string | null = null;
    let saving = false;

    // 获取全量命令注册表
    $: allCommands = (availableCommands && availableCommands.length > 0)
        ? availableCommands
        : commandRegistry.getAllCommands().map(c => ({
            id: c.id,
            name: c.name,
            description: c.description || "",
            params: c.params || []
        })).sort((a, b) => a.name.localeCompare(b.name, "zh"));

    // 过滤命令列表
    $: visibleCommands = allCommands.filter(cmd => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return cmd.name.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q);
    });

    // 辅助判定勾选
    function isChecked(cmdId: string): boolean {
        return entries.some(e => e.id === cmdId);
    }

    function getEntry(cmdId: string): ManualCommandEntry | undefined {
        return entries.find(e => e.id === cmdId);
    }

    // 切换勾选状态
    function toggleCommand(cmdId: string) {
        if (isChecked(cmdId)) {
            entries = entries.filter(e => e.id !== cmdId);
            if (expandedCmdId === cmdId) {
                expandedCmdId = null;
            }
        } else {
            // 默认配置：;; 面板和 Icon Menu 开启，Button 与 Virtual Button 关闭
            const newEntry = createDefaultManualEntry(cmdId);
            entries = [...entries, newEntry];
            expandedCmdId = cmdId; // 勾选后自动展开设置
        }
    }

    function toggleExpand(cmdId: string) {
        if (!isChecked(cmdId)) {
            toggleCommand(cmdId);
            expandedCmdId = cmdId;
        } else {
            expandedCmdId = expandedCmdId === cmdId ? null : cmdId;
        }
    }

    function updateEntry(cmdId: string, updater: (entry: ManualCommandEntry) => Partial<ManualCommandEntry>) {
        entries = entries.map(e => {
            if (e.id === cmdId) {
                return { ...e, ...updater(e) };
            }
            return e;
        });
    }

    function setParam(cmdId: string, paramKey: string, val: string) {
        const entry = getEntry(cmdId);
        if (!entry) return;
        const currentParams = { ...(entry.params || {}) };
        if (val === "") {
            delete currentParams[paramKey];
        } else {
            currentParams[paramKey] = val;
        }
        updateEntry(cmdId, () => ({
            params: Object.keys(currentParams).length > 0 ? currentParams : undefined
        }));
    }

    function insertPlaceholder(cmdId: string, paramKey: string, placeholder: string) {
        const entry = getEntry(cmdId);
        if (!entry) return;
        const cur = entry.params?.[paramKey] || "";
        setParam(cmdId, paramKey, cur ? `${cur} ${placeholder}` : placeholder);
    }

    function appendCondition(cmdId: string, expr: string) {
        const entry = getEntry(cmdId);
        if (!entry) return;
        const cur = entry.condition || entry.blockFilter || "";
        const next = cur ? `${cur} && ${expr}` : expr;
        updateEntry(cmdId, () => ({ condition: next, blockFilter: next }));
    }

    async function handleSave() {
        try {
            saving = true;
            const jsonStr = serializeManualConfig(entries);
            await onSave(jsonStr);
            dialog.destroy();
        } catch (err: any) {
            showMessage(`保存失败: ${err?.message || err}`, 3000, "error");
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; min-height: 0; padding: 16px; box-sizing: border-box; gap: 12px; overflow: hidden;">
    <!-- 头部：标题与已勾选计数 -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; gap: 6px;">
            <span>🏷️</span>
            <span>配置 Supertag <span style="color: var(--indexos-accent-primary);">#{supertag}</span> 手动命令 (Manual)</span>
        </div>
        <span class="indexos-tag-badge" style="font-size: 11px;">
            已启用 {entries.length} 个命令
        </span>
    </div>

    <!-- 搜索筛选栏 -->
    <div style="position: relative; flex-shrink: 0;">
        <input
            type="text"
            class="b3-text-field fn__block"
            style="font-size: 12px; padding: 6px 12px 6px 30px; box-sizing: border-box;"
            placeholder="搜索全量命令 (如 插入块 / 更新属性 / 复合命令)..."
            bind:value={searchQuery}
        />
        <svg style="position: absolute; left: 9px; top: 8px; width: 14px; height: 14px; opacity: 0.5; pointer-events: none;"><use xlink:href="#iconSearch"></use></svg>
    </div>

    <!-- 主体：紧凑单列表 + 渐进式展开设置 (确保独立纵向滚动条) -->
    <div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
        {#if visibleCommands.length === 0}
            <div style="text-align: center; color: var(--indexos-text-muted); font-size: 12px; padding: 32px 0;">
                未找到匹配的命令
            </div>
        {:else}
            {#each visibleCommands as cmd (cmd.id)}
                {@const checked = isChecked(cmd.id)}
                {@const entry = getEntry(cmd.id)}
                {@const isExpanded = expandedCmdId === cmd.id && checked}
                {@const fullDef = commandRegistry.getCommand(cmd.id)}
                {@const paramSchemas = fullDef?.params || cmd.params || []}

                <div style="flex-shrink: 0; border: 1px solid {checked ? 'var(--indexos-accent-primary)' : 'var(--indexos-border-light)'}; border-radius: 6px; background: {checked ? 'rgba(40, 81, 127, 0.03)' : 'var(--indexos-bg-card)'}; transition: all 0.15s ease; overflow: hidden;">
                    <!-- 顶层简要行 -->
                    <div
                        role="button"
                        tabindex="0"
                        style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; min-height: 40px; box-sizing: border-box; cursor: pointer; user-select: none;"
                        on:click={() => toggleExpand(cmd.id)}
                        on:keydown={e => { if (e.key === 'Enter') toggleExpand(cmd.id); }}
                    >
                        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                            <input
                                type="checkbox"
                                checked={checked}
                                on:click|stopPropagation={() => toggleCommand(cmd.id)}
                                style="cursor: pointer; width: 15px; height: 15px; flex-shrink: 0;"
                            />
                            <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="font-size: 13px; font-weight: {checked ? '600' : 'normal'}; color: var(--indexos-text-main);">
                                        {cmd.name}
                                    </span>

                                    <!-- 4 态生效指示微标 (仅勾选后显示) -->
                                    {#if checked && entry}
                                        <div style="display: flex; gap: 4px; align-items: center;">
                                            {#if entry.showInSlash}
                                                <span class="indexos-tag-badge" style="font-size: 9px; padding: 0 4px;" title=";;快捷面板生效">⌨️ ;;</span>
                                            {/if}
                                            {#if entry.showInMenu}
                                                <span class="indexos-tag-badge" style="font-size: 9px; padding: 0 4px;" title="Icon Menu菜单生效">📋 菜单</span>
                                            {/if}
                                            {#if entry.showInButton}
                                                <span class="indexos-tag-badge" style="font-size: 9px; padding: 0 4px;" title="块实体按钮生效">🧱 实体按钮</span>
                                            {/if}
                                            {#if entry.showInVirtualButton}
                                                <span class="indexos-tag-badge" style="font-size: 9px; padding: 0 4px; background: rgba(124,58,237,0.1); color: #7c3aed; border-color: rgba(124,58,237,0.3);" title="虚拟悬浮按钮生效">👻 虚拟按钮</span>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                                <span style="font-family: monospace; font-size: 10px; color: var(--indexos-text-muted); opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    {cmd.id}
                                </span>
                            </div>
                        </div>

                        <!-- 齿轮设置/展开折叠切换 -->
                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            {#if checked}
                                <button
                                    type="button"
                                    class="b3-button b3-button--text"
                                    style="font-size: 11px; padding: 2px 8px; color: {isExpanded ? 'var(--indexos-accent-primary)' : 'var(--indexos-text-muted)'}; display: inline-flex; align-items: center; gap: 4px;"
                                    on:click|stopPropagation={() => toggleExpand(cmd.id)}
                                >
                                    <span>⚙️ {isExpanded ? '收起配置' : '配置'}</span>
                                </button>
                            {/if}
                        </div>
                    </div>

                    <!-- 展开的渐进式设置抽屉 (仅在点击配置时呈现) -->
                    {#if isExpanded && entry}
                        <div style="padding: 12px; background: var(--indexos-bg-container); border-top: 1px dashed var(--indexos-border-divider); display: flex; flex-direction: column; gap: 12px;">
                            <!-- 1. 暴露形态设置 -->
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
                                    🎯 在何处展示 (暴露形态)
                                </div>

                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">
                                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                                        <input
                                            type="checkbox"
                                            checked={entry.showInSlash}
                                            on:change={e => updateEntry(cmd.id, () => ({ showInSlash: e.currentTarget.checked }))}
                                        />
                                        <span>⌨️ <b>;; 快捷命令面板</b></span>
                                    </label>

                                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                                        <input
                                            type="checkbox"
                                            checked={entry.showInMenu}
                                            on:change={e => updateEntry(cmd.id, () => ({ showInMenu: e.currentTarget.checked }))}
                                        />
                                        <span>📋 <b>Icon Menu 菜单栏</b></span>
                                    </label>

                                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                                        <input
                                            type="checkbox"
                                            checked={entry.showInButton}
                                            on:change={e => updateEntry(cmd.id, () => ({ showInButton: e.currentTarget.checked }))}
                                        />
                                        <span>🧱 <b>块下方实体按钮</b></span>
                                    </label>

                                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                                        <input
                                            type="checkbox"
                                            checked={entry.showInVirtualButton}
                                            on:change={e => updateEntry(cmd.id, () => ({ showInVirtualButton: e.currentTarget.checked }))}
                                        />
                                        <span>👻 <b>虚拟悬浮按钮</b></span>
                                    </label>
                                </div>

                                <!-- 实体按钮自定义名称 (仅勾选实体按钮时显示) -->
                                {#if entry.showInButton}
                                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; padding: 6px 10px; background: var(--indexos-bg-card); border-radius: 4px; border: 1px solid var(--indexos-border-light);">
                                        <span style="font-size: 11px; color: var(--indexos-text-muted); flex-shrink: 0;">实体按钮名称:</span>
                                        <input
                                            type="text"
                                            class="b3-text-field fn__flex-1"
                                            style="font-size: 11px; padding: 2px 6px;"
                                            placeholder="默认使用命令名称"
                                            value={entry.buttonLabel || ""}
                                            on:input={e => updateEntry(cmd.id, () => ({ buttonLabel: e.currentTarget.value }))}
                                        />
                                    </div>
                                {/if}

                                <!-- 虚拟按钮 Condition 设置 (仅勾选虚拟按钮时才显示！) -->
                                {#if entry.showInVirtualButton}
                                    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 8px 10px; background: rgba(124, 58, 237, 0.04); border-radius: 5px; border: 1px solid rgba(124, 58, 237, 0.2);">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 11px; font-weight: 600; color: #7c3aed;">
                                                🔍 虚拟按钮 Condition (显示条件):
                                            </span>
                                            <span style="font-size: 10px; color: var(--indexos-text-muted);">
                                                满足条件才悬浮展示
                                            </span>
                                        </div>
                                        <input
                                            type="text"
                                            class="b3-text-field fn__block"
                                            style="font-size: 11px; padding: 4px 8px;"
                                            placeholder="如: custom-status == 'pending' 或 content includes '[ ]'"
                                            value={entry.condition || entry.blockFilter || ""}
                                            on:input={e => updateEntry(cmd.id, () => ({ condition: e.currentTarget.value, blockFilter: e.currentTarget.value }))}
                                        />
                                        <!-- 快捷条件胶囊 -->
                                        <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                                            <span style="font-size: 10px; opacity: 0.6;">快捷条件:</span>
                                            {#each PRESET_CONDITIONS as p}
                                                <button
                                                    type="button"
                                                    style="font-size: 9px; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(124,58,237,0.3); background: var(--indexos-bg-card); cursor: pointer; color: var(--indexos-text-main);"
                                                    on:click={() => appendCondition(cmd.id, p.filter)}
                                                >
                                                    + {p.label}
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                            </div>

                            <!-- 2. 入参设置 (仅当该命令有入参时呈现) -->
                            {#if paramSchemas.length > 0}
                                <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--indexos-border-divider); padding-top: 8px;">
                                    <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
                                        ⚙️ 命令入参设置
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 6px;">
                                        {#each paramSchemas as schema}
                                            {@const curVal = entry.params?.[schema.key] || ""}
                                            <div style="display: flex; flex-direction: column; gap: 3px; background: var(--indexos-bg-card); border: 1px solid var(--indexos-border-light); border-radius: 4px; padding: 6px 8px;">
                                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                                    <label style="font-size: 11px; font-weight: 600; color: var(--indexos-text-main);">
                                                        {schema.label || schema.key}
                                                    </label>
                                                    {#if schema.description}
                                                        <span style="font-size: 10px; color: var(--indexos-text-muted);">
                                                            {schema.description}
                                                        </span>
                                                    {/if}
                                                </div>
                                                <input
                                                    type="text"
                                                    class="b3-text-field fn__block"
                                                    style="font-size: 11px; padding: 3px 6px;"
                                                    placeholder={schema.default ? `默认值: ${schema.default}` : "留空则使用默认/上下文"}
                                                    value={curVal}
                                                    on:input={e => setParam(cmd.id, schema.key, e.currentTarget.value)}
                                                />
                                                <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;">
                                                    <button
                                                        type="button"
                                                        style="font-size: 9px; padding: 1px 5px; border-radius: 3px; border: 1px solid var(--indexos-border-light); background: transparent; cursor: pointer;"
                                                        on:click={() => insertPlaceholder(cmd.id, schema.key, "{{block_id}}")}
                                                    >
                                                        + &#123;&#123;block_id&#125;&#125;
                                                    </button>
                                                    <button
                                                        type="button"
                                                        style="font-size: 9px; padding: 1px 5px; border-radius: 3px; border: 1px solid var(--indexos-border-light); background: transparent; cursor: pointer;"
                                                        on:click={() => insertPlaceholder(cmd.id, schema.key, "{{time}}")}
                                                    >
                                                        + &#123;&#123;time&#125;&#125;
                                                    </button>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- 底部操作按钮 -->
    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 4px; border-top: 1px solid var(--indexos-border-divider);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存配置"}
        </button>
    </div>
</div>
