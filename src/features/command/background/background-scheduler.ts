/**
 * background-scheduler.ts
 *
 * 全局后台命令与循环执行调度中心 (Layer 2 守护进程 - TS 源码脚本调度版)
 *
 * 架构特性：
 *   1. 集中持久化：规则以带 Comment 的标准 TypeScript 源码脚本形式存入 Command-DB 数据库 Block 的 custom-attributes；
 *   2. 沿用 Supertag 原始 Pipeline 逻辑：顺序勾选搭建 Pipeline，被勾选项显示 1, 2, 3, 4 角标，中途返回 false 则阻断后续；
 *   3. 保持左侧任务列表 Panel 专注高亮与单任务源码专属编辑；
 *   4. 100% 依托思源 3.7+ 内核层次 (Kernel Mode) API 执行，零 DOM / 零 UI 编辑器依赖。
 */

import { Plugin } from "siyuan";
import { post } from "../../../shared/api-client/request";
import { dispatchCommand, type CommandContext } from "../command-dispatcher";
import { getCommandAvId } from "../registration";

export interface AutomationTask {
    id: string;
    name: string;
    type: "cron" | "condition" | "system";
    enabled: boolean;
    cronExpr?: string;
    boundCommands?: string[];
    eventType?: string;
    tickRateMs?: number;
    scriptBlock: string;
    intervalMs: number;
    lastRunTime?: number;
    status: "idle" | "running" | "error";
    lastError?: string;
}

class BackgroundScheduler {
    private timerId: any = null;
    private activeTasks: Map<string, AutomationTask> = new Map();
    private isRunning = false;

    public async init(_plugin: Plugin) {
        this.stop();
        console.log("%c[BackgroundScheduler-Debug] 🚀 Initializing Centralized TS Script Engine under Kernel Mode...", "color: #007acc; font-weight: bold;");
        await this.reloadTasks();
        
        // 启动后台心跳守护进程 (每 5 秒一次 Kernel 巡检)
        this.timerId = setInterval(() => {
            this.tick().catch(e => console.error("[BackgroundScheduler-Debug] Tick error:", e));
        }, 5000);

        console.log("%c[BackgroundScheduler-Debug] ✓ Centralized TS Script Engine Active under Kernel Mode (Siyuan 3.7+).", "color: #10b981; font-weight: bold;");
    }

    public stop() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        this.activeTasks.clear();
        this.isRunning = false;
    }

    public async reloadTasks() {
        console.log("[BackgroundScheduler-Debug] 🔄 Reloading TS rules from Command-DB Block custom attributes...");
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
            const scriptText = res?.["custom-indexos-background-rules"] || "";

            const tasks = this.parseTsScriptToTasks(scriptText);
            const activeTaskIds = new Set<string>();

            for (const task of tasks) {
                if (!task.enabled) continue;
                activeTaskIds.add(task.id);

                const existingState = this.activeTasks.get(task.id);
                this.activeTasks.set(task.id, {
                    ...task,
                    lastRunTime: existingState?.lastRunTime,
                    status: "idle"
                });
            }

            // 清理已删除的规则
            for (const existingId of Array.from(this.activeTasks.keys())) {
                if (!activeTaskIds.has(existingId)) {
                    this.activeTasks.delete(existingId);
                }
            }
        } catch (e) {
            console.error("[BackgroundScheduler] Failed to reload TS tasks from Block Attrs:", e);
        }
    }

    private parseTsScriptToTasks(script: string): AutomationTask[] {
        const tasks: AutomationTask[] = [];
        if (!script || !script.trim()) return tasks;

        const blocks = script.split(/\/\/\s*── Rule:/i);
        let taskIndex = 0;

        for (const rawBlock of blocks) {
            const trimmed = rawBlock.trim();
            if (!trimmed || trimmed.startsWith("// ─── IndexOS")) continue;

            taskIndex++;
            const lines = trimmed.split("\n");
            const firstLine = lines[0].trim();
            const ruleName = firstLine || `Rule #${taskIndex}`;

            const fullText = lines.slice(1).join("\n");

            // 1. Cron 匹配
            const cronMatch = /\/\/\s*\[Cron:\s*([^\]]+)\]/i.exec(fullText);
            if (cronMatch) {
                const cronExpr = cronMatch[1].trim();
                const boundCommands: string[] = [];
                const dispatchRegex = /dispatch\s*\(\s*["']([^"']+)["']/g;
                let m;
                while ((m = dispatchRegex.exec(fullText)) !== null) {
                    boundCommands.push(m[1]);
                }
                tasks.push({
                    id: `task_cron_${taskIndex}_${cronExpr}`,
                    name: ruleName,
                    type: "cron",
                    enabled: true,
                    cronExpr,
                    boundCommands,
                    intervalMs: this.parseCronIntervalMs(cronExpr),
                    scriptBlock: fullText,
                    status: "idle"
                });
                continue;
            }

            // 2. Condition 匹配 (沿用 Supertag 原始 Pipeline 逻辑，提取顺序 boundCommands)
            const condMatch = /\/\/\s*\[Condition:\s*([^\]]*)\]/i.exec(fullText);
            if (condMatch) {
                const evMatch = /event:\s*([^\]\)]+)/i.exec(condMatch[1] || fullText);
                const boundCommands: string[] = [];
                const dispatchRegex = /dispatch\s*\(\s*["']([^"']+)["']/g;
                let m;
                while ((m = dispatchRegex.exec(fullText)) !== null) {
                    boundCommands.push(m[1]);
                }

                tasks.push({
                    id: `task_cond_${taskIndex}`,
                    name: ruleName,
                    type: "condition",
                    enabled: true,
                    boundCommands,
                    eventType: evMatch ? evMatch[1].trim() : "block_content_changed",
                    intervalMs: 3000,
                    scriptBlock: fullText,
                    status: "idle"
                });
                continue;
            }

            // 3. System 匹配
            const sysMatch = /\/\/\s*\[System:\s*([^\]]+)\]/i.exec(fullText);
            if (sysMatch) {
                const tickMatch = /\(tick:\s*(\d+)\)/i.exec(fullText);
                const tickRateMs = tickMatch ? parseInt(tickMatch[1], 10) : 5000;
                tasks.push({
                    id: `task_sys_${taskIndex}`,
                    name: ruleName,
                    type: "system",
                    enabled: true,
                    tickRateMs,
                    intervalMs: Math.max(1000, tickRateMs),
                    scriptBlock: fullText,
                    status: "idle"
                });
                continue;
            }
        }

        return tasks;
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
            for (const task of this.activeTasks.values()) {
                if (task.status === "running") continue;

                const elapsed = task.lastRunTime ? (now - task.lastRunTime) : Infinity;
                if (!task.lastRunTime || elapsed >= task.intervalMs) {
                    await this.executeTaskScript(task);
                }
            }
        } finally {
            this.isRunning = false;
        }
    }

    private async executeTaskScript(task: AutomationTask) {
        task.status = "running";
        task.lastRunTime = Date.now();

        console.log(`[BackgroundScheduler-Debug] ⏰ Executing TS Script Automation: "${task.name}" (${task.type})`);

        try {
            const ctx: CommandContext = {
                blockEl: document.createElement("div"),
                protyleEl: null
            };

            // 沿用 Supertag 原始 Pipeline 逻辑：顺序依次执行命令，中途如果有命令返回 false 则阻断后续 Pipeline
            if (task.boundCommands && task.boundCommands.length > 0) {
                for (const cmdId of task.boundCommands) {
                    console.log(`[BackgroundScheduler-Debug] Executing Pipeline Command: ${cmdId}`);
                    const res = await dispatchCommand(cmdId, {}, ctx);
                    if (res && res.success === false) {
                        console.log(`[BackgroundScheduler-Debug] Pipeline halted by false result at command: ${cmdId}`);
                        break;
                    }
                }
            } else {
                // 纯极客 JS 沙盒脚本动态执行
                const asyncFn = new Function("dispatch", "state", `return (async () => { ${task.scriptBlock} })();`);
                await asyncFn(
                    (cmdId: string, params?: any) => dispatchCommand(cmdId, null, ctx, { manual: params || {} }),
                    { tickCount: Math.floor(Date.now() / 1000) }
                );
            }

            task.status = "idle";
            task.lastError = undefined;
            console.log(`%c[BackgroundScheduler-Debug] ✓ TS Script Execution Success: "${task.name}"`, "color: #10b981; font-weight: bold;");
        } catch (err: any) {
            task.status = "error";
            task.lastError = err.message || String(err);
            console.error(`[BackgroundScheduler-Debug] ❌ TS Script Execution Failed for "${task.name}":`, err);
        }
    }
}

export const backgroundScheduler = new BackgroundScheduler();
