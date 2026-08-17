<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import CommandSequenceEditor from "../../pipeline/CommandSequenceEditor.svelte";
    import { generateMultiEventRuleScript, parseMultiEventRuleScript, generateRuleScript, parseDispatchCallsFromText, type RuleCommand } from "../../pipeline/script-dsl";
    import { createPipelineRow, registerPipelineCommand, pipelineCommandId } from "../../pipeline/manager";
    import { refreshSupertagRegistry } from "../../utils/sync-service";

    export let dialog: Dialog;
    export let supertag: string;
    export let currentValue: string;
    export let onSave: (updatedValue: string) => Promise<void>;

    const ALL_EVENT_TYPES = [
        { id: "tag_created", label: "添加标签时", icon: "⚡" },
        { id: "tag_removed", label: "移除标签时", icon: "🗑️" },
        { id: "block_content_changed", label: "内容变动时", icon: "✍️" },
        { id: "block_attribute_changed", label: "属性变动时", icon: "🏷️" },
        { id: "task_completed", label: "任务完成时", icon: "☑" }
    ];

    let selectedEvents: string[] = ["tag_created"];
    let activeEventTab: string = "tag_created";
    /** 每个事件 Tab 对应的命令列表 */
    let eventCommandsMap: Record<string, RuleCommand[]> = {
        "tag_created": []
    };

    let error = "";
    let saving = false;
    let savingAsCommand = false;
    let showAddEventPicker = false;

    /** 核心提取函数：从单序列脚本文本中提取 commands 数组 */
    function extractCommandsFromScript(text: string): RuleCommand[] {
        return parseDispatchCallsFromText(text);
    }

    // 初次挂载时：从既有脚本中拆解多事件与命令映射
    const parsed = parseMultiEventRuleScript(currentValue || "");
    if (parsed && parsed.events && parsed.events.length > 0) {
        selectedEvents = parsed.events;
        activeEventTab = selectedEvents[0] || "tag_created";
        eventCommandsMap = { ...parsed.eventCommandsMap };
        for (const ev of selectedEvents) {
            if (!eventCommandsMap[ev]) eventCommandsMap[ev] = [];
        }
    }

    // 防错兜底：如果解析后默认选中的 Tab 在 eventCommandsMap 中依然为空，尝试整体解包文本
    if (currentValue && (!eventCommandsMap[activeEventTab] || eventCommandsMap[activeEventTab].length === 0)) {
        const fallbackCmds = extractCommandsFromScript(currentValue);
        if (fallbackCmds.length > 0) {
            eventCommandsMap[activeEventTab] = fallbackCmds;
        }
    }

    $: unselectedEvents = ALL_EVENT_TYPES.filter(ev => !selectedEvents.includes(ev.id));

    function switchTab(eventId: string) {
        console.log(`[ConditionalDialog-Debug] 🔀 切换 Tab 从 ${activeEventTab} -> ${eventId}`, "当前 eventCommandsMap:", JSON.parse(JSON.stringify(eventCommandsMap)));
        activeEventTab = eventId;
        showAddEventPicker = false;
    }

    function addEventTab(eventId: string) {
        if (!selectedEvents.includes(eventId)) {
            selectedEvents = [...selectedEvents, eventId];
            if (!eventCommandsMap[eventId]) {
                eventCommandsMap = { ...eventCommandsMap, [eventId]: [] };
            }
        }
        activeEventTab = eventId;
        showAddEventPicker = false;
        console.log(`[ConditionalDialog-Debug] ➕ 添加 Tab ${eventId}`, "当前 eventCommandsMap:", JSON.parse(JSON.stringify(eventCommandsMap)));
    }

    function removeEventTab(eventId: string, e: MouseEvent) {
        e.stopPropagation();
        if (selectedEvents.length <= 1) {
            showMessage("请至少保留一个触发事件", 3000, "info");
            return;
        }
        selectedEvents = selectedEvents.filter(id => id !== eventId);
        delete eventCommandsMap[eventId];
        if (activeEventTab === eventId) {
            activeEventTab = selectedEvents[0] || "";
        }
        console.log(`[ConditionalDialog-Debug] 🗑️ 删除 Tab ${eventId}`, "当前 eventCommandsMap:", JSON.parse(JSON.stringify(eventCommandsMap)));
    }

    /** 当前选中 Tab 的 Script 文本更新回调 */
    function handleActiveScriptChange(scriptText: string) {
        if (!activeEventTab) return;
        const newCmds = extractCommandsFromScript(scriptText);
        console.log(`[ConditionalDialog-Debug] 📩 子组件 onScriptChange 触发 (Tab=${activeEventTab})`, "提取新命令:", newCmds);
        eventCommandsMap = {
            ...eventCommandsMap,
            [activeEventTab]: newCmds
        };
    }

    function buildScriptForActiveTab(evId: string): string {
        const cmds = eventCommandsMap[evId] || [];
        const builtScript = generateRuleScript("", cmds);
        console.log(`[ConditionalDialog-Debug] 🛠️ 为 Tab=${evId} 构筑 initialScript:`, JSON.stringify(builtScript), "命令数:", cmds.length);
        return builtScript;
    }

    async function handleSave() {
        error = "";
        if (selectedEvents.length === 0) {
            error = "请至少选择一个触发事件";
            return;
        }

        let totalCmds = 0;
        for (const ev of selectedEvents) {
            totalCmds += (eventCommandsMap[ev] || []).length;
        }
        if (totalCmds === 0) {
            error = "请至少在一个事件 Tab 中勾选配置至少一条命令";
            return;
        }

        saving = true;
        try {
            const finalScript = generateMultiEventRuleScript("", eventCommandsMap);
            await onSave(finalScript);
            await refreshSupertagRegistry();
            console.log(`[ConditionalEditor] 成功保存 #${supertag} 的多事件 Tab 条件脚本:`, selectedEvents);
            showMessage(`✓ 已成功保存 #${supertag} 的条件触发配置 ⚡`);
            dialog.destroy();
        } catch (e: any) {
            error = `保存失败: ${e.message}`;
        } finally {
            saving = false;
        }
    }

    async function handleSaveAsCommand() {
        error = "";
        const finalScript = generateMultiEventRuleScript("", eventCommandsMap);
        if (!finalScript) {
            error = "请至少配置一条命令";
            return;
        }
        savingAsCommand = true;
        try {
            const name = `#${supertag} 条件触发`;
            const rowId = await createPipelineRow(name, finalScript);
            const commandId = pipelineCommandId(rowId);
            registerPipelineCommand(commandId, name, finalScript, "{}");
            await refreshSupertagRegistry();
            showMessage(`✓ 已另存为复合命令：${commandId}`);
        } catch (e: any) {
            error = `另存失败: ${e.message}`;
        } finally {
            savingAsCommand = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 12px;">
    <!-- 标题 -->
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;">
        <span>⚡ 配置 Supertag <span style="color: var(--indexos-accent-primary);">#{supertag}</span> 自动触发 (Auto)</span>
    </div>

    <!-- 触发事件 Tab 选项卡 (规范级 Segmented TabBar) -->
    <div class="indexos-tabbar" style="flex-wrap: wrap;">
        <div style="font-size: 11px; font-weight: 600; color: var(--indexos-text-muted); margin-right: 4px;">触发事件:</div>

        {#each selectedEvents as evId}
            {@const evObj = ALL_EVENT_TYPES.find(x => x.id === evId)}
            {@const cmdCount = (eventCommandsMap[evId] || []).length}
            {#if evObj}
                <button
                    type="button"
                    class="indexos-tab-item"
                    class:active={activeEventTab === evId}
                    on:click={() => switchTab(evId)}
                >
                    <span>{evObj.icon} {evObj.label}</span>
                    <span class="indexos-tab-badge">{cmdCount}</span>
                    {#if selectedEvents.length > 1}
                        <span
                            style="opacity: 0.5; font-weight: bold; margin-left: 2px; line-height: 1;"
                            title="关闭并删除该事件配置"
                            on:click={(e) => removeEventTab(evId, e)}
                        >&times;</span>
                    {/if}
                </button>
            {/if}
        {/each}

        <!-- ➕ 启用新事件 Tab 按钮 -->
        <div style="position: relative;">
            <button
                type="button"
                class="b3-button b3-button--outline"
                style="font-size: 11px; padding: 4px 10px; height: 26px; line-height: 24px; display: inline-flex; align-items: center; gap: 4px;"
                on:click={() => showAddEventPicker = !showAddEventPicker}
            >
                <span>➕ 启用新事件</span>
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

    <!-- 当前事件 Tab 的专属命令序列编辑器 -->
    {#key activeEventTab}
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;">
            <CommandSequenceEditor
                initialScript={buildScriptForActiveTab(activeEventTab)}
                showName={false}
                allowedCommands={null}
                onScriptChange={handleActiveScriptChange}
            />
        </div>
    {/key}

    <div style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0; line-height: 1.5;">
        提示：每个事件 Tab 可配置专属命令。在当前事件下勾选命令并点“⚙ 入参”调整参数，保存后将按事件自动分发执行。
    </div>

    {#if error}
        <div style="font-size: 11px; color: var(--indexos-status-error); background: rgba(220, 38, 38, 0.08); padding: 6px 10px; border-radius: 4px; word-break: break-all; flex-shrink: 0;">
            {error}
        </div>
    {/if}

    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--outline" on:click={handleSaveAsCommand} disabled={savingAsCommand || saving}>
            {savingAsCommand ? "保存中..." : "另存为复合命令"}
        </button>
        <div style="flex: 1;"></div>
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存配置"}
        </button>
    </div>
</div>
