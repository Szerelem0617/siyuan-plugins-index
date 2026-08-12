<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import CommandSequenceEditor from "../../pipeline/CommandSequenceEditor.svelte";
    import { generateRuleScript, parseRuleScript } from "../../pipeline/script-dsl";
    import { createPipelineRow, registerPipelineCommand, pipelineCommandId } from "../../pipeline/manager";
    import { refreshSupertagRegistry } from "../../utils/sync-service";

    export let dialog: Dialog;
    export let supertag: string;
    export let boundCommands: { label: string; rowId: string; commandRef?: string }[];
    export let currentValue: string;
    export let onSave: (updatedValue: string) => Promise<void>;

    const ALL_EVENT_TYPES = [
        { id: "tag_created", label: "添加标签时" },
        { id: "tag_removed", label: "移除标签时" },
        { id: "block_content_changed", label: "内容变动时" },
        { id: "block_attribute_changed", label: "属性变动时" },
        { id: "task_completed", label: "任务完成时" }
    ];

    let script = currentValue || "";
    let selectedEvents: string[] = ["tag_created"];
    let error = "";
    let saving = false;
    let savingAsCommand = false;

    /** Conditional 只允许勾选“绑定命令”中存在的命令 */
    const allowed = boundCommands
        .map(b => b.commandRef || b.label)
        .filter(Boolean);

    // 绝妙反向解析：从单元格既有脚本反向解包还原事件列表
    const existing = parseRuleScript(currentValue || "");
    if (existing?.events && existing.events.length > 0) {
        selectedEvents = existing.events;
    }

    function toggleEvent(id: string) {
        selectedEvents = selectedEvents.includes(id)
            ? selectedEvents.filter(x => x !== id)
            : [...selectedEvents, id];
    }

    async function handleSave() {
        error = "";
        if (selectedEvents.length === 0) {
            error = "请至少选择一个触发事件";
            return;
        }
        const rule = parseRuleScript(script);
        if (!rule || rule.commands.length === 0) {
            error = "请至少勾选一个命令";
            return;
        }

        saving = true;
        try {
            const updated = generateRuleScript("", rule.commands, selectedEvents);
            await onSave(updated);
            await refreshSupertagRegistry();
            console.log(`[ConditionalEditor] 保存 #${supertag} 条件脚本，事件:`, selectedEvents);
            showMessage(`✓ 已保存 #${supertag} 的条件触发配置 ⚡`);
            dialog.destroy();
        } catch (e: any) {
            error = `保存失败: ${e.message}`;
        } finally {
            saving = false;
        }
    }

    /** 另存为复合命令（不改动 Conditional 单元格） */
    async function handleSaveAsCommand() {
        error = "";
        const rule = parseRuleScript(script);
        if (!rule || rule.commands.length === 0) {
            error = "请至少勾选一个命令";
            return;
        }
        savingAsCommand = true;
        try {
            const name = `#${supertag} 条件`;
            const rowId = await createPipelineRow(name, script);
            const commandId = pipelineCommandId(rowId);
            registerPipelineCommand(commandId, name, script, "{}");
            await refreshSupertagRegistry();
            console.log(`[ConditionalEditor] 已另存为复合命令 ${commandId}`);
            showMessage(`✓ 已另存为复合命令：${commandId}`);
        } catch (e) {
            error = `另存失败: ${e.message}`;
        } finally {
            savingAsCommand = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">
        🏷️ 配置 Supertag <span style="color: var(--indexos-accent-primary);">#{supertag}</span> 的条件触发
    </div>

    <div style="flex-shrink: 0; display: flex; flex-direction: column; gap: 6px;">
        <div style="font-size: 11px; color: var(--indexos-text-muted);">触发事件（勾选的命令序列会在这些事件发生时执行）</div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            {#each ALL_EVENT_TYPES as ev}
                <button
                    type="button"
                    class="indexos-btn-bordered"
                    style="font-size: 11px; padding: 3px 10px; {selectedEvents.includes(ev.id) ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : ''}"
                    on:click={() => toggleEvent(ev.id)}
                >{ev.label}</button>
            {/each}
        </div>
    </div>

    <CommandSequenceEditor
        initialScript={currentValue || null}
        showName={false}
        allowedCommands={allowed}
        onScriptChange={s => { script = s; }}
    />

    <div style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0; line-height: 1.5;">
        勾选命令后点“⚙ 入参”配置参数，可引用前序出参与环境变量。生成的脚本与复合命令/后台任务同格式，可互相提升复用。
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
