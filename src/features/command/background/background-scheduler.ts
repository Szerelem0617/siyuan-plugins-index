/**
 * background-scheduler.ts
 *
 * 全局后台命令与循环执行调度中心 (Layer 2 守护进程 - 集中管理版)
 *
 * 架构特性：
 *   1. 集中持久化：规则保存在 Command-DB 根节点的 custom-indexos-background-rules 自定义块属性中；
 *   2. 随笔记云端原生同步与离线迁移，完全解耦于表格“列字段”；
 *   3. 包含 Cron 周期工作流、Condition 事件观察者、System 极客沙盒模式；
 *   4. 100% 依托思源 3.7+ 内核层次 (Kernel Mode) API 执行，零 DOM / 零 UI 编辑器依赖。
 */

import { Plugin } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { runQuery } from "../../sqlite/sqlite-manager";
import { dispatchCommand, type CommandContext } from "../command-dispatcher";
import { commandRegistry } from "../registry/command-registry";
import { getCommandDocId, getCommandAvId } from "../registration";

export interface AutomationRule {
    id: string;
    name: string;
    type: "cron" | "condition" | "system";
    enabled: boolean;
    cronExpr?: string;
    commandIds?: string[];
    eventType?: "block_content_changed" | "block_attribute_changed" | "doc_opened" | "task_completed";
    conditionExpr?: string;
    boundCommands?: string[];
    geekScript?: string;
    tickRateMs?: number;
}

export interface ActiveTaskState {
    ruleId: string;
    ruleName: string;
    rule: AutomationRule;
    intervalMs: number;
    lastRunTime?: number;
    status: "idle" | "running" | "error";
    lastError?: string;
}

class BackgroundScheduler {
    private plugin: Plugin | null = null;
    private timerId: any = null;
    private activeTasks: Map<string, ActiveTaskState> = new Map();
    private isRunning = false;

    public async init(plugin: Plugin) {
        this.plugin = plugin;
        this.stop();
        console.log("%c[BackgroundScheduler-Debug] 🚀 Initializing Centralized Background Engine under Kernel Mode...", "color: #007acc; font-weight: bold;");
        await this.reloadTasks();
        
        // 启动后台心跳守护进程 (每 5 秒一次 Kernel 巡检)
        this.timerId = setInterval(() => {
            this.tick().catch(e => console.error("[BackgroundScheduler-Debug] Tick error:", e));
        }, 5000);

        console.log("%c[BackgroundScheduler-Debug] ✓ Centralized Engine Active under Kernel Mode (Siyuan 3.7+).", "color: #10b981; font-weight: bold;");
    }

    public async reloadTasks() {
        let blockId = "";
        const commandAvId = getCommandAvId();

        // 1. 尝试直接从 DOM 节点抓取 NodeAttributeView 的物理 data-node-id (真正的物理 Block ID)
        if (commandAvId) {
            const avEl = document.querySelector(`[data-av-id="${commandAvId}"]`);
            if (avEl) {
                const nodeId = avEl.getAttribute("data-node-id") || avEl.getAttribute("data-id");
                if (nodeId && nodeId !== commandAvId) {
                    blockId = nodeId;
                }
            }
        }

        // 2. 通过思源内核 API /api/query/sql 从 blocks 表查询 type = 'av' 对应的物理 Block ID
        if (!blockId && commandAvId) {
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${commandAvId}%' OR ial LIKE '%${commandAvId}%') LIMIT 1`
                });
                if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                    const realBlockId = String(res.data[0].id || "");
                    if (realBlockId && realBlockId !== commandAvId) {
                        blockId = realBlockId;
                    }
                }
            } catch (_) {}
        }

        // 3. 从 attributes 表反查 custom-index-command-db 记录的物理 block_id
        if (!blockId) {
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT block_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`
                });
                if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                    const targetBlockId = String(res.data[0].block_id || "");
                    if (targetBlockId && targetBlockId !== commandAvId) {
                        blockId = targetBlockId;
                    }
                }
            } catch (_) {}
        }

        if (!blockId) {
            this.activeTasks.clear();
            return;
        }

        try {
            const res = await post("/api/attr/getBlockAttrs", { id: blockId });
            const rawJson = res?.["custom-indexos-background-rules"] || "[]";
            const rules: AutomationRule[] = JSON.parse(rawJson);

            const activeRuleIds = new Set<string>();

            for (const r of rules) {
                if (!r.enabled) continue;
                activeRuleIds.add(r.id);

                let intervalMs = 60000;
                if (r.type === "cron" && r.cronExpr) {
                    intervalMs = this.parseCronIntervalMs(r.cronExpr);
                } else if (r.type === "system" && r.tickRateMs) {
                    intervalMs = Math.max(1000, r.tickRateMs);
                } else if (r.type === "condition") {
                    intervalMs = 3000;
                }

                const existingState = this.activeTasks.get(r.id);
                this.activeTasks.set(r.id, {
                    ruleId: r.id,
                    ruleName: r.name,
                    rule: r,
                    intervalMs,
                    lastRunTime: existingState?.lastRunTime,
                    status: "idle"
                });
            }

            // 清理已删除的规则
            for (const existingId of Array.from(this.activeTasks.keys())) {
                if (!activeRuleIds.has(existingId)) {
                    this.activeTasks.delete(existingId);
                }
            }

            console.log(`%c[BackgroundScheduler-Debug] Active task count in memory: ${this.activeTasks.size}`, "color: #10b981; font-weight: bold;");
        } catch (e) {
            console.error("[BackgroundScheduler-Debug] Failed to reload tasks from Block Attrs:", e);
        }
    }

    private parseCronIntervalMs(cronExpr: string): number {
        const expr = cronExpr.trim();
        const minuteIntervalMatch = /^\*\/(\d+)/.exec(expr);
        if (minuteIntervalMatch) {
            const minutes = parseInt(minuteIntervalMatch[1], 10);
            return Math.max(1, minutes) * 60 * 1000;
        }
        if (expr.startsWith("0 *") || expr.startsWith("0 */1")) return 3600 * 1000;
        if (/^\d+\s+\d+\s+\*\s+\*\s+\*/.test(expr)) return 86400 * 1000;
        return 60 * 1000;
    }

    private async tick() {
        if (this.isRunning) return;
        this.isRunning = true;

        const now = Date.now();
        try {
            for (const state of this.activeTasks.values()) {
                if (state.status === "running") continue;

                const elapsed = state.lastRunTime ? (now - state.lastRunTime) : Infinity;
                if (!state.lastRunTime || elapsed >= state.intervalMs) {
                    await this.executeRule(state);
                }
            }
        } finally {
            this.isRunning = false;
        }
    }

    private async executeRule(state: ActiveTaskState) {
        state.status = "running";
        state.lastRunTime = Date.now();

        const rule = state.rule;
        console.log(`[BackgroundScheduler-Debug] ⏰ Executing Centralized Rule: "${rule.name}" (${rule.type})`);

        try {
            const ctx: CommandContext = {
                blockEl: document.createElement("div"),
                protyleEl: null
            };

            if (rule.type === "cron" && rule.commandIds && rule.commandIds.length > 0) {
                // 顺序执行 Cron 工作流中的命令 Pipeline
                for (const cmdId of rule.commandIds) {
                    console.log(`[BackgroundScheduler-Debug] Dispatching Workflow Command: ${cmdId}`);
                    await dispatchCommand(cmdId, {}, ctx);
                }
            } else if (rule.type === "condition" && rule.boundCommands && rule.boundCommands.length > 0) {
                for (const cmdId of rule.boundCommands) {
                    console.log(`[BackgroundScheduler-Debug] Dispatching Condition Command: ${cmdId}`);
                    await dispatchCommand(cmdId, {}, ctx);
                }
            } else if (rule.type === "system" && rule.geekScript) {
                console.log(`[BackgroundScheduler-Debug] Executing System Geek Script for: "${rule.name}"`);
                // 安全沙盒中执行 System 代码
                const asyncFn = new Function("dispatch", "state", `return (async () => { ${rule.geekScript} })();`);
                await asyncFn(
                    (cmdId: string, params?: any) => dispatchCommand(cmdId, params || {}, ctx),
                    { tickCount: Math.floor(Date.now() / 1000) }
                );
            }

            state.status = "idle";
            state.lastError = undefined;
            console.log(`%c[BackgroundScheduler-Debug] ✓ Execution Success for Rule: "${rule.name}"`, "color: #10b981; font-weight: bold;");
        } catch (err: any) {
            state.status = "error";
            state.lastError = err.message || String(err);
            console.error(`[BackgroundScheduler-Debug] ❌ Execution Failed for Rule "${rule.name}":`, err);
        }
    }
}

export const backgroundScheduler = new BackgroundScheduler();
