<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { createPipelineRow, registerPipelineCommand, pipelineCommandId, updatePipelineRow } from "./manager";
    import { parseRuleScript } from "./script-dsl";
    import CommandSequenceEditor from "./CommandSequenceEditor.svelte";
    import { refreshSupertagRegistry } from "../utils/sync-service";

    export let dialog: Dialog;
    export let onCreated: ((rowId: string, name: string) => void) | undefined = undefined;
    export let initialScript: string | null = null;
    export let editRowId: string | null = null;

    let script = "";
    let error = "";
    let saving = false;

    async function handleSave() {
        error = "";
        const rule = parseRuleScript(script);
        if (!rule || !rule.name.trim()) {
            error = "请填写名称并至少勾选一个命令";
            return;
        }
        if (rule.commands.length === 0) {
            error = "请至少勾选一个命令";
            return;
        }

        saving = true;
        try {
            let rowId: string;
            if (editRowId) {
                rowId = editRowId;
                await updatePipelineRow(rowId, rule.name.trim(), script);
            } else {
                rowId = await createPipelineRow(rule.name.trim(), script);
            }
            const commandId = pipelineCommandId(rowId);
            registerPipelineCommand(commandId, rule.name.trim(), script, "{}");
            await refreshSupertagRegistry();
            console.log(`[PipelineEditor] saved ${commandId} (${rule.name.trim()})`);
            showMessage(`✓ 复合命令已${editRowId ? "更新" : "创建"}：${commandId}`);
            onCreated?.(rowId, rule.name.trim());
            dialog.destroy();
        } catch (e) {
            error = `保存失败: ${e.message}`;
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">🧩 复合命令</div>
    <CommandSequenceEditor
        {initialScript}
        showName={true}
        onScriptChange={s => { script = s; }}
    />
    {#if error}
        <div style="font-size: 11px; color: var(--indexos-status-error); background: rgba(220, 38, 38, 0.08); padding: 6px 10px; border-radius: 4px; word-break: break-all; flex-shrink: 0;">
            {error}
        </div>
    {/if}
    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存并注册"}
        </button>
    </div>
</div>
