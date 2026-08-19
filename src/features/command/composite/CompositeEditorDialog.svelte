<script lang="ts">
    import { onMount } from "svelte";
    import { Dialog, showMessage } from "siyuan";
    import { createCompositeRow, registerCompositeCommand, compositeCommandId, updateCompositeRow, readCompositeRow, generateUniqueCompositeName } from "./manager";
    import { parseRuleScript } from "./script-dsl";
    import { inspectCompositeSteps, type StepSchemaItem } from "./composite-step-schema";
    import CommandSequenceEditor from "./CommandSequenceEditor.svelte";
    import { refreshSupertagRegistry } from "../utils/sync-service";

    export let dialog: Dialog;
    export let onCreated: ((rowId: string, name: string) => void) | undefined = undefined;
    export let initialScript: string | null = null;
    export let editRowId: string | null = null;
    export let initialTab: "steps" | "input" | "output" = "steps";

    let activeTab: "steps" | "input" | "output" = initialTab;
    let script = "";
    let error = "";
    let saving = false;
    let sequenceEditorRef: any;

    // 外部入参状态表：是否暴露勾选 + 暴露默认值
    let exposedInputs: Record<string, boolean> = {};
    let exposedInputDefaults: Record<string, string> = {};

    // 导出变量状态表：是否导出勾选（默认 true）+ 出参别名
    let exportedOutputs: Record<string, boolean> = {};
    let outputAliases: Record<string, string> = {};

    // 是否已从已存行数据中初始化过配置
    let hasLoadedExistingConfig = false;

    // 步骤结构分析
    $: currentRule = parseRuleScript(script);
    $: stepSchemas = inspectCompositeSteps(currentRule);

    // 动态计算激活的 Input / Output 数量 Badge
    $: activeExposedInputCount = stepSchemas.flatMap(s => s.params).filter(p => exposedInputs[p.key] === true).length;
    $: activeExportedOutputCount = stepSchemas.flatMap(s => s.outputs).filter(o => exportedOutputs[o.key] !== false).length;

    onMount(async () => {
        if (editRowId && !initialScript) {
            try {
                const row = await readCompositeRow(editRowId);
                if (row) {
                    initialScript = row.script;
                    loadExistingIO(row.inputStr, row.outputStr);
                }
            } catch (e) {
                console.error("[CompositeEditor] Error reading row:", e);
            }
        }
    });

    function loadExistingIO(inputStr: string, outputStr: string) {
        hasLoadedExistingConfig = true;
        if (inputStr) {
            try {
                const parsedIn = JSON.parse(inputStr);
                if (parsedIn && typeof parsedIn === "object") {
                    for (const [k, v] of Object.entries(parsedIn)) {
                        exposedInputs[k] = true;
                        exposedInputDefaults[k] = String(v ?? "");
                    }
                }
            } catch (_) {}
        }

        if (outputStr) {
            try {
                const parsedOut = JSON.parse(outputStr);
                if (parsedOut && typeof parsedOut === "object") {
                    for (const [k, v] of Object.entries(parsedOut)) {
                        exportedOutputs[k] = true;
                        outputAliases[k] = String(v ?? "");
                    }
                }
            } catch (_) {}
        }
    }

    async function handleSave() {
        error = "";
        let targetScript = script;
        if ((!targetScript || !targetScript.trim()) && sequenceEditorRef && typeof sequenceEditorRef.getScript === "function") {
            targetScript = sequenceEditorRef.getScript();
        }

        console.log("[CompositeSave-Debug] 💾 handleSave 触发！targetScript:", JSON.stringify(targetScript));
        const rule = parseRuleScript(targetScript);

        if (!rule || !rule.commands || rule.commands.length === 0) {
            error = "请至少勾选一个命令";
            return;
        }

        // 自动命名：若未填写名称，则自动生成唯一命名（复合命令 1, 复合命令 2...）
        let finalName = (rule.name || "").trim();
        if (!finalName) {
            finalName = generateUniqueCompositeName();
            if (targetScript.includes("// 名称:")) {
                targetScript = targetScript.replace(/\/\/\s*名称\s*:[^\n]*/, `// 名称: ${finalName}`);
            } else {
                targetScript = `// 名称: ${finalName}\n${targetScript}`;
            }
        }

        // 1. 组装勾选暴露的外部入参
        const finalInputObj: Record<string, string> = {};
        for (const step of stepSchemas) {
            for (const p of step.params) {
                if (exposedInputs[p.key] === true) {
                    const customDef = exposedInputDefaults[p.key];
                    finalInputObj[p.key] = customDef !== undefined ? customDef : (p.stepConfigValue || p.defaultValue || "");
                }
            }
        }
        const finalInputJson = Object.keys(finalInputObj).length > 0 ? JSON.stringify(finalInputObj, null, 2) : "";

        // 2. 组装出参导出列表（默认全量勾选，仅排除用户显式取消勾选的）
        const finalOutputObj: Record<string, string> = {};
        for (const step of stepSchemas) {
            for (const o of step.outputs) {
                if (exportedOutputs[o.key] !== false) {
                    finalOutputObj[o.key] = (outputAliases[o.key] || o.canonicalToken).trim();
                }
            }
        }
        const finalOutputJson = Object.keys(finalOutputObj).length > 0 ? JSON.stringify(finalOutputObj, null, 2) : "";

        saving = true;
        try {
            let rowId: string;
            if (editRowId) {
                rowId = editRowId;
                await updateCompositeRow(rowId, finalName, targetScript, finalInputJson, finalOutputJson);
            } else {
                rowId = await createCompositeRow(finalName, targetScript, finalInputJson, finalOutputJson);
            }
            const commandId = compositeCommandId(rowId);
            registerCompositeCommand(commandId, finalName, targetScript, finalInputJson);
            await refreshSupertagRegistry();
            console.log(`[CompositeEditor] saved ${commandId} (${finalName})`);
            showMessage(`✓ 复合命令已${editRowId ? "更新" : "创建"}：${finalName}`);
            onCreated?.(rowId, finalName);
            dialog.destroy();
        } catch (e: any) {
            error = `保存失败: ${e.message}`;
        } finally {
            saving = false;
        }
    }

    function toggleExposeInput(paramKey: string, stepConfigValue: string, defaultValue: string, e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        exposedInputs[paramKey] = checked;
        if (checked && exposedInputDefaults[paramKey] === undefined) {
            exposedInputDefaults[paramKey] = stepConfigValue || defaultValue || "";
        }
    }

    function toggleExportOutput(outKey: string, e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        exportedOutputs[outKey] = checked;
    }

    function handleOutputAliasInput(outKey: string, e: Event) {
        outputAliases[outKey] = (e.target as HTMLInputElement).value;
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <!-- 头部标题 -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; gap: 6px;">
            <span>🧩</span>
            <span>复合命令 (Composite Command) 编排中心</span>
        </div>
        {#if editRowId}
            <span style="font-family: monospace; font-size: 11px; opacity: 0.6;">{compositeCommandId(editRowId)}</span>
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
            <span>📥 外部入参 (Input)</span>
            {#if activeExposedInputCount > 0}
                <span class="indexos-tab-badge">{activeExposedInputCount}</span>
            {/if}
        </button>
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'output'}
            on:click={() => activeTab = "output"}
        >
            <span>📤 导出变量 (Output)</span>
            {#if activeExportedOutputCount > 0}
                <span class="indexos-tab-badge">{activeExportedOutputCount}</span>
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

        <!-- Tab 2: 外部入参清单与按需暴露 -->
        {#if activeTab === "input"}
            <div style="height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 4px;">
                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); line-height: 1.5; background: var(--indexos-bg-card); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                    💡 <strong>入参暴露说明</strong>：步骤内部配置的参数已默认在执行时生效。若您希望某些参数允许在外部调用时（如按钮链接传参、Supertag 绑定）传入值进行动态覆盖，请在此勾选暴露。默认无需外部传参，可全部留空。
                </div>

                {#if stepSchemas.length === 0}
                    <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 40px 0; font-size: 13px;">
                        🌱 暂无步骤，请先在【步骤编排】中勾选命令。
                    </div>
                {:else}
                    {#each stepSchemas as step}
                        <div style="display: flex; flex-direction: column; gap: 8px; background: var(--indexos-bg-container); padding: 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--indexos-border-divider); padding-bottom: 6px;">
                                <span style="font-weight: 600; font-size: 13px; color: var(--indexos-text-main);">
                                    📦 步骤 {step.stepIndex}：{step.commandName}
                                </span>
                                <span style="font-family: monospace; font-size: 11px; opacity: 0.5;">
                                    {step.commandId}
                                </span>
                            </div>

                            {#if step.params.length === 0}
                                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); padding: 4px 0;">
                                    此命令无需输入参数。
                                </div>
                            {:else}
                                <div style="display: flex; flex-direction: column; gap: 8px;">
                                    {#each step.params as param}
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--indexos-bg-surface); padding: 6px 10px; border-radius: 4px; border: 1px solid var(--indexos-border-subtle);">
                                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0;">
                                                <input 
                                                    type="checkbox" 
                                                    class="b3-switch fn__flex-center" 
                                                    checked={exposedInputs[param.key] === true}
                                                    on:change={(e) => toggleExposeInput(param.key, param.stepConfigValue, param.defaultValue, e)}
                                                />
                                                <span style="font-size: 12px; font-weight: {exposedInputs[param.key] ? '600' : 'normal'}; color: {exposedInputs[param.key] ? 'var(--indexos-accent-primary)' : 'var(--b3-theme-on-surface)'};">
                                                    {param.label || param.key}
                                                    <span style="font-family: monospace; font-size: 10px; opacity: 0.6;">({param.key})</span>
                                                </span>
                                            </label>

                                            {#if exposedInputs[param.key]}
                                                <div style="flex: 1; max-width: 260px; display: flex; align-items: center; gap: 6px;">
                                                    <input 
                                                        type="text" 
                                                        class="b3-input fn__block" 
                                                        style="font-size: 11px; font-family: monospace; height: 26px; box-sizing: border-box; width: 100%;"
                                                        placeholder="暴露默认值 (可选)"
                                                        bind:value={exposedInputDefaults[param.key]}
                                                    />
                                                </div>
                                            {:else}
                                                <span style="font-size: 11px; color: var(--indexos-text-muted); opacity: 0.7;">
                                                    {param.stepConfigValue ? `已内置: "${param.stepConfigValue}"` : "默认不外露"}
                                                </span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}

        <!-- Tab 3: 输出变量清单与自选过滤 (默认全量勾选) -->
        {#if activeTab === "output"}
            <div style="height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 4px;">
                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); line-height: 1.5; background: var(--indexos-bg-card); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                    💡 <strong>出参导出说明</strong>：复合命令执行后产出的变量已<strong>默认全量导出</strong>。如某些中间步骤变量无需向外提供，可取消勾选。
                </div>

                {#if stepSchemas.length === 0}
                    <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 40px 0; font-size: 13px;">
                        🌿 暂无步骤，请先在【步骤编排】中勾选命令。
                    </div>
                {:else}
                    {#each stepSchemas as step}
                        <div style="display: flex; flex-direction: column; gap: 8px; background: var(--indexos-bg-container); padding: 12px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
                            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--indexos-border-divider); padding-bottom: 6px;">
                                <span style="font-weight: 600; font-size: 13px; color: var(--indexos-text-main);">
                                    📦 步骤 {step.stepIndex}：{step.commandName}
                                </span>
                                <span style="font-family: monospace; font-size: 11px; opacity: 0.5;">
                                    {step.commandId}
                                </span>
                            </div>

                            {#if step.outputs.length === 0}
                                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); padding: 4px 0;">
                                    此步骤无产出出参。
                                </div>
                            {:else}
                                <div style="display: flex; flex-direction: column; gap: 8px;">
                                    {#each step.outputs as out}
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--indexos-bg-surface); padding: 6px 10px; border-radius: 4px; border: 1px solid var(--indexos-border-subtle);">
                                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0;">
                                                <input 
                                                    type="checkbox" 
                                                    class="b3-switch fn__flex-center" 
                                                    checked={exportedOutputs[out.key] !== false}
                                                    on:change={(e) => toggleExportOutput(out.key, e)}
                                                />
                                                <span style="font-size: 12px; font-weight: {exportedOutputs[out.key] !== false ? '600' : 'normal'}; color: {exportedOutputs[out.key] !== false ? 'var(--indexos-status-success)' : 'var(--b3-theme-on-surface-light)'};">
                                                    {out.label || out.key}
                                                    <span style="font-family: monospace; font-size: 10px; opacity: 0.6;">({out.key})</span>
                                                </span>
                                            </label>

                                            {#if exportedOutputs[out.key] !== false}
                                                <div style="flex: 1; max-width: 260px; display: flex; align-items: center; gap: 6px;">
                                                    <input 
                                                        type="text" 
                                                        class="b3-input fn__block" 
                                                        style="font-size: 11px; font-family: monospace; height: 26px; box-sizing: border-box; width: 100%;"
                                                        placeholder={out.canonicalToken}
                                                        value={outputAliases[out.key] !== undefined ? outputAliases[out.key] : out.canonicalToken}
                                                        on:input={(e) => handleOutputAliasInput(out.key, e)}
                                                    />
                                                </div>
                                            {:else}
                                                <span style="font-size: 11px; color: var(--indexos-text-muted); opacity: 0.6;">
                                                    不导出
                                                </span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
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
