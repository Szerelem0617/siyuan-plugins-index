<script lang="ts">
    import { onMount } from "svelte";
    import { openIndexDropdown } from "../../../../ui/components/index-dropdown";
    import { commandRegistry } from "../../registry/command-registry";

    export let dialog: any;
    export let commandName: string;
    export let commandId: string;
    export let initialTab: "input" | "output" = "input";
    export let paramsSchema: any[] = [];
    export let outputsSchema: any[] = [];
    export let currentInputParams: Record<string, any> = {};
    export let currentOutputMapping: Record<string, string> = {};
    export let onSave: (updatedInput: Record<string, any>, updatedOutput: Record<string, string>) => Promise<void>;

    let activeTab: "input" | "output" = initialTab;
    let inputValues: Record<string, any> = {};
    let outputAliasMap: Record<string, string> = {};
    let showHidden = false;
    let saving = false;

    $: hasHiddenParams = paramsSchema.some(p => p.hidden);
    $: visibleParams = showHidden ? paramsSchema : paramsSchema.filter(p => !p.hidden);

    onMount(() => {
        // 1. 初始化 Input 数据
        paramsSchema.forEach(param => {
            if (currentInputParams && currentInputParams[param.key] !== undefined) {
                if (param.type === "boolean") {
                    inputValues[param.key] = currentInputParams[param.key] === true || currentInputParams[param.key] === 1 || currentInputParams[param.key] === "1" || String(currentInputParams[param.key]).toLowerCase() === "true";
                } else {
                    inputValues[param.key] = currentInputParams[param.key];
                }
            } else {
                if (param.type === "boolean") {
                    inputValues[param.key] = param.default === true || param.default === 1 || String(param.default).toLowerCase() === "true";
                } else {
                    inputValues[param.key] = param.default !== undefined ? String(param.default) : "";
                }
            }
        });

        // 2. 初始化 Output 数据
        outputsSchema.forEach(out => {
            let val = currentOutputMapping[out.key] || String(out.default || out.key || "");
            if (val && !val.includes("{{")) {
                const clean = val.startsWith("var.") ? val : `var.${val}`;
                val = `{{${clean}}}`;
            }
            outputAliasMap[out.key] = val;
        });
    });

    async function handleSave() {
        saving = true;
        try {
            // 组装 Input
            const inputResult: Record<string, any> = {};
            paramsSchema.forEach(param => {
                if (inputValues[param.key] !== undefined && inputValues[param.key] !== "") {
                    inputResult[param.key] = inputValues[param.key];
                }
            });

            // 组装 Output
            const outputResult: Record<string, string> = {};
            outputsSchema.forEach(out => {
                const rawVal = (outputAliasMap[out.key] || "").trim();
                if (rawVal) {
                    outputResult[out.key] = rawVal;
                }
            });

            await onSave(inputResult, outputResult);
            dialog.destroy();
        } finally {
            saving = false;
        }
    }
</script>

<div class="fn__flex-column indexos-unified-config" style="height: 100%; box-sizing: border-box; padding: 16px; gap: 12px;">
    <!-- 头部信息 -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; gap: 6px;">
            <span>⚙️</span>
            <span>配置命令：<span style="color: var(--indexos-accent-primary);">{commandName}</span></span>
        </div>
        <span style="font-family: monospace; font-size: 11px; opacity: 0.6;">{commandId}</span>
    </div>

    <!-- 顶部 Tab 导航 (规范级 Segmented TabBar) -->
    <div class="indexos-tabbar">
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'input'}
            on:click={() => activeTab = "input"}
        >
            <span>📥 输入参数 (Input)</span>
            {#if paramsSchema.length > 0}
                <span class="indexos-tab-badge">{paramsSchema.length}</span>
            {/if}
        </button>
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'output'}
            on:click={() => activeTab = "output"}
        >
            <span>📤 输出变量 (Output)</span>
            {#if outputsSchema.length > 0}
                <span class="indexos-tab-badge">{outputsSchema.length}</span>
            {/if}
        </button>
    </div>

    <!-- 内容区域 -->
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 4px;">
        {#if activeTab === "input"}
            <!-- Input Tab 视图 -->
            {#if paramsSchema.length === 0}
                <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 50px 0; font-size: 13px;">
                    🌱 此命令没有需要配置的输入参数（无参命令）。
                </div>
            {:else}
                {#each visibleParams as param}
                    <div style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-weight: 600; font-size: 13px; color: var(--b3-theme-on-surface);">
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
                                    style="align-items: center; justify-content: space-between; width: 100%; height: 30px; padding: 4px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 4px; cursor: pointer;"
                                    on:click={(e) => openIndexDropdown({
                                        event: e,
                                        options: (param.values || []).map(val => ({ value: String(val), label: String(val) })),
                                        selectedValue: String(inputValues[param.key]),
                                        onSelect: (val) => {
                                            inputValues[param.key] = val;
                                        }
                                    })}
                                >
                                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        {inputValues[param.key] || ""}
                                    </span>
                                    <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.5; flex-shrink: 0; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
                                </button>
                            </div>
                        {:else if param.type === "boolean"}
                            <label class="fn__flex" style="align-items: center; gap: 8px; cursor: pointer; height: 28px;">
                                <input type="checkbox" class="b3-switch fn__flex-center" bind:checked={inputValues[param.key]} />
                                <span style="font-size: 12px; color: var(--b3-theme-on-surface-light);">
                                    {inputValues[param.key] ? "已开启 (true)" : "已关闭 (false)"}
                                </span>
                            </label>
                        {:else}
                            <input 
                                type="text" 
                                class="b3-input fn__block" 
                                style="box-sizing: border-box; width: 100%; font-family: monospace;"
                                placeholder={param.description || (param.default !== undefined ? String(param.default) : "")}
                                bind:value={inputValues[param.key]} 
                            />
                        {/if}

                        {#if param.description}
                            <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); line-height: 1.4; padding-left: 2px;">
                                💡 {param.description}
                            </div>
                        {/if}
                    </div>
                {/each}

                {#if hasHiddenParams}
                    <div style="padding-top: 6px;">
                        <button 
                            class="b3-button b3-button--text" 
                            style="font-size: 11px; color: var(--indexos-accent-primary); padding: 2px 0;"
                            on:click={() => showHidden = !showHidden}
                        >
                            {showHidden ? "▴ 折叠高级参数" : "▾ 显示高级参数"}
                        </button>
                    </div>
                {/if}
            {/if}

        {:else}
            <!-- Output Tab 视图 -->
            {#if outputsSchema.length === 0}
                <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 50px 0; font-size: 13px;">
                    🌿 此命令无可导出的出参变量。
                </div>
            {:else}
                {#each outputsSchema as outParam}
                    <div style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-weight: 600; font-size: 13px; color: var(--b3-theme-on-surface);">
                                {outParam.label || outParam.key}
                            </span>
                            <span style="font-family: monospace; font-size: 11px; color: var(--b3-theme-on-surface-light);">
                                {outParam.key}
                            </span>
                        </div>

                        <input 
                            type="text" 
                            class="b3-input fn__block" 
                            style="font-family: monospace; box-sizing: border-box; width: 100%;"
                            placeholder="如: &#123;&#123;var.{outParam.key}&#125;&#125;"
                            bind:value={outputAliasMap[outParam.key]} 
                        />

                        {#if outParam.description}
                            <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); line-height: 1.4; padding-left: 2px;">
                                💡 {outParam.description}
                            </div>
                        {/if}
                    </div>
                {/each}
            {/if}
        {/if}
    </div>

    <!-- 底部操作区 -->
    <div style="display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 10px; border-top: 1px solid var(--indexos-border-divider);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存全部配置"}
        </button>
    </div>
</div>
