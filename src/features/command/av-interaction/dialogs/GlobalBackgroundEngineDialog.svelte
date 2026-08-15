<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { post } from "../../../../shared/api-client/request";
    import { plugin } from "../../../../shared/utils";
    import { getCommandAvId } from "../../registration";
    import { commandRegistry } from "../../registry/command-registry";
    import { backgroundScheduler } from "../../background/background-scheduler";
    import CommandSequenceEditor from "../../pipeline/CommandSequenceEditor.svelte";
    import { generateRuleScript, parseRuleScript } from "../../pipeline/script-dsl";

    export let dialog: any;

    export interface AutomationRule {
        id: string;
        name: string;
        type: "cron" | "condition" | "system";
        enabled: boolean;
        cronExpr?: string;
        commandIds?: string[];
        eventType?: "block_content_changed" | "block_attribute_changed" | "doc_opened" | "task_completed";
        boundCommands?: string[];
        commandParams?: Record<string, Record<string, string>>;
        geekScript?: string;
        tickRateMs?: number;
    }

    let loading = true;
    let viewMode: "visual" | "code" = "visual";

    let rules: AutomationRule[] = [];
    let selectedRuleId: string | null = null;
    let activeTab: "cron" | "condition" | "system" = "cron";
    let activeRuleScript: string = "";

    let availableCommands: { id: string; name: string }[] = [];

    $: activeRule = rules.find(r => r.id === selectedRuleId) || null;

    // 当切换选中的规则时，同步更新单任务源码编辑器的内容
    $: if (activeRule) {
        activeRuleScript = compileSingleRuleToScript(activeRule);
        activeTab = activeRule.type;
    }

    const CRON_PRESETS = [
        { label: "每天凌晨 02:00", value: "0 2 * * *" },
        { label: "每小时整点", value: "0 * * * *" },
        { label: "每 15 分钟", value: "*/15 * * * *" },
        { label: "每 1 分钟测试", value: "*/1 * * * *" }
    ];

    const EVENT_TYPES = [
        { id: "block_content_changed", label: "块内容变动时" },
        { id: "block_attribute_changed", label: "块属性变动时" },
        { id: "doc_opened", label: "打开新文档时" },
        { id: "task_completed", label: "任务标记完成时" }
    ];

    onMount(async () => {
        availableCommands = commandRegistry.getAllCommands().map(c => ({ id: c.id, name: c.name }));
        await loadScriptAndRules();
    });

    async function resolveHostBlockId(): Promise<string> {
        const commandAvId = getCommandAvId();

        // 1. 尝试直接从 DOM 节点抓取 NodeAttributeView 的物理 data-node-id (真正的物理 Block ID)
        if (commandAvId) {
            const avEl = document.querySelector(`[data-av-id="${commandAvId}"]`);
            if (avEl) {
                const nodeId = avEl.getAttribute("data-node-id") || avEl.getAttribute("data-id");
                if (nodeId && nodeId !== commandAvId) {
                    return nodeId;
                }
            }
        }

        // 2. 通过思源内核 API /api/query/sql 从 blocks 表查询 type = 'av' 对应的物理 Block ID
        if (commandAvId) {
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${commandAvId}%' OR ial LIKE '%${commandAvId}%') LIMIT 1`
                });
                const rows: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
                if (rows.length > 0) {
                    const targetBlockId = String(rows[0].id || "");
                    if (targetBlockId && targetBlockId !== commandAvId) {
                        return targetBlockId;
                    }
                }
            } catch (e) {
                console.warn("[GlobalAutomation] Failed sql query for physical av block:", e);
            }
        }

        // 3. 从 attributes 表反查 custom-index-command-db 记录的物理 block_id
        try {
            const res = await post("/api/query/sql", {
                stmt: `SELECT block_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`
            });
            const rows: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
            if (rows.length > 0) {
                const targetBlockId = String(rows[0].block_id || "");
                if (targetBlockId && targetBlockId !== commandAvId) {
                    return targetBlockId;
                }
            }
        } catch (_) {}

        return "";
    }

    // 针对单条规则编译为 TypeScript 源码
    function compileSingleRuleToScript(r: AutomationRule): string {
        if (!r) return "";
        let lines = [`// ── Rule: ${r.name}`];

        const compileDispatchLines = (ids: string[]): string[] => {
            return (ids || []).map(cmdId => {
                const params = r.commandParams?.[cmdId] || {};
                const hasParams = Object.keys(params).length > 0;
                return hasParams
                    ? `await dispatch("${cmdId}", ${JSON.stringify(params)});`
                    : `await dispatch("${cmdId}");`;
            });
        };

        if (r.type === "cron") {
            lines.push(`// [Cron: ${r.cronExpr || "0 2 * * *"}]`);
            const dispatchLines = compileDispatchLines(r.commandIds || []);
            if (dispatchLines.length > 0) {
                lines.push(...dispatchLines);
            } else {
                lines.push(`// await dispatch("example.command");`);
            }
        } else if (r.type === "condition") {
            lines.push(`// [Condition: event: ${r.eventType || "block_content_changed"}]`);
            const dispatchLines = compileDispatchLines(r.boundCommands || []);
            if (dispatchLines.length > 0) {
                lines.push(...dispatchLines);
            } else {
                lines.push(`// await dispatch("example.command");`);
            }
        } else if (r.type === "system") {
            lines.push(`// [System: ${r.name}] (tick: ${r.tickRateMs || 5000})`);
            if (r.geekScript) {
                lines.push(r.geekScript.trim());
            } else {
                lines.push(`if (state.tickCount % 60 === 0) {\n    await dispatch("index.showToast");\n}`);
            }
        }

        return lines.join("\n");
    }

    /** 从规则脚本块中提取 dispatch 命令与参数 */
    function extractCommands(fullText: string): { ids: string[]; params: Record<string, Record<string, string>> } {
        const ids: string[] = [];
        const params: Record<string, Record<string, string>> = {};
        const re = /dispatch\s*\(\s*["']([^"']+)["']\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;
        let m;
        while ((m = re.exec(fullText)) !== null) {
            const id = m[1];
            ids.push(id);
            if (m[2]) {
                try {
                    const parsed = JSON.parse(m[2]) as Record<string, unknown>;
                    const clean: Record<string, string> = {};
                    for (const [k, v] of Object.entries(parsed)) clean[k] = String(v);
                    params[id] = clean;
                } catch { /* ignore */ }
            }
        }
        return { ids, params };
    }

    /** 当前规则的命令序列脚本（喂给 CommandSequenceEditor） */
    function ruleSequenceScript(r: AutomationRule): string {
        const ids = r.type === "cron" ? (r.commandIds || []) : (r.boundCommands || []);
        return generateRuleScript("", ids.map(id => ({ commandRef: id, params: r.commandParams?.[id] || {} })));
    }

    /** 编辑器脚本变化 → 同步回规则 */
    function applyRuleScript(r: AutomationRule, script: string) {
        const rule = parseRuleScript(script);
        const ids = rule ? rule.commands.map(c => c.commandRef) : [];
        const params: Record<string, Record<string, string>> = {};
        if (rule) {
            for (const c of rule.commands) params[c.commandRef] = { ...c.params };
        }
        if (r.type === "cron") {
            r.commandIds = ids;
        } else {
            r.boundCommands = ids;
        }
        r.commandParams = params;
    }

    // 将全量规则合并编译为完整 TS 脚本
    function compileAllRulesToTsScript(ruleList: AutomationRule[]): string {
        let scriptLines = [
            "// ─── IndexOS Background Engine Automation Script ───",
            "// 此脚本由集中控制面板自动生成，支持按任务项目与源码双向交互",
            ""
        ];

        for (const r of ruleList) {
            if (!r.enabled) continue;
            scriptLines.push(compileSingleRuleToScript(r));
            scriptLines.push("");
        }

        return scriptLines.join("\n");
    }

    // 解析 TS 源码为全量规则列表
    function parseTsScriptToRules(script: string): AutomationRule[] {
        const parsedRules: AutomationRule[] = [];
        if (!script) return parsedRules;

        const blocks = script.split(/\/\/\s*── Rule:/i);
        let index = 0;

        for (const rawBlock of blocks) {
            const trimmed = rawBlock.trim();
            if (!trimmed || trimmed.startsWith("// ─── IndexOS")) continue;

            index++;
            const lines = trimmed.split("\n");
            const ruleName = lines[0].trim() || `任务 #${index}`;
            const fullText = lines.slice(1).join("\n");

            // 1. Cron
            const cronMatch = /\/\/\s*\[Cron:\s*([^\]]+)\]/i.exec(fullText);
            if (cronMatch) {
                const { ids: commandIds, params: commandParams } = extractCommands(fullText);
                parsedRules.push({
                    id: "rule_" + Date.now() + "_" + index,
                    name: ruleName,
                    type: "cron",
                    enabled: true,
                    cronExpr: cronMatch[1].trim(),
                    commandIds,
                    commandParams
                });
                continue;
            }

            // 2. Condition
            const condMatch = /\/\/\s*\[Condition:\s*([^\]]*)\]/i.exec(fullText);
            if (condMatch) {
                const evMatch = /event:\s*([^\]\)]+)/i.exec(condMatch[1] || fullText);

                const { ids: boundCommands, params: commandParams } = extractCommands(fullText);

                parsedRules.push({
                    id: "rule_" + Date.now() + "_" + index,
                    name: ruleName,
                    type: "condition",
                    enabled: true,
                    boundCommands,
                    commandParams,
                    eventType: (evMatch ? evMatch[1].trim() : "block_content_changed") as any
                });
                continue;
            }

            // 3. System
            const sysMatch = /\/\/\s*\[System:\s*([^\]]+)\]/i.exec(fullText);
            if (sysMatch) {
                const tickMatch = /\(tick:\s*(\d+)\)/i.exec(fullText);
                parsedRules.push({
                    id: "rule_" + Date.now() + "_" + index,
                    name: ruleName,
                    type: "system",
                    enabled: true,
                    tickRateMs: tickMatch ? parseInt(tickMatch[1], 10) : 5000,
                    geekScript: fullText
                });
                continue;
            }
        }

        return parsedRules;
    }

    async function loadScriptAndRules() {
        loading = true;
        try {
            let storedVal = "";
            const LOCAL_BG_FILE = "background-engine.json";

            // 1. 尝试从本地插件 JSON 数据文件读取
            try {
                if (plugin) {
                    const localData = await plugin.loadData(LOCAL_BG_FILE);
                    if (typeof localData === "string") {
                        storedVal = localData;
                    } else if (localData && typeof localData === "object" && localData.rules) {
                        storedVal = String(localData.rules);
                    }
                }
            } catch (_) {}

            // 2. 若已实例化，尝试从 Command-DB 属性读取最新的规则
            const blockId = await resolveHostBlockId();
            if (blockId) {
                try {
                    const res = await post("/api/attr/getBlockAttrs", { id: blockId });
                    const dbVal = res?.["custom-indexos-background-rules"];
                    if (dbVal) {
                        storedVal = dbVal;
                    }
                } catch (e) {
                    console.warn("[GlobalAutomation] 读取 Command-DB 属性失败，使用本地 JSON 配置", e);
                }
            }

            if (storedVal.trim().startsWith("[")) {
                try {
                    rules = JSON.parse(storedVal);
                } catch (_) {
                    rules = parseTsScriptToRules(storedVal);
                }
            } else {
                rules = parseTsScriptToRules(storedVal);
            }

            if (rules.length > 0 && !selectedRuleId) {
                selectedRuleId = rules[0].id;
                activeTab = rules[0].type;
            }
        } catch (e) {
            console.error("[GlobalAutomation] Failed to load script:", e);
            rules = [];
        } finally {
            loading = false;
        }
    }

    // 在单任务源码编辑器手写更新时同步回 activeRule
    function syncActiveRuleFromCode() {
        if (!activeRule) return;
        const parsed = parseTsScriptToRules(activeRuleScript);
        if (parsed.length > 0) {
            const p = parsed[0];
            activeRule.cronExpr = p.cronExpr || activeRule.cronExpr;
            activeRule.commandIds = p.commandIds || activeRule.commandIds;
            activeRule.boundCommands = p.boundCommands || activeRule.boundCommands;
            activeRule.geekScript = p.geekScript || activeRule.geekScript;
            activeRule.tickRateMs = p.tickRateMs || activeRule.tickRateMs;
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

            showMessage("✓ 后台自动化规则配置已保存！");
            if (dialog) dialog.destroy();
        } catch (e: any) {
            console.error("[GlobalAutomation] Save script error:", e);
            showMessage(`保存配置失败: ${e.message}`, 3000, "error");
        }
    }

    function addRule(type: "cron" | "condition" | "system") {
        const newId = "rule_" + Date.now();
        const newRule: AutomationRule = {
            id: newId,
            name: type === "cron" ? "新建 Cron 任务" : type === "condition" ? "新建条件触发任务" : "新建 System 脚本",
            type,
            enabled: true,
            cronExpr: "0 2 * * *",
            commandIds: [],
            eventType: "block_content_changed",
            boundCommands: [],
            geekScript: `if (state.tickCount % 60 === 0) {\n    await dispatch("index.showToast");\n}`,
            tickRateMs: 5000
        };
        rules = [...rules, newRule];
        selectedRuleId = newId;
        activeTab = type;
    }

    function deleteRule(id: string, e: MouseEvent) {
        e.stopPropagation();
        rules = rules.filter(r => r.id !== id);
        if (selectedRuleId === id) {
            selectedRuleId = rules.length > 0 ? rules[0].id : null;
        }
    }

    // 查找在顺序管道列表中某个命令的序号 (1-indexed)
    function findPipelineIndex(list: string[] | undefined, cmdId: string): number {
        if (!list) return -1;
        return list.indexOf(cmdId);
    }

    // 沿用 Supertag 模式：顺序勾选搭建 Pipeline，被勾选项显示 1 2 3 4
    function togglePipelineSelection(rule: AutomationRule, field: "commandIds" | "boundCommands", cmdId: string) {
        const targetList = rule[field] || [];
        const index = targetList.indexOf(cmdId);
        let updated: string[];

        if (index > -1) {
            // 取消勾选
            updated = targetList.filter(id => id !== cmdId);
        } else {
            // 顺序勾选追加到末尾
            updated = [...targetList, cmdId];
        }

        rule[field] = updated;
        rules = [...rules];

        if (activeRule && activeRule.id === rule.id) {
            activeRuleScript = compileSingleRuleToScript(activeRule);
        }
    }
</script>

<div class="b3-dialog__content" style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box; padding: 12px; gap: 10px;">
    <!-- 头部标语与模式切换按钮 -->
    <div style="display: flex; align-items: center; justify-content: space-between; background: var(--b3-theme-surface); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--b3-border-color); flex-shrink: 0;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--b3-theme-on-background); display: flex; align-items: center; gap: 6px;">
                <span>⚡ 后台执行控制中心 (Background Engine)</span>
                <span style="font-size: 10px; color: var(--indexos-accent-primary); font-family: monospace; background: var(--indexos-weak-accent); padding: 2px 6px; border-radius: 3px;">TS Script Storage</span>
            </div>
            <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); opacity: 0.8;">
                规则存入数据库 Block 的 custom-attributes，保持左侧任务专注度与极客源码控制。
            </div>
        </div>

        <div style="display: flex; gap: 6px; align-items: center;">
            <!-- 双模式切换 Tab -->
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

            <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 3px 6px;" on:click={() => addRule("cron")}>+ 定时</button>
            <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 3px 6px;" on:click={() => addRule("condition")}>+ 条件</button>
            <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 3px 6px;" on:click={() => addRule("system")}>+ System</button>
        </div>
    </div>

    <!-- 主主体布局：左侧 Panel 始终固定并高亮，右侧自由切换可视化表单或当前任务专属源码 -->
    <div style="display: flex; flex: 1; gap: 12px; min-height: 0;">
        <!-- 左侧任务列表 Panel (始终可见 & 保持高亮) -->
        <div style="width: 200px; flex-shrink: 0; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; background: var(--b3-theme-surface);">
            {#if loading}
                <div style="text-align: center; opacity: 0.5; padding: 20px; font-size: 11px;">加载任务列表中...</div>
            {:else if rules.length === 0}
                <div style="text-align: center; opacity: 0.5; padding: 20px; font-size: 11px;">暂无后台任务<br>点击右上角新增</div>
            {:else}
                {#each rules as r}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div
                        class="b3-list-item {selectedRuleId === r.id ? 'b3-list-item--focus' : ''}"
                        style="padding: 8px 10px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
                        on:click={() => { selectedRuleId = r.id; activeTab = r.type; }}
                    >
                        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                            <span style="font-size: 12px;">{r.type === 'cron' ? '⏱️' : r.type === 'condition' ? '🔍' : '⚡'}</span>
                            <span style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{r.name}</span>
                        </div>
                        <span
                            style="font-size: 12px; opacity: 0.4; cursor: pointer;"
                            title="删除任务"
                            on:click={(e) => deleteRule(r.id, e)}
                        >✕</span>
                    </div>
                {/each}
            {/if}
        </div>

        <!-- 右侧任务配置/源码编辑面板 -->
        <div style="flex: 1; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 12px; background: var(--b3-theme-surface); overflow-y: auto;">
            {#if !activeRule}
                <div style="text-align: center; opacity: 0.4; padding: 50px; font-size: 12px;">请从左侧选择一个任务或新建任务</div>
            {:else}
                <!-- 顶部任务名称与启用开关 -->
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="text" class="b3-text-field" style="flex: 1; font-weight: bold;" bind:value={activeRule.name} placeholder="任务名称" />
                    <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                        <input type="checkbox" bind:checked={activeRule.enabled} />
                        启用
                    </label>
                </div>

                <!-- 模式 1: 🎨 可视化表单模式 -->
                {#if viewMode === "visual"}
                    {#if activeTab === "cron"}
                        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12px;">
                            <div style="font-weight: 600; color: var(--b3-theme-on-background);">⏱️ Cron 周期设置：</div>
                            <select class="b3-select" bind:value={activeRule.cronExpr}>
                                {#each CRON_PRESETS as p}
                                    <option value={p.value}>{p.label} ({p.value})</option>
                                {/each}
                            </select>
                            <input type="text" class="b3-text-field" bind:value={activeRule.cronExpr} placeholder="表达式: 0 2 * * *" />

                            <div style="font-weight: 600; margin-top: 6px; color: var(--b3-theme-on-background);">命令序列（勾选并按 ⚙ 配置入参）:</div>
                            <div style="height: 360px; display: flex; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 8px;">
                                <CommandSequenceEditor
                                    key={selectedRuleId}
                                    initialScript={ruleSequenceScript(activeRule)}
                                    showName={false}
                                    onScriptChange={s => applyRuleScript(activeRule, s)}
                                />
                            </div>
                        </div>
                    {:else if activeTab === "condition"}
                        <!-- 沿用 Supertag 模式：通过顺序勾选 Pipeline (显示 1 2 3 4) 搭建条件链与动作链 -->
                        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12px;">
                            <div style="font-weight: 600; color: var(--b3-theme-on-background);">🔍 监听的事件类型：</div>
                            <select class="b3-select" bind:value={activeRule.eventType}>
                                {#each EVENT_TYPES as ev}
                                    <option value={ev.id}>{ev.label}</option>
                                {/each}
                            </select>

                            <div style="font-weight: 600; margin-top: 4px; color: var(--b3-theme-on-background);">命令序列（勾选并按 ⚙ 配置入参）:</div>
                            <div style="height: 360px; display: flex; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 8px;">
                                <CommandSequenceEditor
                                    key={selectedRuleId}
                                    initialScript={ruleSequenceScript(activeRule)}
                                    showName={false}
                                    onScriptChange={s => applyRuleScript(activeRule, s)}
                                />
                            </div>
                        </div>
                    {:else if activeTab === "system"}
                        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
                            <div style="background: var(--b3-theme-error-dim, rgba(239, 68, 68, 0.1)); border: 1px solid var(--b3-theme-error, #ef4444); padding: 8px 10px; border-radius: 4px; color: var(--b3-theme-on-background); font-size: 11px; line-height: 1.4;">
                                <strong>⚠️ 极客 System 高级模式提示：</strong><br>
                                System 模式将在后台持续心跳执行。请勿直接编写无休止死循环，确保脚本内部包含帧计数限制或条件防御逻辑。
                            </div>

                            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                                <span style="font-weight: 600;">心跳轮询间隔 (毫秒):</span>
                                <input type="number" class="b3-text-field" style="width: 100px;" bind:value={activeRule.tickRateMs} />
                            </div>

                            <div style="font-weight: 600; margin-top: 4px;">极客沙盒 TS 执行脚本：</div>
                            <textarea
                                class="b3-text-field"
                                style="height: 130px; font-family: monospace; font-size: 11px;"
                                bind:value={activeRule.geekScript}
                            ></textarea>
                        </div>
                    {/if}

                <!-- 模式 2: 📝 当前选中任务专属 TS 源码编辑器 -->
                {:else}
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 6px; min-height: 0;">
                        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); font-weight: 600;">
                            📝 正在编辑【{activeRule.name}】的独立 TypeScript 脚本源码：
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
        <button class="b3-button b3-button--primary" on:click={saveScript}>保存 TS 脚本规则</button>
    </div>
</div>
