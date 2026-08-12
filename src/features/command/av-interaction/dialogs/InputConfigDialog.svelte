<script lang="ts">
    import { onMount } from "svelte";
    import { openIndexDropdown } from "../../../../ui/components/index-dropdown";
    import { getCommandDbTokens, getCommandDbPlaceholder } from "../command-db-auto-context";

    export let dialog: any;
    export let commandName: string;
    export let commandId: string;
    export let paramsSchema: any[]; // list of ParamSchema
    export let currentInputParams: Record<string, any> = {};
    export let onSave: (updatedInput: Record<string, any>) => Promise<void>;

    let values: Record<string, any> = {};
    let showHidden = false;

    $: hasHiddenParams = paramsSchema.some(p => p.hidden);
    $: visibleParams = showHidden ? paramsSchema : paramsSchema.filter(p => !p.hidden);

    onMount(() => {
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
    });

    async function handleSave() {
        const inputResult: Record<string, any> = {};
        paramsSchema.forEach(param => {
            if (values[param.key] !== undefined && values[param.key] !== "") {
                inputResult[param.key] = values[param.key];
            }
        });
        await onSave(inputResult);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; box-sizing: border-box; padding: 16px; gap: 12px;">
    <!-- 头部标题 -->
    <div style="font-size: 13px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 6px;">
            <span>⚙️</span>
            <span>配置命令入参 <span style="color: var(--indexos-accent-primary);">({commandName})</span></span>
        </div>
        <span style="font-family: monospace; font-size: 11px; opacity: 0.6;">{commandId}</span>
    </div>

    <!-- 表单列表区域 -->
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 4px;">
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
                        <input 
                            type="text" 
                            class="b3-input fn__block" 
                            style="box-sizing: border-box; width: 100%; max-width: 100%;"
                            placeholder={getCommandDbPlaceholder(param.key, param.type, param.default, param.description)}
                            bind:value={values[param.key]} 
                        />
                        <!-- ⚡ Command-DB 专属快捷 Token 胶囊栏 -->
                        {@const tokens = getCommandDbTokens(param.key, param.type)}
                        {#if tokens.length > 0}
                            <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;">
                                {#each tokens as tok}
                                    <button
                                        type="button"
                                        class="indexos-btn-bordered"
                                        style="font-size: 10px; padding: 1px 6px; border-radius: 3px; cursor: pointer; color: var(--indexos-accent-primary); border-color: var(--indexos-border-light);"
                                        title={tok.description}
                                        on:click={() => {
                                            const cur = values[param.key] || "";
                                            values[param.key] = cur ? `${cur} ${tok.token}` : tok.token;
                                        }}
                                    >{tok.label}</button>
                                {/each}
                            </div>
                        {/if}
                    {/if}

                    {#if param.description}
                        <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); line-height: 1.4; padding-left: 2px;">
                            💡 {param.description}
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
    </div>

    <!-- 底部按钮 -->
    <div style="display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 8px; border-top: 1px solid var(--indexos-border-divider);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave}>保存配置</button>
    </div>
</div>
