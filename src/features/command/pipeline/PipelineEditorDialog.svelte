<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { onMount } from "svelte";
    import { createPipelineRow, registerPipelineCommand, pipelineCommandId } from "./manager";
    import { validatePipeline } from "./types";
    import { refreshSupertagRegistry } from "../utils/sync-service";

    export let dialog: Dialog;
    export let onCreated: ((rowId: string, name: string) => void) | undefined = undefined;

    const EXAMPLE_STEPS = `[
  {
    "commandRef": "api.block.insert",
    "params": {
      "data": "[新任务] {{time}}",
      "previousID": "{{block_id}}"
    }
  },
  {
    "commandRef": "plugin-index.command.safeUpdateBlock",
    "params": {
      "id": "{{step0.id}}"
    }
  }
]`;

    let name = "";
    let stepsJson = EXAMPLE_STEPS;
    let error = "";
    let saving = false;

    onMount(() => {
        console.log("[PipelineEditor] opened");
    });

    function insertExample() {
        stepsJson = EXAMPLE_STEPS;
        if (!name) name = "创建任务并更新";
        error = "";
    }

    async function handleSave() {
        error = "";
        const cleanName = name.trim();
        if (!cleanName) {
            error = "请填写复合命令名称";
            return;
        }
        let steps: unknown;
        try {
            steps = JSON.parse(stepsJson);
        } catch (e) {
            error = `steps JSON 解析失败: ${e.message}`;
            return;
        }
        const config = { version: 1, name: cleanName, steps: steps as any[] };
        const { ok, errors } = validatePipeline(config);
        if (!ok) {
            error = errors.join("；");
            return;
        }

        saving = true;
        try {
            const rowId = await createPipelineRow(cleanName, config);
            const commandId = pipelineCommandId(rowId);
            registerPipelineCommand(commandId, cleanName, config, "{}");
            await refreshSupertagRegistry();
            console.log(`[PipelineEditor] created ${commandId} (${cleanName})`);
            showMessage(`✓ 复合命令已创建：${commandId}`);
            onCreated?.(rowId, cleanName);
            dialog.destroy();
        } catch (e) {
            error = `保存失败: ${e.message}`;
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 12px;">
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main);">
        🧩 创建复合命令 (Pipeline)
    </div>
    <div style="font-size: 11px; opacity: 0.7; color: var(--indexos-text-muted); line-height: 1.5;">
        按序执行的命令编排。步骤入参可引用前序步骤出参：<code>&#123;&#123;step0.id&#125;&#125;</code>；
        也可内嵌 TS 脚本步骤（步骤对象里加 <code>type: "script"</code> 与 <code>code</code> 字段）。
    </div>

    <div class="fn__flex" style="align-items: center; gap: 8px;">
        <label style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">名称</label>
        <input
            type="text"
            class="b3-text-field fn__flex-1"
            style="font-size: 12px; padding: 6px 10px;"
            placeholder="例如：创建任务并更新"
            bind:value={name}
        />
        <button class="indexos-btn-bordered" style="font-size: 11px; padding: 4px 10px;" on:click={insertExample}>插入示例</button>
    </div>

    <label style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main);">步骤定义 (steps JSON)</label>
    <textarea
        class="b3-text-field fn__flex-1"
        style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; resize: none; min-height: 220px; padding: 8px;"
        bind:value={stepsJson}
        spellcheck="false"
    ></textarea>

    {#if error}
        <div style="font-size: 11px; color: var(--indexos-status-error); background: rgba(220, 38, 38, 0.08); padding: 6px 10px; border-radius: 4px; word-break: break-all;">
            {error}
        </div>
    {/if}

    <div class="fn__flex" style="justify-content: flex-end; gap: 8px;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存并注册"}
        </button>
    </div>
</div>
