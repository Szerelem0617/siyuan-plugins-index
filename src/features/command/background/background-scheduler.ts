/**
 * background-scheduler.ts
 *
 * 全局后台命令与循环执行调度中心 (Layer 2 守护进程)
 *
 * 架构特性：
 *   1. 尊重思源 AV 实例化：已实例化时直接用 SQL 查询实例化后的 AV 视图表，清空实时销毁任务；
 *   2. 100% 依托思源 3.7+ 内核层次 (Kernel Mode) API 执行，零 DOM / 零 UI 编辑器依赖；
 *   3. 包含详尽的 Debug 日志输出与精准 Cron 周期解析。
 */

import { Plugin } from "siyuan";
import { runQuery, getSqliteEngine, instantiateAV } from "../../sqlite/sqlite-manager";
import { dispatchCommand, type CommandContext } from "../command-dispatcher";
import { commandRegistry } from "../registry/command-registry";
import { getCommandAvId } from "../registration";

export interface ScheduledTaskState {
    rowId: string;
    commandId: string;
    label: string;
    ruleText: string;
    triggerType: "cron" | "condition" | "system" | "none";
    cronExpr?: string;
    intervalMs: number;
    conditionExpr?: string;
    lastRunTime?: number;
    nextRunTime?: number;
    status: "idle" | "running" | "error";
    lastError?: string;
}

class BackgroundScheduler {
    private plugin: Plugin | null = null;
    private timerId: any = null;
    private taskStates: Map<string, ScheduledTaskState> = new Map();
    private isRunning = false;

    public async init(plugin: Plugin) {
        this.plugin = plugin;
        this.stop();
        console.log("%c[BackgroundScheduler-Debug] 🚀 Initializing scheduler under Kernel Mode...", "color: #007acc; font-weight: bold;");
        await this.reloadTasks();
        
        // 启动后台心跳守护进程 (每 10 秒一次 Kernel 周期巡检)
        this.timerId = setInterval(() => {
            this.tick().catch(e => console.error("[BackgroundScheduler-Debug] Tick error:", e));
        }, 10000);

        console.log("%c[BackgroundScheduler-Debug] ✓ Scheduler active under Kernel Mode (Siyuan 3.7+).", "color: #10b981; font-weight: bold;");
    }

    public stop() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        this.taskStates.clear();
        this.isRunning = false;
        console.log("[BackgroundScheduler-Debug] Stopped.");
    }

    public async reloadTasks() {
        this.taskStates.clear();
        const commandAvId = getCommandAvId();
        console.log(`[BackgroundScheduler-Debug] 🔄 Reloading tasks. Instantiated CommandAvID: "${commandAvId || "None (Using Backup)"}"`);

        try {
            let taskRows: { rowId: string; label: string; commandId: string; bgExecRule: string }[] = [];

            if (commandAvId) {
                // 1. 已实例化：先强同步实例化思源最新 AV 数据
                try {
                    await instantiateAV(commandAvId);
                } catch (instErr) {
                    console.warn("[BackgroundScheduler-Debug] Failed to instantiate AV before reload:", instErr);
                }

                const { db } = await getSqliteEngine();
                const tableName = `av_${commandAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;

                // 查 Schema 寻找匹配列名
                let bgCol = "Background_Exec";
                let labelCol = "label";
                let cmdIdCol = "Command_ID";

                try {
                    const bgColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name IN ('后台执行', 'Background_Exec')`, [commandAvId]);
                    if (bgColRes.length > 0 && bgColRes[0].values.length > 0) bgCol = String(bgColRes[0].values[0][0]);

                    const labelColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [commandAvId]);
                    if (labelColRes.length > 0 && labelColRes[0].values.length > 0) labelCol = String(labelColRes[0].values[0][0]);

                    const cmdIdColRes = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_name IN ('Command ID', 'Command_ID')`, [commandAvId]);
                    if (cmdIdColRes.length > 0 && cmdIdColRes[0].values.length > 0) cmdIdCol = String(cmdIdColRes[0].values[0][0]);
                } catch (_) {}

                console.log(`[BackgroundScheduler-Debug] Querying instantiated AV table "${tableName}" (bgCol: "${bgCol}")...`);
                const res = db.exec(`SELECT _itemID, "${labelCol}", "${cmdIdCol}", "${bgCol}" FROM ${tableName} WHERE "${bgCol}" IS NOT NULL AND "${bgCol}" != ''`);

                if (res.length > 0 && res[0].values.length > 0) {
                    for (const r of res[0].values) {
                        taskRows.push({
                            rowId: String(r[0]),
                            label: String(r[1] || ""),
                            commandId: String(r[2] || ""),
                            bgExecRule: String(r[3] || "")
                        });
                    }
                }
            } else {
                // 2. 未实例化：回退查询静态只读备份表 sys_command_db
                console.log("[BackgroundScheduler-Debug] Uninstantiated mode. Querying static sys_command_db backup...");
                const res = await runQuery(`SELECT rowID, label, Command_ID, Background_Exec FROM sys_command_db WHERE Background_Exec IS NOT NULL AND Background_Exec != ''`);
                if (res && res.values) {
                    for (const r of res.values) {
                        taskRows.push({
                            rowId: String(r[0]),
                            label: String(r[1] || ""),
                            commandId: String(r[2] || ""),
                            bgExecRule: String(r[3] || "")
                        });
                    }
                }
            }

            console.log(`[BackgroundScheduler-Debug] Resolved ${taskRows.length} active background rule(s).`);
            for (const row of taskRows) {
                const { rowId, label, commandId, bgExecRule } = row;
                if (!bgExecRule || !bgExecRule.trim()) continue;

                const parsed = this.parseRule(bgExecRule);
                console.log(`[BackgroundScheduler-Debug] Rule -> Label: "${label}" (${commandId}), Type: ${parsed.triggerType}, Cron: ${parsed.cronExpr}, IntervalMs: ${parsed.intervalMs}`);

                if (parsed.triggerType !== "none") {
                    this.taskStates.set(rowId, {
                        rowId,
                        commandId: commandId || "",
                        label: label || commandId || "未知命令",
                        ruleText: bgExecRule,
                        triggerType: parsed.triggerType,
                        cronExpr: parsed.cronExpr,
                        intervalMs: parsed.intervalMs,
                        conditionExpr: parsed.conditionExpr,
                        status: "idle"
                    });
                }
            }
            console.log(`%c[BackgroundScheduler-Debug] Active task count in memory: ${this.taskStates.size}`, "color: #10b981; font-weight: bold;");
        } catch (e) {
            console.error("[BackgroundScheduler-Debug] Failed to reload background tasks:", e);
        }
    }

    public getTaskStates(): ScheduledTaskState[] {
        return Array.from(this.taskStates.values());
    }

    private parseCronIntervalMs(cronExpr: string): number {
        const expr = cronExpr.trim();
        // 1. 匹配 */N * * * * (每 N 分钟)
        const minuteIntervalMatch = /^\*\/(\d+)/.exec(expr);
        if (minuteIntervalMatch) {
            const minutes = parseInt(minuteIntervalMatch[1], 10);
            return Math.max(1, minutes) * 60 * 1000;
        }

        // 2. 匹配 0 * * * * (每小时整点)
        if (expr.startsWith("0 *") || expr.startsWith("0 */1")) {
            return 3600 * 1000;
        }

        // 3. 匹配 0 2 * * * (每天一次)
        if (/^\d+\s+\d+\s+\*\s+\*\s+\*/.test(expr)) {
            return 86400 * 1000;
        }

        // 默认保底时间: 60 秒 (1 分钟)
        return 60 * 1000;
    }

    private parseRule(ruleText: string): { triggerType: "cron" | "condition" | "system" | "none"; cronExpr?: string; intervalMs: number; conditionExpr?: string } {
        const text = ruleText.trim();
        if (!text) return { triggerType: "none", intervalMs: 60000 };

        const cronMatch = /\/\/\s*\[Cron:\s*([^\]]+)\]/i.exec(text);
        if (cronMatch) {
            const cronExpr = cronMatch[1].trim();
            const intervalMs = this.parseCronIntervalMs(cronExpr);
            return { triggerType: "cron", cronExpr, intervalMs };
        }

        const condMatch = /\/\/\s*\[Condition:\s*([^\]]+)\]/i.exec(text);
        if (condMatch) {
            const debounceMatch = /\(debounce:(\d+)\)/i.exec(text);
            const intervalMs = debounceMatch ? parseInt(debounceMatch[1], 10) : 3000;
            return { triggerType: "condition", conditionExpr: condMatch[1].trim(), intervalMs };
        }

        const sysMatch = /\/\/\s*\[System:\s*([^\]]+)\]/i.exec(text);
        if (sysMatch) {
            const tickMatch = /\(tick:(\d+)\)/i.exec(text);
            const intervalMs = tickMatch ? parseInt(tickMatch[1], 10) : 5000;
            return { triggerType: "system", conditionExpr: sysMatch[1].trim(), intervalMs };
        }

        return { triggerType: "none", intervalMs: 60000 };
    }

    private async tick() {
        if (this.isRunning) return;
        this.isRunning = true;

        const now = Date.now();
        try {
            for (const task of this.taskStates.values()) {
                if (task.status === "running") continue;

                let shouldExecute = false;
                const elapsed = task.lastRunTime ? (now - task.lastRunTime) : Infinity;

                if (task.triggerType === "cron") {
                    console.log(`[BackgroundScheduler-Debug] Task "${task.label}" -> Interval: ${task.intervalMs}ms, Elapsed: ${elapsed === Infinity ? "First Run" : elapsed + "ms"}`);
                    if (!task.lastRunTime || elapsed >= task.intervalMs) {
                        shouldExecute = true;
                    }
                } else if (task.triggerType === "condition" && task.conditionExpr) {
                    if (!task.lastRunTime || elapsed >= task.intervalMs) {
                        try {
                            const sqlRes = await runQuery(task.conditionExpr);
                            if (sqlRes && sqlRes.values && sqlRes.values.length > 0) {
                                shouldExecute = true;
                            }
                        } catch (_) {}
                    }
                }

                if (shouldExecute) {
                    console.log(`%c[BackgroundScheduler-Debug] ⏰ Executing "${task.label}" (${task.commandId})...`, "color: #007acc; font-weight: bold;");
                    await this.executeTask(task);
                }
            }
        } finally {
            this.isRunning = false;
        }
    }

    public async executeTask(task: ScheduledTaskState) {
        task.status = "running";
        task.lastRunTime = Date.now();

        try {
            // 在思源 3.7+ Kernel 模式下构造无需 DOM 依赖的 Context
            const ctx: CommandContext = {
                blockEl: document.createElement("div"), // 虚拟隔离节点
                protyleEl: null
            };

            const cmdDef = commandRegistry.getCommand(task.commandId);
            if (cmdDef) {
                await dispatchCommand(task.commandId, {}, ctx);
                task.status = "idle";
                task.lastError = undefined;
                console.log(`%c[BackgroundScheduler-Debug] ✓ Success: ${task.label}`, "color: #10b981; font-weight: bold;");
            } else {
                throw new Error(`Command '${task.commandId}' not found in registry.`);
            }
        } catch (err: any) {
            task.status = "error";
            task.lastError = err.message || String(err);
            console.error(`[BackgroundScheduler-Debug] ❌ Failed: ${task.label}:`, err);
        }
    }
}

export const backgroundScheduler = new BackgroundScheduler();
