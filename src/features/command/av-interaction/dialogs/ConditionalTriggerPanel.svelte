<script lang="ts">
    import CommandSequenceEditor from "../../composite/CommandSequenceEditor.svelte";
    import { 
        generateMultiEventRuleScript, 
        parseMultiEventRuleScript, 
        generateRuleScript, 
        parseDispatchCallsFromText, 
        type RuleCommand,
        type EventScopeFilter
    } from "../../composite/script-dsl";
    import { createCompositeRow, registerCompositeCommand, compositeCommandId } from "../../composite/manager";
    import { refreshSupertagRegistry } from "../../utils/sync-service";
    import { PRESET_CONDITIONS } from "../../../unified-attributes/core/condition-evaluator";
    import { showMessage } from "siyuan";

    export let supertag: string = "";
    export let currentVal: string = "";

    const ALL_EVENT_TYPES = [
        { id: "tag_created", label: "添加标签时", icon: "⚡" },
        { id: "tag_removed", label: "移除标签时", icon: "🗑️" },
        { id: "block_created", label: "新内容创建时", icon: "➕" },
        { id: "block_content_changed", label: "内容变动时", icon: "✍️" },
        { id: "block_attribute_changed", label: "属性变动时", icon: "🏷️" },
        { id: "task_completed", label: "任务完成时", icon: "☑" }
    ];

    const SCOPE_OPTIONS = [
        { id: "self", label: "仅自身 (Self)", desc: "仅当打上此标签的实体自身变动时触发 (默认)" },
        { id: "inner_blocks", label: "内部子块 (Inner Blocks)", desc: "当前实体内部直接/间接子块变动时触发" },
        { id: "current_doc", label: "所在当前文档 (Current Doc)", desc: "同一文档内任意匹配块变动时触发 (角色/挂件环境感知)" },
        { id: "subtree", label: "全子树 (Subtree)", desc: "当前实体及所有子孙文档/块变动时触发 (项目管理/大纲级联)" }
    ];

    const FILTER_OPTIONS = [
        { id: "all", label: "任意内容", icon: "🌐" },
        { id: "todo", label: "待办任务", icon: "☑" },
        { id: "heading", label: "各级标题", icon: "📑" },
        { id: "paragraph", label: "文本段落", icon: "✍️" },
        { id: "doc", label: "文档页面", icon: "📄" },
        { id: "av", label: "属性视图", icon: "📊" }
    ];

    export let selectedEvents: string[] = ["tag_created"];
    let activeEventTab: string = "tag_created";
    export let eventCommandsMap: Record<string, RuleCommand[]> = { "tag_created": [] };
    export let eventConfigsMap: Record<string, EventScopeFilter> = {};
    let showScopeFilterPanel = false;
    let showAddEventPicker = false;

    function extractCommandsFromScript(text: string): RuleCommand[] {
        return parseDispatchCallsFromText(text);
    }

    const parsed = parseMultiEventRuleScript(currentVal || "");
    if (parsed && parsed.events && parsed.events.length > 0) {
        selectedEvents = parsed.events;
        activeEventTab = selectedEvents[0] || "tag_created";
        eventCommandsMap = { ...parsed.eventCommandsMap };
        if (parsed.eventConfigsMap) {
            eventConfigsMap = { ...parsed.eventConfigsMap };
        }
        for (const ev of selectedEvents) {
            if (!eventCommandsMap[ev]) eventCommandsMap[ev] = [];
            if (!eventConfigsMap[ev]) eventConfigsMap[ev] = { scope: "self", filter: "all" };
        }
    }

    if (currentVal && (!eventCommandsMap[activeEventTab] || eventCommandsMap[activeEventTab].length === 0)) {
        const fallbackCmds = extractCommandsFromScript(currentVal);
        if (fallbackCmds.length > 0) {
            eventCommandsMap[activeEventTab] = fallbackCmds;
        }
    }

    $: unselectedEvents = ALL_EVENT_TYPES.filter(ev => !selectedEvents.includes(ev.id));

    function isScopeFilterCustomized(evId: string): boolean {
        const cfg = eventConfigsMap[evId];
        if (!cfg) return false;
        return (cfg.scope !== undefined && cfg.scope !== "self") || 
               (cfg.filter !== undefined && cfg.filter !== "all") ||
               (cfg.condition !== undefined && cfg.condition.trim().length > 0);
    }

    function setScope(evId: string, scope: string) {
        const current = eventConfigsMap[evId] || { scope: "self", filter: "all" };
        eventConfigsMap = {
            ...eventConfigsMap,
            [evId]: { ...current, scope: scope as any }
        };
    }

    function setFilter(evId: string, filter: string) {
        const current = eventConfigsMap[evId] || { scope: "self", filter: "all" };
        eventConfigsMap = {
            ...eventConfigsMap,
            [evId]: { ...current, filter: filter as any }
        };
    }

    function setCondition(evId: string, cond: string) {
        const current = eventConfigsMap[evId] || { scope: "self", filter: "all" };
        eventConfigsMap = {
            ...eventConfigsMap,
            [evId]: { ...current, condition: cond }
        };
    }

    function switchEventTab(eventId: string) {
        activeEventTab = eventId;
        showAddEventPicker = false;
        if (eventId !== "block_created" && eventId !== "block_content_changed" && eventId !== "block_attribute_changed") {
            showScopeFilterPanel = false;
        }
    }

    function toggleScopeFilterForTab(evId: string, e: MouseEvent | KeyboardEvent) {
        e.stopPropagation();
        if (activeEventTab !== evId) {
            activeEventTab = evId;
            showScopeFilterPanel = true;
        } else {
            showScopeFilterPanel = !showScopeFilterPanel;
        }
    }

    function addEventTab(eventId: string) {
        if (!selectedEvents.includes(eventId)) {
            selectedEvents = [...selectedEvents, eventId];
            if (!eventCommandsMap[eventId]) {
                eventCommandsMap = { ...eventCommandsMap, [eventId]: [] };
            }
            if (!eventConfigsMap[eventId]) {
                eventConfigsMap = { ...eventConfigsMap, [eventId]: { scope: "self", filter: "all" } };
            }
        }
        activeEventTab = eventId;
        showAddEventPicker = false;
    }

    function removeEventTab(eventId: string, e?: Event) {
        if (e) e.stopPropagation();
        if (selectedEvents.length <= 1) {
            showMessage("请至少保留一个触发事件", 3000, "info");
            return;
        }
        selectedEvents = selectedEvents.filter(id => id !== eventId);
        delete eventCommandsMap[eventId];
        delete eventConfigsMap[eventId];
        if (activeEventTab === eventId) {
            activeEventTab = selectedEvents[0] || "";
        }
    }

    function handleActiveScriptChange(scriptText: string) {
        if (!activeEventTab) return;
        const newCmds = extractCommandsFromScript(scriptText);
        eventCommandsMap = {
            ...eventCommandsMap,
            [activeEventTab]: newCmds
        };
    }

    function buildScriptForActiveTab(evId: string): string {
        const cmds = eventCommandsMap[evId] || [];
        return generateRuleScript("", cmds);
    }

    /** 导出获取生成的最终 DSL 脚本 */
    export function getSerializedScript(): string {
        let totalAutoCmds = 0;
        for (const ev of selectedEvents) {
            totalAutoCmds += (eventCommandsMap[ev] || []).length;
        }
        if (totalAutoCmds > 0 && selectedEvents.length > 0) {
            return generateMultiEventRuleScript("", eventCommandsMap, eventConfigsMap);
        }
        return "";
    }

    /** 导出另存为复合命令方法 */
    export async function saveAsCompositeCommand(): Promise<void> {
        const finalScript = getSerializedScript();
        if (!finalScript) {
            showMessage("请至少配置一条自动触发命令", 3000, "error");
            return;
        }
        savingAsCommand = true;
        try {
            const name = `#${supertag} 条件触发`;
            const rowId = await createCompositeRow(name, finalScript);
            const commandId = compositeCommandId(rowId);
            registerCompositeCommand(commandId, name, finalScript, "{}");
            await refreshSupertagRegistry();
            showMessage(`✓ 已另存为复合命令：${commandId}`);
        } catch (e: any) {
            showMessage(`另存失败: ${e.message || e}`, 4000, "error");
        } finally {
            savingAsCommand = false;
        }
    }
</script>

<div class="conditional-trigger-panel" style="display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; overflow: hidden;">
    <!-- 触发事件 Tab 选项卡 -->
    <div class="indexos-tabbar" style="flex-wrap: wrap; display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-muted); margin-right: 2px;">触发事件:</div>

        {#each selectedEvents as evId}
            {@const evObj = ALL_EVENT_TYPES.find(x => x.id === evId)}
            {@const cmdCount = (eventCommandsMap[evId] || []).length}
            {@const supportsScope = (evId === "block_created" || evId === "block_content_changed" || evId === "block_attribute_changed")}
            {@const isCustom = supportsScope && isScopeFilterCustomized(evId)}
            {#if evObj}
                <div
                    class="indexos-tab-item"
                    class:active={activeEventTab === evId}
                    style="{isCustom && activeEventTab !== evId ? 'border-bottom: 2px solid var(--indexos-detached-gold, #D9A74A);' : ''}; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;"
                    on:click={() => switchEventTab(evId)}
                    on:keydown={e => (e.key === 'Enter' || e.key === ' ') && switchEventTab(evId)}
                    role="tab"
                    tabindex="0"
                >
                    <span>{evObj.icon} {evObj.label}</span>
                    <span class="indexos-tab-badge">{cmdCount}</span>
                    
                    {#if supportsScope}
                        <span
                            role="button"
                            tabindex="0"
                            style="display: inline-flex; align-items: center; justify-content: center; font-size: 11px; padding: 1px 4px; border-radius: 3px; cursor: pointer; transition: all 0.15s ease; {isCustom ? 'border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; color: var(--indexos-detached-gold, #D9A74A) !important; background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.14)) !important; font-weight: 600;' : (activeEventTab === evId && showScopeFilterPanel ? 'color: var(--indexos-accent-primary); background: rgba(40,81,127,0.12);' : 'opacity: 0.6;')}"
                            title="配置此事件的生效范围与块类型过滤"
                            on:click={(e) => toggleScopeFilterForTab(evId, e)}
                            on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleScopeFilterForTab(evId, e)}
                        >⚙️</span>
                    {/if}

                    {#if selectedEvents.length > 1}
                        <span
                            role="button"
                            tabindex="0"
                            style="opacity: 0.5; font-weight: bold; margin-left: 2px; line-height: 1; cursor: pointer;"
                            title="关闭并删除该事件配置"
                            on:click={(e) => removeEventTab(evId, e)}
                            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && removeEventTab(evId, e)}
                        >&times;</span>
                    {/if}
                </div>
            {/if}
        {/each}

        <!-- ➕ 启用新事件 Tab 按钮 -->
        <div style="position: relative;">
            <button
                type="button"
                class="b3-button b3-button--outline"
                style="font-size: 11px; padding: 4px 8px; height: 26px; line-height: 24px; display: inline-flex; align-items: center; gap: 4px;"
                on:click={() => showAddEventPicker = !showAddEventPicker}
            >
                <span>➕ 新事件</span>
            </button>

            {#if showAddEventPicker}
                <div style="position: absolute; top: 30px; left: 0; z-index: 100; background: var(--indexos-bg-card); border: 1px solid var(--indexos-border-light); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 6px; min-width: 150px; display: flex; flex-direction: column; gap: 4px;">
                    {#if unselectedEvents.length === 0}
                        <div style="font-size: 11px; color: var(--indexos-text-muted); padding: 4px 8px; text-align: center;">已启用全部事件</div>
                    {:else}
                        {#each unselectedEvents as ev}
                            <button
                                type="button"
                                style="font-size: 11px; padding: 6px 10px; border-radius: 4px; border: none; background: transparent; color: var(--indexos-text-main); text-align: left; cursor: pointer; display: flex; align-items: center; gap: 6px; width: 100%; transition: background 0.15s ease;"
                                on:click={() => addEventTab(ev.id)}
                            >
                                <span>{ev.icon}</span>
                                <span>{ev.label}</span>
                            </button>
                        {/each}
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <!-- 展开的高级范围与过滤配置面板 -->
    {#if showScopeFilterPanel && (activeEventTab === "block_created" || activeEventTab === "block_content_changed" || activeEventTab === "block_attribute_changed")}
        {@const curScope = eventConfigsMap[activeEventTab]?.scope || "self"}
        {@const curFilter = eventConfigsMap[activeEventTab]?.filter || "all"}
        {@const curCondition = eventConfigsMap[activeEventTab]?.condition || ""}
        <div style="background: var(--indexos-bg-surface); border: 1px solid {isScopeFilterCustomized(activeEventTab) ? 'var(--indexos-detached-gold, #D9A74A)' : 'var(--indexos-border-light)'}; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; gap: 6px;">
                    <span>⚙️ 【{ALL_EVENT_TYPES.find(x => x.id === activeEventTab)?.label}】生效范围与过滤</span>
                    {#if isScopeFilterCustomized(activeEventTab)}
                        <span style="font-size: 10px; color: var(--indexos-detached-gold, #D9A74A); font-weight: 600;">(已开启级联)</span>
                    {/if}
                </div>
                <button
                    type="button"
                    style="border: none; background: transparent; font-size: 13px; color: var(--indexos-text-muted); cursor: pointer; padding: 2px 6px;"
                    on:click={() => showScopeFilterPanel = false}
                >✕</button>
            </div>

            <!-- 1. 作用域 Scope 选择 -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-muted);">
                    1. 监听作用域 (Scope):
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    {#each SCOPE_OPTIONS as opt}
                        {@const isSelected = curScope === opt.id}
                        <button
                            type="button"
                            class="b3-button {isSelected ? 'b3-button--primary' : 'b3-button--outline'}"
                            style="font-size: 11px; padding: 3px 10px; height: 26px; {isSelected && opt.id !== 'self' ? 'background: var(--indexos-detached-gold, #D9A74A) !important; border-color: var(--indexos-detached-gold, #D9A74A) !important; color: #fff !important;' : ''}"
                            title={opt.desc}
                            on:click={() => setScope(activeEventTab, opt.id)}
                        >
                            {opt.label}
                        </button>
                    {/each}
                </div>
                <div style="font-size: 10px; color: var(--indexos-text-muted); line-height: 1.3;">
                    ℹ️ {SCOPE_OPTIONS.find(x => x.id === curScope)?.desc}
                </div>
            </div>

            <!-- 2. 目标类型 Target Filter 选择 -->
            <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px; padding-top: 6px; border-top: 1px dashed var(--indexos-border-divider);">
                <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-muted);">
                    2. 目标块类型过滤 (Target Filter):
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    {#each FILTER_OPTIONS as opt}
                        {@const isSelected = curFilter === opt.id}
                        <button
                            type="button"
                            class="b3-button {isSelected ? 'b3-button--primary' : 'b3-button--outline'}"
                            style="font-size: 11px; padding: 3px 10px; height: 26px; {isSelected && opt.id !== 'all' ? 'background: var(--indexos-detached-gold, #D9A74A) !important; border-color: var(--indexos-detached-gold, #D9A74A) !important; color: #fff !important;' : ''}"
                            on:click={() => setFilter(activeEventTab, opt.id)}
                        >
                            <span>{opt.icon}</span>
                            <span>{opt.label}</span>
                        </button>
                    {/each}
                </div>
            </div>

            <!-- 3. 前置断言 Condition -->
            <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px; padding-top: 6px; border-top: 1px dashed var(--indexos-border-divider);">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-muted);">
                        3. 前置断言表达式 (Condition / Predicate):
                    </div>
                    {#if curCondition}
                        <button
                            type="button"
                            style="border: none; background: transparent; color: var(--indexos-text-muted); font-size: 10px; cursor: pointer; text-decoration: underline; padding: 0;"
                            on:click={() => setCondition(activeEventTab, "")}
                        >
                            清空
                        </button>
                    {/if}
                </div>
                <input
                    type="text"
                    class="b3-text-field fn__flex-1"
                    style="font-size: 11px; padding: 4px 8px; font-family: monospace; border-radius: 4px; {curCondition ? 'border-color: var(--indexos-detached-gold, #D9A74A);' : ''}"
                    placeholder="如: content starts_with 'BUG:' 或 status != 'done'"
                    value={curCondition}
                    on:input={(e) => setCondition(activeEventTab, e.currentTarget.value)}
                />
                <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-top: 2px;">
                    <span style="font-size: 10px; color: var(--indexos-text-muted);">快捷预设:</span>
                    {#each PRESET_CONDITIONS as preset}
                        <button
                            type="button"
                            class="b3-button b3-button--outline"
                            style="font-size: 10px; padding: 2px 6px; height: 20px; line-height: 18px; border-radius: 3px;"
                            on:click={() => setCondition(activeEventTab, preset.filter)}
                        >
                            {preset.label}
                        </button>
                    {/each}
                </div>
            </div>
        </div>
    {/if}

    <!-- 当前事件 Tab 的专属命令序列编辑器 -->
    {#key activeEventTab}
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;">
            <CommandSequenceEditor
                initialScript={buildScriptForActiveTab(activeEventTab)}
                allowedCommands={null}
                onScriptChange={handleActiveScriptChange}
            />
        </div>
    {/key}
</div>
