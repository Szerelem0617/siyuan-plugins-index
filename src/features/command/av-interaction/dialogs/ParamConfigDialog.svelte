<script lang="ts">
    import { onMount } from "svelte";
    import { i18n } from "../../../../shared/utils";

    export let dialog: any;
    export let commandName: string;
    export let commandId: string;
    export let paramsSchema: any[]; // list of ParamSchema
    export let currentParams: Record<string, any>;
    export let onSave: (updated: Record<string, any>) => Promise<void>;

    import { commandRegistry } from "../../registry/command-registry";

    let activeTab: "input" | "output" = "input";
    let values: Record<string, any> = {};
    let outputAliasMap: Record<string, string> = {};
    let showHidden = false;

    $: hasHiddenParams = paramsSchema.some(p => p.hidden);
    $: visibleParams = showHidden ? paramsSchema : paramsSchema.filter(p => !p.hidden);

    // 动态读取 Command Registry 中注册的 outputs 定义
    $: cmdDef = commandRegistry.getCommand(commandId);
    $: outputsSchema = (cmdDef && cmdDef.outputs && cmdDef.outputs.length > 0)
        ? cmdDef.outputs
        : [
            {
                key: "id",
                label: "生成的新块 ID",
                type: "text",
                required: true,
                default: "createdblock",
                description: "后创块在思源内核中生成的 14 位真实 Block ID"
            }
        ];

    onMount(() => {
        // Initialize input values based on schema and current configurations
        paramsSchema.forEach(param => {
            if (currentParams && currentParams[param.key] !== undefined) {
                if (param.type === "boolean") {
                    values[param.key] = currentParams[param.key] === true || currentParams[param.key] === 1 || currentParams[param.key] === "1" || String(currentParams[param.key]).toLowerCase() === "true";
                } else {
                    values[param.key] = currentParams[param.key];
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
        const savedOutputs = currentParams?._outputMapping || {};
        outputsSchema.forEach(out => {
            outputAliasMap[out.key] = savedOutputs[out.key] || String(out.default || out.key || "createdblock");
        });
    });

    async function handleSave() {
        const result: Record<string, any> = {};
        paramsSchema.forEach(param => {
            const val = values[param.key];
            if (param.type === "boolean") {
                result[param.key] = !!val;
            } else if (param.type === "number") {
                const parsed = Number(val);
                result[param.key] = isNaN(parsed) ? val : parsed;
            } else {
                result[param.key] = val;
            }
        });

        // Attach output mapping aliases
        result._outputMapping = { ...outputAliasMap };

        await onSave(result);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box;">
    <!-- Dialog Header -->
    <div style="margin-bottom: 12px; flex-shrink: 0;">
        <div style="font-size: 15px; font-weight: bold; color: var(--b3-theme-on-surface); display: flex; align-items: center; gap: 8px;">
            <svg class="b3-list-item__graphic" style="height: 18px; width: 18px; color: var(--b3-theme-primary);"><use xlink:href="#iconSettings"></use></svg>
            <span>配置命令参数 & 出参控制</span>
        </div>
        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 6px; padding: 6px; border-radius: 4px; background-color: var(--b3-theme-surface); border: 1px solid var(--b3-border-color);">
            <div style="font-family: monospace; font-weight: bold; margin-bottom: 2px;">{commandName}</div>
            <div style="font-family: monospace; color: var(--b3-theme-primary);">{commandId}</div>
        </div>
    </div>

    <!-- Tab Buttons -->
    <div style="display: flex; gap: 4px; border-bottom: 1px solid var(--b3-border-color); margin-bottom: 12px; flex-shrink: 0;">
        <button 
            class="b3-button {activeTab === 'input' ? 'b3-button--primary' : 'b3-button--text'}"
            style="font-size: 12px; padding: 4px 12px; border-radius: 4px 4px 0 0;"
            on:click={() => activeTab = 'input'}
        >
            📥 入参配置 (Input Params)
        </button>
        <button 
            class="b3-button {activeTab === 'output' ? 'b3-button--primary' : 'b3-button--text'}"
            style="font-size: 12px; padding: 4px 12px; border-radius: 4px 4px 0 0;"
            on:click={() => activeTab = 'output'}
        >
            📤 出参命名 (Output Params)
        </button>
    </div>

    <!-- Scrollable Form Content -->
    <div style="flex: 1; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 16px;">
        {#if activeTab === 'input'}
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
                                <select class="b3-select fn__block" bind:value={values[param.key]}>
                                    {#each param.values || [] as option}
                                        <option value={option}>{option}</option>
                                    {/each}
                                </select>
                            </div>
                        {:else}
                            <input 
                                type="text" 
                                class="b3-input fn__block" 
                                placeholder={param.paramMode === "template" ? "支持占位符，如 {{block_id}}, {{date}}" : (param.description || "")}
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
        {:else if activeTab === 'output'}
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
                                style="font-family: monospace;"
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
