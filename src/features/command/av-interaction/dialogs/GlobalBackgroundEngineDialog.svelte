<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { post } from "../../../../shared/api-client/request";
    import { runQuery } from "../../../sqlite/sqlite-manager";
    import { getCommandDocId, getCommandAvId } from "../../registration";
    import { commandRegistry } from "../../registry/command-registry";
    import { backgroundScheduler } from "../../background/background-scheduler";

    export let dialog: any;

    export interface AutomationRule {
        id: string;
        name: string;
        type: "cron" | "condition" | "system";
        enabled: boolean;
        // Cron
        cronExpr?: string;
        commandIds?: string[];
        // Condition
        eventType?: "block_content_changed" | "block_attribute_changed" | "doc_opened" | "task_completed";
        conditionExpr?: string;
        boundCommands?: string[];
        // System
        geekScript?: string;
        tickRateMs?: number;
    }

    let loading = true;
    let rules: AutomationRule[] = [];
    let selectedRuleId: string | null = null;
    let activeTab: "cron" | "condition" | "system" = "cron";

    let availableCommands: { id: string; name: string }[] = [];

    $: activeRule = rules.find(r => r.id === selectedRuleId) || null;

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
        await loadRules();
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
                if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                    const realBlockId = String(res.data[0].id || "");
                    if (realBlockId && realBlockId !== commandAvId) {
                        return realBlockId;
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
            if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                const targetBlockId = String(res.data[0].block_id || "");
                if (targetBlockId && targetBlockId !== commandAvId) {
                    return targetBlockId;
                }
            }
        } catch (_) {}

        return "";
    }

    async function loadRules() {
        loading = true;
        try {
            const blockId = await resolveHostBlockId();
            if (!blockId) {
                rules = [];
                return;
            }
            const res = await post("/api/attr/getBlockAttrs", { id: blockId });
            const rawJson = res?.["custom-indexos-background-rules"] || "[]";
            rules = JSON.parse(rawJson);
            if (rules.length > 0 && !selectedRuleId) {
                selectedRuleId = rules[0].id;
                activeTab = rules[0].type;
            }
        } catch (e) {
            console.error("[GlobalAutomation] Failed to load rules:", e);
            rules = [];
        } finally {
            loading = false;
        }
    }

    async function saveAllRules() {
        try {
            const blockId = await resolveHostBlockId();

            if (!blockId) {
                showMessage("未能在系统中找到打上了 custom-index-command-db 的数据库块，请先实例化 Command-DB", 3000, "error");
                return;
            }

            const jsonStr = JSON.stringify(rules, null, 2);

            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-indexos-background-rules": jsonStr
                }
            });

            await backgroundScheduler.reloadTasks();
            showMessage("✓ 后台自动化规则集中配置保存成功！");
            if (dialog) dialog.destroy();
        } catch (e: any) {
            console.error("[GlobalAutomation] Save rules error:", e);
            showMessage(`保存配置失败: ${e.message}`, 3000, "error");
        }
    }

    function addRule(type: "cron" | "condition" | "system") {
        const newId = "rule_" + Date.now();
        const newRule: AutomationRule = {
            id: newId,
            name: type === "cron" ? "新建 Cron 任务" : type === "condition" ? "新建事件触发器" : "新建 System 脚本",
            type,
            enabled: true,
            cronExpr: "0 2 * * *",
            commandIds: [],
            eventType: "block_content_changed",
            boundCommands: [],
            geekScript: `// ⚠️ 警告：System 持续模式按 Tick 高频运行\n// 请谨慎编写，避免无限死循环\nif (state.tickCount % 60 === 0) {\n    await dispatch('siyuan.ui.toast');\n}`,
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

    function toggleCmdSelection(rule: AutomationRule, cmdId: string) {
        const targetList = rule.type === "cron" ? (rule.commandIds || []) : (rule.boundCommands || []);
        let updated: string[];
        if (targetList.includes(cmdId)) {
            updated = targetList.filter(id => id !== cmdId);
        } else {
            updated = [...targetList, cmdId];
        }

        if (rule.type === "cron") rule.commandIds = updated;
        else rule.boundCommands = updated;

        rules = [...rules];
    }
</script>

<div class="b3-dialog__content" style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box; padding: 12px; gap: 10px;">
    <!-- 头部标语 -->
    <div style="display: flex; align-items: center; justify-content: space-between; background: var(--b3-theme-surface); padding: 10px 14px; border-radius: 6px; border: 1px solid var(--b3-border-color); flex-shrink: 0;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--b3-theme-on-background); display: flex; align-items: center; gap: 6px;">
                <span>⚡ 全局后台自动化控制中心 (Background Engine)</span>
                <span style="font-size: 10px; color: var(--indexos-accent-primary); font-family: monospace; background: var(--indexos-weak-accent); padding: 2px 6px; border-radius: 3px;">Block Attr Persisted</span>
            </div>
            <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); opacity: 0.8;">
                规则全量集中存储于 Command-DB 根节点的自定义属性中，随笔记云端原生同步与迁移。
            </div>
        </div>

        <div style="display: flex; gap: 6px;">
            <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 4px 8px;" on:click={() => addRule("cron")}>+ 定时</button>
            <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 4px 8px;" on:click={() => addRule("condition")}>+ 条件</button>
            <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 4px 8px;" on:click={() => addRule("system")}>+ System</button>
        </div>
    </div>

    <!-- 主主体布局：左侧规则列表 + 右侧配置面板 -->
    <div style="display: flex; flex: 1; gap: 12px; min-height: 0;">
        <!-- 左侧规则列表 -->
        <div style="width: 200px; flex-shrink: 0; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; background: var(--b3-theme-surface);">
            {#if loading}
                <div style="text-align: center; opacity: 0.5; padding: 20px; font-size: 11px;">加载规则中...</div>
            {:else if rules.length === 0}
                <div style="text-align: center; opacity: 0.5; padding: 20px; font-size: 11px;">暂无后台规则<br>点击右上角新增</div>
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
                            title="删除规则"
                            on:click={(e) => deleteRule(r.id, e)}
                        >✕</span>
                    </div>
                {/each}
            {/if}
        </div>

        <!-- 右侧规则编辑区域 -->
        <div style="flex: 1; border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 12px; background: var(--b3-theme-surface); overflow-y: auto;">
            {#if !activeRule}
                <div style="text-align: center; opacity: 0.4; padding: 50px; font-size: 12px;">请从左侧选择一条规则或新建规则</div>
            {:else}
                <!-- 规则基本信息 -->
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="text" class="b3-text-field" style="flex: 1; font-weight: bold;" bind:value={activeRule.name} placeholder="规则名称" />
                    <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                        <input type="checkbox" bind:checked={activeRule.enabled} />
                        启用
                    </label>
                </div>

                <!-- 模式内容配置 -->
                {#if activeTab === "cron"}
                    <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12px;">
                        <div style="font-weight: 600; color: var(--b3-theme-on-background);">⏱️ Cron 周期设置：</div>
                        <select class="b3-select" bind:value={activeRule.cronExpr}>
                            {#each CRON_PRESETS as p}
                                <option value={p.value}>{p.label} ({p.value})</option>
                            {/each}
                        </select>
                        <input type="text" class="b3-text-field" bind:value={activeRule.cronExpr} placeholder="表达式: 0 2 * * *" />

                        <div style="font-weight: 600; margin-top: 6px; color: var(--b3-theme-on-background);">绑定的命令 Workflow (可多选管道):</div>
                        <div style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; border: 1px solid var(--b3-border-color); padding: 6px; border-radius: 4px;">
                            {#each availableCommands as cmd}
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer;">
                                    <input
                                        type="checkbox"
                                        checked={(activeRule.commandIds || []).includes(cmd.id)}
                                        on:change={() => toggleCmdSelection(activeRule, cmd.id)}
                                    />
                                    <span>{cmd.name} <span style="opacity: 0.5; font-family: monospace;">({cmd.id})</span></span>
                                </label>
                            {/each}
                        </div>
                    </div>
                {:else if activeTab === "condition"}
                    <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12px;">
                        <div style="font-weight: 600; color: var(--b3-theme-on-background);">🔍 监听的事件类型：</div>
                        <select class="b3-select" bind:value={activeRule.eventType}>
                            {#each EVENT_TYPES as ev}
                                <option value={ev.id}>{ev.label}</option>
                            {/each}
                        </select>

                        <div style="font-weight: 600; margin-top: 4px; color: var(--b3-theme-on-background);">判断布尔断言 (Optional JS/SQL)：</div>
                        <input type="text" class="b3-text-field" bind:value={activeRule.conditionExpr} placeholder="例如: block.content.includes('重要')" />

                        <div style="font-weight: 600; margin-top: 6px; color: var(--b3-theme-on-background);">触发的动作命令：</div>
                        <div style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; border: 1px solid var(--b3-border-color); padding: 6px; border-radius: 4px;">
                            {#each availableCommands as cmd}
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer;">
                                    <input
                                        type="checkbox"
                                        checked={(activeRule.boundCommands || []).includes(cmd.id)}
                                        on:change={() => toggleCmdSelection(activeRule, cmd.id)}
                                    />
                                    <span>{cmd.name} <span style="opacity: 0.5; font-family: monospace;">({cmd.id})</span></span>
                                </label>
                            {/each}
                        </div>
                    </div>
                {:else if activeTab === "system"}
                    <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
                        <!-- 安全警告卡片 -->
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
            {/if}
        </div>
    </div>

    <!-- 底部保存按钮 -->
    <div style="display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 8px; border-top: 1px solid var(--b3-border-color);">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--primary" on:click={saveAllRules}>保存集中配置</button>
    </div>
</div>
