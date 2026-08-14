<script lang="ts">
    import { onMount } from "svelte";
    import { Dialog, showMessage } from "siyuan";
    import { createPipelineRow, registerPipelineCommand, pipelineCommandId, updatePipelineRow, readPipelineRow } from "./manager";
    import { parseRuleScript } from "./script-dsl";
    import { inferPipelineIO } from "./pipeline-io-infer";
    import CommandSequenceEditor from "./CommandSequenceEditor.svelte";
    import { refreshSupertagRegistry } from "../utils/sync-service";

    export let dialog: Dialog;
    export let onCreated: ((rowId: string, name: string) => void) | undefined = undefined;
    export let initialScript: string | null = null;
    export let editRowId: string | null = null;

    let activeTab: "steps" | "input" | "output" = "steps";
    let script = "";
    let error = "";
    let saving = false;
    let sequenceEditorRef: any;

    let customInputMap: Record<string, string> = {};
    let customOutputMap: Record<string, string> = {};

    // 实时推导
    $: currentRule = parseRuleScript(script);
    $: inferredIO = currentRule ? inferPipelineIO(currentRule) : { input: {}, output: {} };
    $: inferredInputKeys = Object.keys(inferredIO.input);
    $: inferredOutputKeys = Object.keys(inferredIO.output);

    onMount(async () => {
        if (editRowId && !initialScript) {
            try {
                const row = await readPipelineRow(editRowId);
                if (row) {
                    initialScript = row.script;
                    try { customInputMap = JSON.parse(row.inputStr || "{}"); } catch (_) {}
                    try { customOutputMap = JSON.parse(row.outputStr || "{}"); } catch (_) {}
                }
            } catch (e) {
                console.error("[PipelineEditor] Error reading row:", e);
            }
        }
    });

    async function handleSave() {
        error = "";
        let targetScript = script;
        if ((!targetScript || !targetScript.trim()) && sequenceEditorRef && typeof sequenceEditorRef.getScript === "function") {
            targetScript = sequenceEditorRef.getScript();
        }

        console.log("[PipelineSave-Debug] 💾 handleSave 触发！targetScript:", JSON.stringify(targetScript));
        const rule = parseRuleScript(targetScript);

        if (!rule || !rule.name || !rule.name.trim()) {
            error = "请填写名称并至少勾选一个命令";
            return;
        }
        if (!rule.commands || rule.commands.length === 0) {
            error = "请至少勾选一个命令";
            return;
        }

        // 合并推导与用户自定义覆盖
        const finalInferred = inferPipelineIO(rule);
        const finalInputObj: Record<string, string> = { ...finalInferred.input, ...customInputMap };
        const finalOutputObj: Record<string, string> = { ...finalInferred.output, ...customOutputMap };

        const finalInputJson = Object.keys(finalInputObj).length > 0 ? JSON.stringify(finalInputObj, null, 2) : "";
        const finalOutputJson = Object.keys(finalOutputObj).length > 0 ? JSON.stringify(finalOutputObj, null, 2) : "";

        saving = true;
        try {
            let rowId: string;
            if (editRowId) {
                rowId = editRowId;
                await updatePipelineRow(rowId, rule.name.trim(), targetScript, finalInputJson, finalOutputJson);
            } else {
                rowId = await createPipelineRow(rule.name.trim(), targetScript, finalInputJson, finalOutputJson);
            }
            const commandId = pipelineCommandId(rowId);
            registerPipelineCommand(commandId, rule.name.trim(), targetScript, finalInputJson);
            await refreshSupertagRegistry();
            console.log(`[PipelineEditor] saved ${commandId} (${rule.name.trim()})`);
            showMessage(`✓ 复合命令已${editRowId ? "更新" : "创建"}并自动同步 Input/Output：${commandId}`);
            onCreated?.(rowId, rule.name.trim());
            dialog.destroy();
        } catch (e: any) {
            error = `保存失败: ${e.message}`;
        } finally {
            saving = false;
        }
    }
    function handleOutputInput(outKey: string, event: Event) {
        const input = event.target as HTMLInputElement;
        customOutputMap[outKey] = input.value;
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <!-- 头部标题与 Tab 导航 -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; gap: 6px;">
            <span>🧩</span>
            <span>复合命令 (Pipeline) 编排中心</span>
        </div>
        {#if editRowId}
            <span style="font-family: monospace; font-size: 11px; opacity: 0.6;">{pipelineCommandId(editRowId)}</span>
        {/if}
    </div>

    <!-- 顶部 Tab 切换 (规范级 Segmented TabBar) -->
    <div class="indexos-tabbar">
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'steps'}
            on:click={() => activeTab = "steps"}
        >
            <span>🧩 步骤编排 (Steps)</span>
        </button>
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'input'}
            on:click={() => activeTab = "input"}
        >
            <span>📥 输入参数 (Input)</span>
            {#if inferredInputKeys.length > 0}
                <span class="indexos-tab-badge">{inferredInputKeys.length}</span>
            {/if}
        </button>
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'output'}
            on:click={() => activeTab = "output"}
        >
            <span>📤 输出变量 (Output)</span>
            {#if inferredOutputKeys.length > 0}
                <span class="indexos-tab-badge">{inferredOutputKeys.length}</span>
            {/if}
        </button>
    </div>

    <!-- 主体视图区 -->
    <div style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
        <!-- Tab 1: 步骤编排 -->
        <div style="height: 100%; display: {activeTab === 'steps' ? 'flex' : 'none'}; flex-direction: column;">
            <CommandSequenceEditor
                bind:this={sequenceEditorRef}
                {initialScript}
                showName={true}
                onScriptChange={s => { script = s; }}
            />
        </div>

        <!-- Tab 2: 输入参数推导与微调 -->
        {#if activeTab === "input"}
            <div style="height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 4px;">
                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); line-height: 1.5; background: var(--indexos-bg-card); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                    💡 <strong>自动推导说明</strong>：系统已根据步骤中出现的 <code>&#123;&#123;input.xxx&#125;&#125;</code>、<code>&#123;&#123;prompt:xxx&#125;&#125;</code> 自动生成以下输入参数。保存时将自动回写到 Command-DB 的 <strong>Input</strong> 列。
                </div>

                {#if inferredInputKeys.length === 0}
                    <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 40px 0; font-size: 13px;">
                        🌱 当前步骤序列中未引用动态变量，本复合命令无需额外入参。
                    </div>
                {:else}
                    {#each inferredInputKeys as inKey}
                        <div style="display: flex; flex-direction: column; gap: 6px; background: var(--indexos-bg-container); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-weight: 600; font-size: 13px; color: var(--b3-theme-on-surface); font-family: monospace;">
                                    {inKey}
                                </span>
                                <span style="font-size: 11px; color: var(--indexos-accent-primary); background: rgba(59, 130, 246, 0.1); padding: 1px 6px; border-radius: 4px;">
                                    自动推导
                                </span>
                            </div>
                            <input 
                                type="text" 
                                class="b3-input fn__block" 
                                style="box-sizing: border-box; width: 100%; font-family: monospace;"
                                placeholder="可选默认值 (留空则执行时动态提供)"
                                bind:value={customInputMap[inKey]} 
                            />
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}

        <!-- Tab 3: 输出变量推导与导出 -->
        {#if activeTab === "output"}
            <div style="height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 4px;">
                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); line-height: 1.5; background: var(--indexos-bg-card); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                    💡 <strong>出参导出说明</strong>：系统自动收集了全部步骤执行后产出的变量 Token。保存时将自动回写到 Command-DB 的 <strong>Output</strong> 列。
                </div>

                {#if inferredOutputKeys.length === 0}
                    <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 40px 0; font-size: 13px;">
                        🌿 当前步骤序列中暂无可导出的出参变量。
                    </div>
                {:else}
                    {#each inferredOutputKeys as outKey}
                        <div style="display: flex; flex-direction: column; gap: 6px; background: var(--indexos-bg-container); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-weight: 600; font-size: 13px; color: var(--b3-theme-on-surface); font-family: monospace;">
                                    {outKey}
                                </span>
                                <span style="font-size: 11px; color: var(--indexos-status-success); background: rgba(16, 185, 129, 0.1); padding: 1px 6px; border-radius: 4px;">
                                    自动捕获
                                </span>
                            </div>
                            <input 
                                type="text" 
                                class="b3-input fn__block" 
                                style="font-family: monospace; box-sizing: border-box; width: 100%;"
                                placeholder="如: &#123;&#123;var.{outKey}&#125;&#125;"
                                value={customOutputMap[outKey] || inferredIO.output[outKey]} 
                                on:input={(e) => handleOutputInput(outKey, e)}
                            />
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    </div>

    {#if error}
        <div style="font-size: 11px; color: var(--indexos-status-error); background: rgba(220, 38, 38, 0.08); padding: 6px 10px; border-radius: 4px; word-break: break-all; flex-shrink: 0;">
            {error}
        </div>
    {/if}

    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 8px; border-top: 1px solid var(--indexos-border-divider);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存并全量同步"}
        </button>
    </div>
</div>
