<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { post } from "../../../../shared/api-client/request";
    import { plugin } from "../../../../shared/utils";
    import { backgroundScheduler, calculateNextCronTimestamp } from "../../background/background-scheduler";
    import CommandSequenceEditor from "../../composite/CommandSequenceEditor.svelte";
    import { generateRuleScript, parseRuleScript } from "../../composite/script-dsl";

    export let dialog: any;

    export interface AutomationRule {
        id: string;
        name: string;
        enabled: boolean;
        eventType: "cron" | "block_content_changed" | "block_attribute_changed" | "doc_opened" | "task_completed" | "tag_created" | "tag_removed";
        cronExpr?: string;
        commandIds: string[];
        commandParams?: Record<string, Record<string, string>>;
    }

    let loading = true;
    let viewMode: "visual" | "code" = "visual";

    let rules: AutomationRule[] = [];
    let selectedRuleId: string | null = null;
    let activeRuleScript = "";

    // 友好自然语言预设配置
    let presetMode: "daily" | "weekly" | "monthly" | "hourly" | "interval" = "daily";
    let selectedTimeHour = "09";
    let selectedTimeMin = "00";
    let selectedDayOfWeek = "1"; // 1 = Monday
    let selectedDayOfMonth = "1"; // 1 = 1st of month
    let selectedIntervalMins = "15";

    $: activeRule = rules.find(r => r.id === selectedRuleId) || null;

    // 仅在切换当前选中的任务 ID 时重置解析表单，避免打字时被反向重置
    let prevSelectedId: string | null = null;
    $: if (selectedRuleId !== prevSelectedId) {
        prevSelectedId = selectedRuleId;
        if (activeRule) {
            activeRuleScript = compileSingleRuleToScript(activeRule);
            if (activeRule.eventType === "cron" && activeRule.cronExpr) {
                parseCronToPresetUI(activeRule.cronExpr);
            }
        }
    }

    $: nextExecutionTimeStr = activeRule && activeRule.eventType === "cron" && activeRule.cronExpr
        ? new Date(calculateNextCronTimestamp(activeRule.cronExpr)).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            weekday: "short"
        })
        : "";

    const EVENT_TYPES = [
        { id: "cron", label: "⏱️ 定时与周期计划 (每日 / 每周 / 每月 / 定期)" },
        { id: "block_content_changed", label: "✍️ 块内容变动时" },
        { id: "block_attribute_changed", label: "🏷️ 块属性变动时" },
        { id: "doc_opened", label: "📄 打开新文档时" },
        { id: "task_completed", label: "☑ 任务标记完成时" },
        { id: "tag_created", label: "⚡ 打上标签时" },
        { id: "tag_removed", label: "🗑️ 移除标签时" }
    ];

    onMount(async () => {
        await loadScriptAndRules();
    });

    function parseCronToPresetUI(cron: string) {
        if (!cron) return;
        const parts = cron.trim().split(/\s+/);
        if (parts.length >= 5) {
            const [min, hour, day, month, week] = parts;
            if (min.startsWith("*/")) {
                presetMode = "interval";
                selectedIntervalMins = min.replace("*/", "");
                return;
            }
            if (min === "0" && hour === "*") {
                presetMode = "hourly";
                return;
            }
            if (week !== "*" && week !== "?") {
                presetMode = "weekly";
                selectedDayOfWeek = week;
                selectedTimeHour = hour.padStart(2, "0");
                selectedTimeMin = min.padStart(2, "0");
                return;
            }
            if (day !== "*" && day !== "?") {
                presetMode = "monthly";
                selectedDayOfMonth = day;
                selectedTimeHour = hour.padStart(2, "0");
                selectedTimeMin = min.padStart(2, "0");
                return;
            }
            if (day === "*" && month === "*" && week === "*") {
                presetMode = "daily";
                selectedTimeHour = hour.padStart(2, "0");
                selectedTimeMin = min.padStart(2, "0");
                return;
            }
        }
        presetMode = "daily";
    }

    function applyPresetToCron() {
        if (!activeRule || activeRule.eventType !== "cron") return;
        if (presetMode === "daily") {
            activeRule.cronExpr = `${parseInt(selectedTimeMin, 10)} ${parseInt(selectedTimeHour, 10)} * * *`;
        } else if (presetMode === "weekly") {
            activeRule.cronExpr = `${parseInt(selectedTimeMin, 10)} ${parseInt(selectedTimeHour, 10)} * * ${selectedDayOfWeek}`;
        } else if (presetMode === "monthly") {
            activeRule.cronExpr = `${parseInt(selectedTimeMin, 10)} ${parseInt(selectedTimeHour, 10)} ${selectedDayOfMonth} * *`;
        } else if (presetMode === "hourly") {
            activeRule.cronExpr = `0 * * * *`;
        } else if (presetMode === "interval") {
            activeRule.cronExpr = `*/${selectedIntervalMins} * * * *`;
        }
        rules = [...rules];
        activeRuleScript = compileSingleRuleToScript(activeRule);
    }

    function compileSingleRuleToScript(r: AutomationRule): string {
        const lines = [`// ── Rule: ${r.name}`];
        if (r.eventType === "cron") {
            lines.push(`// [Cron: ${r.cronExpr || "0 9 * * *"}]`);
        } else {
            lines.push(`// [Condition: event: ${r.eventType || "block_content_changed"}]`);
        }

        const dispatchLines = (r.commandIds || []).map(cmdId => {
            const params = r.commandParams?.[cmdId] || {};
            return Object.keys(params).length > 0
                ? `await dispatch("${cmdId}", ${JSON.stringify(params)});`
                : `await dispatch("${cmdId}");`;
        });

        if (dispatchLines.length > 0) {
            lines.push(...dispatchLines);
        } else {
            lines.push(`// await dispatch("example.command");`);
        }

        return lines.join("\n");
    }

    function ruleSequenceScript(r: AutomationRule): string {
        const ids = r.commandIds || [];
        return generateRuleScript("", ids.map(id => ({ commandRef: id, params: r.commandParams?.[id] || {} })));
    }

    function applyRuleScript(r: AutomationRule, script: string) {
        const rule = parseRuleScript(script);
        const ids = rule ? rule.commands.map(c => c.commandRef) : [];
        const params: Record<string, Record<string, string>> = {};
        if (rule) {
            for (const c of rule.commands) params[c.commandRef] = { ...c.params };
        }
        r.commandIds = ids;
        r.commandParams = params;
    }

    function compileAllRulesToTsScript(ruleList: AutomationRule[]): string {
        const scriptLines = [
            "// ─── IndexOS Background Engine Automation Script ───",
            "// 集中自动化任务脚本：支持定时周期与全局事件响应",
            ""
        ];
        for (const r of ruleList) {
            if (!r.enabled) continue;
            scriptLines.push(compileSingleRuleToScript(r));
            scriptLines.push("");
        }
        return scriptLines.join("\n");
    }

    function parseTsScriptToRules(script: string): AutomationRule[] {
        const parsedRules: AutomationRule[] = [];
        if (!script) return parsedRules;

        const extractDispatchCommands = (fullText: string) => {
            const ids: string[] = [];
            const params: Record<string, Record<string, string>> = {};
            const re = /dispatch\s*\(\s*["']([^"']+)["']\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;
            let m;
            while ((m = re.exec(fullText)) !== null) {
                const id = m[1];
                ids.push(id);
                if (m[2]) {
                    try {
                        const parsed = JSON.parse(m[2]);
                        const clean: Record<string, string> = {};
                        for (const [k, v] of Object.entries(parsed)) clean[k] = String(v);
                        params[id] = clean;
                    } catch {}
                }
            }
            return { ids, params };
        };

        const blocks = script.split(/\/\/\s*── Rule:/i);
        let index = 0;

        for (const rawBlock of blocks) {
            const trimmed = rawBlock.trim();
            if (!trimmed || trimmed.startsWith("// ─── IndexOS")) continue;

            index++;
            const lines = trimmed.split("\n");
            const ruleName = lines[0].trim() || `自动化规则 #${index}`;
            const fullText = lines.slice(1).join("\n");

            const cronMatch = /\/\/\s*\[Cron:\s*([^\]]+)\]/i.exec(fullText);
            if (cronMatch) {
                const { ids, params } = extractDispatchCommands(fullText);
                parsedRules.push({
                    id: "rule_" + Date.now() + "_" + index,
                    name: ruleName,
                    enabled: true,
                    eventType: "cron",
                    cronExpr: cronMatch[1].trim(),
                    commandIds: ids,
                    commandParams: params
                });
                continue;
            }

            const condMatch = /\/\/\s*\[Condition:\s*([^\]]*)\]/i.exec(fullText);
            if (condMatch) {
                const evMatch = /event:\s*([^\]\)]+)/i.exec(condMatch[1] || fullText);
                const { ids, params } = extractDispatchCommands(fullText);
                parsedRules.push({
                    id: "rule_" + Date.now() + "_" + index,
                    name: ruleName,
                    enabled: true,
                    eventType: (evMatch ? evMatch[1].trim() : "block_content_changed") as any,
                    commandIds: ids,
                    commandParams: params
                });
            }
        }

        return parsedRules;
    }

    async function loadScriptAndRules() {
        loading = true;
        try {
            let storedVal = "";
            if (plugin) {
                const localData = await plugin.loadData("background-engine.json");
                if (typeof localData === "string") storedVal = localData;
                else if (localData?.rules) storedVal = String(localData.rules);
            }

            const blockId = await backgroundScheduler.resolveTargetCommandDbBlockId();
            if (blockId) {
                try {
                    const res = await post("/api/attr/getBlockAttrs", { id: blockId });
                    if (res?.["custom-indexos-background-rules"]) {
                        storedVal = res["custom-indexos-background-rules"];
                    }
                } catch {}
            }

            rules = parseTsScriptToRules(storedVal);
            if (rules.length > 0 && !selectedRuleId) {
                selectedRuleId = rules[0].id;
            }
        } catch (e) {
            console.error("[GlobalAutomation] Failed to load script:", e);
            rules = [];
        } finally {
            loading = false;
        }
    }

    function syncActiveRuleFromCode() {
        if (!activeRule) return;
        const parsed = parseTsScriptToRules(activeRuleScript);
        if (parsed.length > 0) {
            const p = parsed[0];
            activeRule.cronExpr = p.cronExpr || activeRule.cronExpr;
            activeRule.eventType = p.eventType || activeRule.eventType;
            activeRule.commandIds = p.commandIds || activeRule.commandIds;
            activeRule.commandParams = p.commandParams || activeRule.commandParams;
            rules = [...rules];
        }
    }

    async function saveScript() {
        try {
            if (viewMode === "code") {
                syncActiveRuleFromCode();
            }
            const finalScriptToSave = compileAllRulesToTsScript(rules);
            await backgroundScheduler.saveRules(finalScriptToSave);

            showMessage("✓ 后台自动化规则已保存生效！");
            if (dialog) dialog.destroy();
        } catch (e: any) {
            console.error("[GlobalAutomation] Save script error:", e);
            showMessage(`保存配置失败: ${e.message}`, 3000, "error");
        }
    }

    function addRule() {
        const newId = "rule_" + Date.now();
        const newRule: AutomationRule = {
            id: newId,
            name: "新建自动化规则",
            enabled: true,
            eventType: "cron",
            cronExpr: "0 9 * * *",
            commandIds: []
        };
        rules = [...rules, newRule];
        selectedRuleId = newId;
    }

    function deleteRule(id: string, e: MouseEvent) {
        e.stopPropagation();
        rules = rules.filter(r => r.id !== id);
        if (selectedRuleId === id) {
            selectedRuleId = rules.length > 0 ? rules[0].id : null;
        }
    }
</script>

<div class="b3-dialog__content" style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box; padding: 14px; gap: 10px;">
    <!-- 头部标题与控制 -->
    <div style="display: flex; align-items: center; justify-content: space-between; background: var(--b3-theme-surface); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--b3-border-color); flex-shrink: 0;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--b3-theme-on-background); display: flex; align-items: center; gap: 6px;">
                <span>⚡ 后台执行控制中心 (Background Engine)</span>
                <span style="font-size: 10px; color: var(--indexos-accent-primary); font-family: monospace; background: var(--indexos-weak-accent); padding: 2px 6px; border-radius: 3px;">Precision & Reactive</span>
            </div>
            <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); opacity: 0.8;">
                支持定时周期与全局事件响应，精准休眠唤醒，零持续轮询开销。
            </div>
        </div>

        <div style="display: flex; gap: 6px; align-items: center;">
            <div style="display: flex; background: var(--b3-theme-background); padding: 2px; border-radius: 4px; border: 1px solid var(--b3-border-color);">
                <button
                    class="b3-button {viewMode === 'visual' ? 'b3-button--primary' : 'b3-button--text'}"
                    style="font-size: 11px; padding: 3px 8px; height: 24px;"
                    on:click={() => { viewMode = "visual"; }}
                >🎨 可视化</button>
                <button
                    class="b3-button {viewMode === 'code' ? 'b3-button--primary' : 'b3-button--text'}"
                    style="font-size: 11px; padding: 3px 8px; height: 24px;"
                    on:click={() => { viewMode = "code"; }}
                >📝 源码</button>
            </div>

            <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 3px 10px;" on:click={addRule}>+ 新建规则</button>
        </div>
    </div>

    <!-- 主布局：左侧任务列表，右侧配置 -->
    <div style="display: flex; flex: 1; gap: 12px; min-height: 0;">
        <!-- 左侧任务列表 -->
        <div style="width: 210px; flex-shrink: 0; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; background: var(--b3-theme-surface);">
            {#if loading}
                <div style="text-align: center; opacity: 0.5; padding: 20px; font-size: 11px;">加载规则列表中...</div>
            {:else if rules.length === 0}
                <div style="text-align: center; opacity: 0.5; padding: 30px 0; font-size: 11px;">
                    暂无后台规则<br>点击右上角【+ 新建规则】
                </div>
            {:else}
                {#each rules as r}
                    <div
                        role="button"
                        tabindex="0"
                        class="b3-list-item {selectedRuleId === r.id ? 'b3-list-item--focus' : ''}"
                        style="padding: 8px 10px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
                        on:click={() => { selectedRuleId = r.id; }}
                        on:keydown={e => e.key === 'Enter' && (selectedRuleId = r.id)}
                    >
                        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                            <span style="font-size: 12px;">{r.eventType === 'cron' ? '⏱️' : '⚡'}</span>
                            <span style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: {selectedRuleId === r.id ? '600' : 'normal'};">{r.name}</span>
                        </div>
                        <span
                            role="button"
                            tabindex="0"
                            style="font-size: 12px; opacity: 0.4; cursor: pointer;"
                            title="删除规则"
                            on:click={(e) => deleteRule(r.id, e)}
                            on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && deleteRule(r.id, e)}
                        >✕</span>
                    </div>
                {/each}
            {/if}
        </div>

        <!-- 右侧配置面板 -->
        <div style="flex: 1; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: var(--b3-theme-surface); overflow-y: auto;">
            {#if !activeRule}
                <div style="text-align: center; opacity: 0.4; padding: 60px 0; font-size: 12px;">请从左侧选择一个规则或新建规则</div>
            {:else}
                <!-- 顶部任务名称与启用开关 -->
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="text" class="b3-text-field" style="flex: 1; font-weight: 600; font-size: 13px;" bind:value={activeRule.name} placeholder="规则名称" />
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; flex-shrink: 0;">
                        <input type="checkbox" class="b3-switch fn__flex-center" bind:checked={activeRule.enabled} />
                        <span style="font-weight: 600;">{activeRule.enabled ? '已启用' : '已暂停'}</span>
                    </label>
                </div>

                {#if viewMode === "visual"}
                    <!-- 触发条件设置 -->
                    <div style="display: flex; flex-direction: column; gap: 8px; background: var(--b3-theme-background); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--b3-border-color);">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-weight: 600; font-size: 12px; color: var(--b3-theme-on-background);">⚡ 触发条件：</span>
                            {#if activeRule.eventType === "cron" && nextExecutionTimeStr}
                                <span style="font-size: 11px; color: var(--indexos-accent-primary); font-family: monospace;">
                                    ⏳ 下次预计: {nextExecutionTimeStr}
                                </span>
                            {/if}
                        </div>

                        <!-- 触发类型下拉列表 (定时 + 各类事件整合) -->
                        <select class="b3-select" style="font-size: 12px; height: 32px;" bind:value={activeRule.eventType}>
                            {#each EVENT_TYPES as ev}
                                <option value={ev.id}>{ev.label}</option>
                            {/each}
                        </select>

                        <!-- 当触发条件为“定时”时，展示自然语言周期配置 -->
                        {#if activeRule.eventType === "cron"}
                            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding-top: 8px; border-top: 1px dashed var(--b3-border-color);">
                                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                    <select class="b3-select" style="font-size: 11px; height: 30px;" bind:value={presetMode} on:change={applyPresetToCron}>
                                        <option value="daily">📅 每天 (Daily)</option>
                                        <option value="weekly">🗓️ 每周 (Weekly)</option>
                                        <option value="monthly">📆 每月 (Monthly)</option>
                                        <option value="hourly">⏰ 每小时 (Hourly)</option>
                                        <option value="interval">⏳ 每 N 分钟 (Interval)</option>
                                    </select>

                                    {#if presetMode === "weekly"}
                                        <select class="b3-select" style="font-size: 11px; height: 30px;" bind:value={selectedDayOfWeek} on:change={applyPresetToCron}>
                                            <option value="1">周一</option>
                                            <option value="2">周二</option>
                                            <option value="3">周三</option>
                                            <option value="4">周四</option>
                                            <option value="5">周五</option>
                                            <option value="6">周六</option>
                                            <option value="0">周日</option>
                                        </select>
                                    {/if}

                                    {#if presetMode === "monthly"}
                                        <div style="display: flex; align-items: center; gap: 4px;">
                                            <span>每月</span>
                                            <select class="b3-select" style="font-size: 11px; height: 30px;" bind:value={selectedDayOfMonth} on:change={applyPresetToCron}>
                                                {#each Array.from({ length: 31 }, (_, i) => i + 1) as d}
                                                    <option value={String(d)}>{d} 日</option>
                                                {/each}
                                            </select>
                                        </div>
                                    {/if}

                                    {#if presetMode === "daily" || presetMode === "weekly" || presetMode === "monthly"}
                                        <div style="display: flex; align-items: center; gap: 4px;">
                                            <input 
                                                type="number" 
                                                min="0" 
                                                max="23" 
                                                class="b3-text-field" 
                                                style="width: 58px; min-width: 58px; font-size: 13px; text-align: center; height: 30px; line-height: normal; box-sizing: border-box; padding: 2px;" 
                                                bind:value={selectedTimeHour} 
                                                on:input={applyPresetToCron} 
                                            />
                                            <span style="font-weight: bold;">:</span>
                                            <input 
                                                type="number" 
                                                min="0" 
                                                max="59" 
                                                class="b3-text-field" 
                                                style="width: 58px; min-width: 58px; font-size: 13px; text-align: center; height: 30px; line-height: normal; box-sizing: border-box; padding: 2px;" 
                                                bind:value={selectedTimeMin} 
                                                on:input={applyPresetToCron} 
                                            />
                                        </div>
                                    {/if}

                                    {#if presetMode === "interval"}
                                        <div style="display: flex; align-items: center; gap: 4px;">
                                            <span>每隔</span>
                                            <input 
                                                type="number" 
                                                min="1" 
                                                max="120" 
                                                class="b3-text-field" 
                                                style="width: 60px; min-width: 60px; font-size: 12px; text-align: center; height: 30px; line-height: normal; box-sizing: border-box; padding: 2px;" 
                                                bind:value={selectedIntervalMins} 
                                                on:input={applyPresetToCron} 
                                            />
                                            <span>分钟执行</span>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- 命令序列编排 -->
                    <div style="display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0;">
                        <div style="font-weight: 600; font-size: 12px; color: var(--b3-theme-on-background);">
                            📦 触发时执行的命令序列 (勾选命令并在右侧配置参数):
                        </div>
                        <div style="flex: 1; min-height: 300px; display: flex; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 8px;">
                            <CommandSequenceEditor
                                key={selectedRuleId}
                                initialScript={ruleSequenceScript(activeRule)}
                                showName={false}
                                onScriptChange={s => applyRuleScript(activeRule, s)}
                            />
                        </div>
                    </div>
                {:else}
                    <!-- 源码模式 -->
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 6px; min-height: 0;">
                        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); font-weight: 600;">
                            📝 正在编辑【{activeRule.name}】的规则 TypeScript 源码：
                        </div>
                        <textarea
                            class="b3-text-field"
                            style="flex: 1; font-family: var(--b3-font-family-code, monospace); font-size: 12px; line-height: 1.5; padding: 10px; white-space: pre; background: var(--b3-theme-background);"
                            bind:value={activeRuleScript}
                            on:input={syncActiveRuleFromCode}
                            placeholder="// 在此编辑当前任务独立的 TS 脚本源码"
                        ></textarea>
                    </div>
                {/if}
            {/if}
        </div>
    </div>

    <!-- 底部保存按钮 -->
    <div style="display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 8px; border-top: 1px solid var(--b3-border-color);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--primary" on:click={saveScript}>保存规则</button>
    </div>
</div>
