<script lang="ts">
    import { onMount } from "svelte";

    export let dialog: any;
    export let commandName: string;
    export let commandId: string;
    export let currentValue: string;
    export let onSave: (updatedValue: string) => Promise<void>;

    let triggerMode: "cron" | "condition" | "system" | "none" = "none";
    
    // Form fields
    let cronPreset: string = "0 2 * * *";
    let customCron: string = "0 2 * * *";
    let conditionSql: string = "SELECT count(*) FROM blocks WHERE type='code'";
    let debounceMs: number = 3000;
    let systemName: string = "GlobalSystem";
    let tickMs: number = 5000;

    let isCustomCron = false;

    const CRON_PRESETS = [
        { label: "每天凌晨 02:00", value: "0 2 * * *" },
        { label: "每小时整点", value: "0 * * * *" },
        { label: "每 15 分钟", value: "*/15 * * * *" },
        { label: "每周一凌晨 03:00", value: "0 3 * * 1" },
        { label: "自定义 Cron 表达式", value: "custom" }
    ];

    onMount(() => {
        parseCurrentValue();
    });

    function parseCurrentValue() {
        const text = (currentValue || "").trim();
        if (!text) {
            triggerMode = "none";
            return;
        }

        const cronMatch = /\/\/\s*\[Cron:\s*([^\]]+)\]/i.exec(text);
        if (cronMatch) {
            triggerMode = "cron";
            const val = cronMatch[1].trim();
            const matchedPreset = CRON_PRESETS.find(p => p.value === val);
            if (matchedPreset) {
                cronPreset = val;
                isCustomCron = false;
            } else {
                cronPreset = "custom";
                customCron = val;
                isCustomCron = true;
            }
            return;
        }

        const condMatch = /\/\/\s*\[Condition:\s*([^\]]+)\]/i.exec(text);
        if (condMatch) {
            triggerMode = "condition";
            conditionSql = condMatch[1].trim();
            return;
        }

        const sysMatch = /\/\/\s*\[System:\s*([^\]]+)\]/i.exec(text);
        if (sysMatch) {
            triggerMode = "system";
            systemName = sysMatch[1].trim();
            return;
        }
    }

    function handleCronPresetChange(e: Event) {
        const val = (e.target as HTMLSelectElement).value;
        if (val === "custom") {
            isCustomCron = true;
        } else {
            isCustomCron = false;
            cronPreset = val;
            customCron = val;
        }
    }

    async function handleSave() {
        let finalRule = "";
        const finalCron = isCustomCron ? customCron.trim() : cronPreset;

        if (triggerMode === "cron") {
            finalRule = `// [Cron:${finalCron}] -> 执行 ${commandName}\nif (triggerType === 'cron') {\n    await dispatch('${commandId}');\n}`;
        } else if (triggerMode === "condition") {
            finalRule = `// [Condition:${conditionSql.trim()}](debounce:${debounceMs}) -> 触发 ${commandName}\nif (triggerType === 'condition') {\n    await dispatch('${commandId}');\n}`;
        } else if (triggerMode === "system") {
            finalRule = `// [System:${systemName.trim()}](tick:${tickMs}) -> 守护 ${commandName}\nif (triggerType === 'system') {\n    await dispatch('${commandId}');\n}`;
        } else {
            finalRule = "";
        }

        await onSave(finalRule);
        if (dialog) dialog.destroy();
    }

    function handleClear() {
        triggerMode = "none";
        handleSave();
    }
</script>

<div class="b3-dialog__content" style="display: flex; flex-direction: column; gap: 12px; height: 100%; box-sizing: border-box; padding: 12px;">
    <!-- 头部说明 -->
    <div style="display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; background: var(--b3-theme-surface); padding: 10px; border-radius: 6px; border: 1px solid var(--b3-border-color);">
        <div style="font-size: 13px; font-weight: 600; color: var(--b3-theme-on-background); display: flex; align-items: center; justify-content: space-between;">
            <span>配置后台执行规则</span>
            <span style="font-size: 10px; color: var(--indexos-accent-primary); font-family: monospace; background: var(--indexos-weak-accent); padding: 2px 6px; border-radius: 3px;">Kernel 3.7+</span>
        </div>
        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); opacity: 0.8; font-family: monospace;">
            指令: {commandName} ({commandId})
        </div>
    </div>

    <!-- 触发模式 Tab 选择器 -->
    <div style="display: flex; gap: 6px; flex-shrink: 0; border-bottom: 1px solid var(--b3-border-color); padding-bottom: 8px;">
        <button
            class="b3-button {triggerMode === 'none' ? 'b3-button--primary' : 'b3-button--text'}"
            style="font-size: 11px; padding: 4px 8px;"
            on:click={() => triggerMode = "none"}
        >
            无后台任务
        </button>
        <button
            class="b3-button {triggerMode === 'cron' ? 'b3-button--primary' : 'b3-button--text'}"
            style="font-size: 11px; padding: 4px 8px;"
            on:click={() => triggerMode = "cron"}
        >
            ⏱️ Cron 定时
        </button>
        <button
            class="b3-button {triggerMode === 'condition' ? 'b3-button--primary' : 'b3-button--text'}"
            style="font-size: 11px; padding: 4px 8px;"
            on:click={() => triggerMode = "condition"}
        >
            🔍 Condition 条件
        </button>
        <button
            class="b3-button {triggerMode === 'system' ? 'b3-button--primary' : 'b3-button--text'}"
            style="font-size: 11px; padding: 4px 8px;"
            on:click={() => triggerMode = "system"}
        >
            ⚡ System 持续
        </button>
    </div>

    <!-- 模式内容配置 -->
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
        {#if triggerMode === "none"}
            <div style="text-align: center; padding: 30px; opacity: 0.5; font-size: 12px;">
                当前命令未配置任何后台定时或条件守护规则。
            </div>
        {:else if triggerMode === "cron"}
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
                <label style="font-weight: 600; color: var(--b3-theme-on-background);">选择 Cron 预设周期：</label>
                <select class="b3-select" on:change={handleCronPresetChange} value={isCustomCron ? "custom" : cronPreset}>
                    {#each CRON_PRESETS as preset}
                        <option value={preset.value}>{preset.label} ({preset.value})</option>
                    {/each}
                </select>

                {#if isCustomCron}
                    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                        <label style="font-size: 11px; opacity: 0.8;">自定义 Cron 表达式 (5/6 位)：</label>
                        <input type="text" class="b3-text-field" bind:value={customCron} placeholder="例如: 0 2 * * *" />
                    </div>
                {/if}
            </div>
        {:else if triggerMode === "condition"}
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
                <label style="font-weight: 600; color: var(--b3-theme-on-background);">触发条件 SQL / JS 表达式：</label>
                <textarea
                    class="b3-text-field"
                    style="height: 90px; font-family: monospace; font-size: 11px;"
                    bind:value={conditionSql}
                    placeholder="例如: SELECT count(*) FROM blocks WHERE type='code'"
                ></textarea>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                    <span style="font-size: 11px; opacity: 0.8;">节流防抖 (毫秒):</span>
                    <input type="number" class="b3-text-field" style="width: 100px;" bind:value={debounceMs} />
                </div>
            </div>
        {:else if triggerMode === "system"}
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
                <label style="font-weight: 600; color: var(--b3-theme-on-background);">System 系统名称：</label>
                <input type="text" class="b3-text-field" bind:value={systemName} placeholder="例如: GlobalTimerSystem" />

                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                    <span style="font-size: 11px; opacity: 0.8;">心跳轮询间隔 (毫秒):</span>
                    <input type="number" class="b3-text-field" style="width: 100px;" bind:value={tickMs} />
                </div>
            </div>
        {/if}
    </div>

    <!-- 底部按钮操作栏 -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; padding-top: 8px; border-top: 1px solid var(--b3-border-color);">
        <button class="b3-button b3-button--cancel" on:click={handleClear}>
            清空规则
        </button>

        <div style="display: flex; gap: 8px;">
            <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>
                取消
            </button>
            <button class="b3-button b3-button--primary" on:click={handleSave}>
                保存配置
            </button>
        </div>
    </div>
</div>
