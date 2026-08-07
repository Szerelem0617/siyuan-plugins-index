<script lang="ts">
    import { onMount } from "svelte";
    import { i18n } from "../../../../shared/utils";

    export let dialog: any;
    export let commandName: string;
    export let commandId: string;
    export let paramsSchema: any[]; // list of ParamSchema
    export let initialTab: "input" | "output" = "input";
    export let currentInputParams: Record<string, any> = {};
    export let currentOutputMapping: Record<string, string> = {};
    export let onSave: (updatedInput: Record<string, any>, updatedOutput: Record<string, string>) => Promise<void>;

    import { commandRegistry } from "../../registry/command-registry";
    import { openIndexDropdown } from "../../../../ui/components/index-dropdown";

    let activeTab: "input" | "output" = initialTab;
    let values: Record<string, any> = {};
    let outputAliasMap: Record<string, string> = {};
    let showHidden = false;

    $: hasHiddenParams = paramsSchema.some(p => p.hidden);
    $: visibleParams = showHidden ? paramsSchema : paramsSchema.filter(p => !p.hidden);

    // 动态读取 Command Registry 中注册的 outputs 定义（严格按 registry 查找，无定义则为空）
    $: cmdDef = commandRegistry.getCommand(commandId);
    $: outputsSchema = (cmdDef && cmdDef.outputs && Array.isArray(cmdDef.outputs)) ? cmdDef.outputs : [];

    onMount(() => {
        activeTab = initialTab;
        // Initialize input values based on schema and current configurations
        paramsSchema.forEach(param => {
            if (currentInputParams && currentInputParams[param.key] !== undefined) {
                if (param.type === "boolean") {
                    values[param.key] = currentInputParams[param.key] === true || currentInputParams[param.key] === 1 || currentInputParams[param.key] === "1" || String(currentInputParams[param.key]).toLowerCase() === "true";
                } else {
                    values[param.key] = currentInputParams[param.key];
                }
            } else {
                if (param.type === "boolean") {
                    values[param.key] = param.default === true || param.default === 1 || String(param.default).toLowerCase() === "true";
                } else {
                    values[param.key] = param.default !== undefined ? String(param.default) : "";
                }
            }
        });

        // Initialize output alias values based on outputsSchema
        outputsSchema.forEach(out => {
            outputAliasMap[out.key] = currentOutputMapping[out.key] || String(out.default || out.key || "createdblock");
        });
    });

    async function handleSave() {
        const inputResult: Record<string, any> = {};
        paramsSchema.forEach(param => {
            const val = values[param.key];
            if (val !== undefined && val !== "") {
                if (param.type === "boolean") {
                    inputResult[param.key] = !!val;
                } else if (param.type === "number") {
                    const parsed = Number(val);
                    inputResult[param.key] = isNaN(parsed) ? val : parsed;
                } else {
                    inputResult[param.key] = val;
                }
            }
        });

        const outputResult = { ...outputAliasMap };

        await onSave(inputResult, outputResult);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; overflow-x: hidden;">
    <!-- Dialog Header -->
    <div style="margin-bottom: 12px; flex-shrink: 0;">
        <div style="font-size: 15px; font-weight: bold; color: var(--b3-theme-on-surface); display: flex; align-items: center; gap: 8px;">
            <svg class="b3-list-item__graphic" style="height: 18px; width: 18px; color: var(--b3-theme-primary);"><use xlink:href="#iconSettings"></use></svg>
            <span>{initialTab === 'input' ? "📥 配置命令入参 (Input Mapping)" : "📤 配置出参别名 (Output Mapping)"}</span>
        </div>
        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 6px; padding: 6px; border-radius: 4px; background-color: var(--b3-theme-surface); border: 1px solid var(--b3-border-color);">
            <div style="font-family: monospace; font-weight: bold; margin-bottom: 2px;">{commandName}</div>
            <div style="font-family: monospace; color: var(--b3-theme-primary);">{commandId}</div>
        </div>
    </div>

    <!-- Scrollable Form Content (独立根据 initialTab 渲染) -->
    <div style="flex: 1; overflow-y: auto; overflow-x: hidden; padding-right: 4px; display: flex; flex-direction: column; gap: 16px;">
        {#if initialTab === 'input'}
            {#if paramsSchema.length === 0}
                <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 40px 0;">
                    此命令没有需要配置的输入参数。
                </div>
            {:else}
                {#each visibleParams as param}
                    <div style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-weight: bold; font-size: 13px; color: var(--b3-theme-on-surface);">
                                {param.label || param.key}
                                {#if param.required}
                                    <span style="color: var(--b3-theme-error); margin-left: 2px;">*</span>
                                {/if}
                            </span>
                            <span style="font-family: monospace; font-size: 11px; color: var(--b3-theme-on-surface-light);">
                                {param.key} ({param.type})
                            </span>
                        </div>

                        {#if param.type === "enum"}
                            <div class="b3-form__icon fn__block">
                                <button
                                    class="b3-select fn__block fn__flex"
                                    style="align-items: center; justify-content: space-between; width: 100%; height: 28px; padding: 4px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer; transition: all 0.15s ease;"
                                    on:click={(e) => openIndexDropdown({
                                        event: e,
                                        options: (param.values || []).map(val => ({ value: String(val), label: String(val) })),
                                        selectedValue: String(values[param.key]),
                                        onSelect: (val) => {
                                            values[param.key] = val;
                                        }
                                    })}
                                >
                                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        {values[param.key] || ""}
                                    </span>
                                    <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.5; flex-shrink: 0; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
                                </button>
                            </div>
                        {:else}
                            {@const autoSuggest = (param.key === 'id' || param.type === 'blockid') 
                                ? '⚡ Auto-Context 推荐: {{var.createdblock}} (不填将自动智能匹配)' 
                                : (param.key === 'enabled' 
                                    ? '⚡ Auto-Context 推荐: {{var.last_boolean_result}} (不填将由前一步控制)' 
                                    : (param.default !== undefined ? `Layer 2 默认: ${param.default}` : (param.description || '')))}
                            <input 
                                type="text" 
                                class="b3-input fn__block" 
                                style="box-sizing: border-box; width: 100%; max-width: 100%;"
                                placeholder={autoSuggest}
                                bind:value={values[param.key]} 
                            />
                        {/if}

                        {#if param.description}
                            <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); line-height: 1.4; padding-left: 2px;">
                                💡 {param.description}
                            </div>
                        {/if}

                        {#if param.paramMode === "template" && param.templateVars && param.templateVars.length > 0}
                            <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); padding-left: 2px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                                <span>可用占位符:</span>
                                {#each param.templateVars as tVar}
                                    <span 
                                        role="button"
                                        tabindex="0"
                                        class="b3-chip b3-chip--secondary" 
                                        style="font-family: monospace; cursor: pointer; padding: 2px 4px; font-size: 10px;"
                                        on:click={() => {
                                            const cur = values[param.key] || "";
                                            values[param.key] = cur + tVar;
                                        }}
                                        on:keydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                const cur = values[param.key] || "";
                                                values[param.key] = cur + tVar;
                                            }
                                        }}
                                        title="点击插入到输入框末尾"
                                    >
                                        {tVar}
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}

                {#if hasHiddenParams}
                    <div style="display: flex; justify-content: center; margin-top: 4px; margin-bottom: 4px;">
                        <button 
                            class="b3-button b3-button--text" 
                            on:click={() => showHidden = !showHidden}
                            style="font-size: 12px; display: flex; align-items: center; gap: 4px; padding: 4px 8px;"
                        >
                            <svg class="b3-list-item__graphic" style="height: 12px; width: 12px; margin: 0; color: var(--b3-theme-primary);"><use xlink:href={showHidden ? "#iconUp" : "#iconDown"}></use></svg>
                            <span>{showHidden ? "隐藏高级参数" : "显示高级参数"}</span>
                        </button>
                    </div>
                {/if}
            {/if}
        {:else if initialTab === 'output'}
            <div style="display: flex; flex-direction: column; gap: 16px;">
                {#if outputsSchema.length === 0}
                    <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 40px 0;">
                        此命令无可导出的出参变量。
                    </div>
                {:else}
                    {#each outputsSchema as outParam}
                        <div style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-weight: bold; font-size: 13px; color: var(--b3-theme-on-surface);">
                                    {outParam.label || outParam.key}
                                </span>
                                <span style="font-family: monospace; font-size: 11px; color: var(--b3-theme-primary);">
                                    引用方式: {"{{var." + (outputAliasMap[outParam.key] || outParam.default || outParam.key) + "}}"}
                                </span>
                            </div>

                            <input 
                                type="text" 
                                class="b3-input fn__block" 
                                style="font-family: monospace; box-sizing: border-box; width: 100%;"
                                placeholder="请输入自定义出参变量名，如: createdblock"
                                bind:value={outputAliasMap[outParam.key]} 
                            />

                            {#if outParam.description}
                                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); line-height: 1.4; padding-left: 2px;">
                                    💡 {outParam.description}
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    </div>

    <!-- Action Bar -->
    <div class="fn__flex" style="margin-top: 16px; justify-content: flex-end; gap: 8px; flex-shrink: 0; border-top: 1px solid var(--b3-border-color); padding-top: 12px;">
        <button 
            class="b3-button b3-button--cancel" 
            on:click={() => dialog.destroy()}
        >
            {i18n.cancel || "取消"}
        </button>
        <button 
            class="b3-button" 
            on:click={handleSave}
            disabled={paramsSchema.some(p => p.required && !values[p.key] && values[p.key] !== 0 && values[p.key] !== false)}
        >
            {i18n.confirm || "保存"}
        </button>
    </div>
</div>
