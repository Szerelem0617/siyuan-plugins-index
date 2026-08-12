<script lang="ts">
    import { onMount } from "svelte";
    import { commandRegistry } from "../../registry/command-registry";

    export let dialog: any;
    export let commandName: string;
    export let commandId: string;
    export let currentOutputMapping: Record<string, string> = {};
    export let onSave: (updatedOutput: Record<string, string>) => Promise<void>;

    let outputAliasMap: Record<string, string> = {};

    $: cmdDef = commandRegistry.getCommand(commandId);
    $: outputsSchema = (cmdDef && cmdDef.outputs && Array.isArray(cmdDef.outputs)) ? cmdDef.outputs : [];

    onMount(() => {
        outputsSchema.forEach(out => {
            let val = currentOutputMapping[out.key] || String(out.default || out.key || "");
            // 规范化：如果填写的名称没有带 {{var.xxx}} 的包覆，补全包覆为 {{var.xxx}}
            if (val && !val.includes("{{")) {
                const clean = val.startsWith("var.") ? val : `var.${val}`;
                val = `{{${clean}}}`;
            }
            outputAliasMap[out.key] = val;
        });
    });

    async function handleSave() {
        const outputResult: Record<string, string> = {};
        outputsSchema.forEach(out => {
            const rawVal = (outputAliasMap[out.key] || "").trim();
            if (rawVal) {
                outputResult[out.key] = rawVal;
            }
        });
        await onSave(outputResult);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; box-sizing: border-box; padding: 16px; gap: 12px;">
    <!-- 头部标题 -->
    <div style="font-size: 13px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 6px;">
            <span>📤</span>
            <span>配置命令出参 (Output Mapping) <span style="color: var(--indexos-accent-primary);">({commandName})</span></span>
        </div>
        <span style="font-family: monospace; font-size: 11px; opacity: 0.6;">{commandId}</span>
    </div>

    <!-- 出参映射配置列表 -->
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 4px;">
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
                    </div>

                    <input 
                        type="text" 
                        class="b3-input fn__block" 
                        style="font-family: monospace; box-sizing: border-box; width: 100%;"
                        placeholder="如: &#123;&#123;var.createdblock&#125;&#125; 或 &#123;&#123;var.supertags&#125;&#125;"
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

    <!-- 底部按钮 -->
    <div style="display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 8px; border-top: 1px solid var(--indexos-border-divider);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave}>保存配置</button>
    </div>
</div>
