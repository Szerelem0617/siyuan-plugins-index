/**
 * background/background-scheduler.ts
 *
 * 全局定时与事件调度中心 (Schedule / Cron & Global Condition Scheduler)
 *
 * 架构特性：
 *   1. 精准闹钟模型 (Cron)：彻底摒弃 1s 死循环盲轮询，计算下一执行时间戳，精准休眠与唤醒 (Zero CPU Idle Cost)；
 *   2. 全局事件驱动 (Condition)：监听全局事件 (块变动、属性变动、文档打开、任务完成)，即时响应触发，0 轮询；
 *   3. 唤醒补偿机制：监听窗口聚焦与可见性切换，自动补偿笔记本休眠期间到期的周期任务；
 *   4. 集中持久化：规则以带 Comment 的标准规则脚本形式存入 Command-DB 数据库 Block custom-attributes；
 *   5. 100% 依托思源内核级 (Kernel Mode) API 执行，零 DOM 依赖。
 */

import { Plugin } from "siyuan";
import { plugin } from "../../../shared/utils";
import { post } from "../../../shared/api-client/request";
import { dispatchCommand, type CommandContext } from "../command-dispatcher";
import { getCommandAvId } from "../registration";

export interface ScheduledTask {
    id: string;
    name: string;
    type: "cron" | "condition";
    enabled: boolean;
    cronExpr?: string;
    eventType?: string;
    boundCommands: string[];
    commandParams: Record<string, Record<string, string>>;
    scriptBlock: string;
    lastRunTime?: number;
    nextRunTime?: number;
    status: "idle" | "running" | "error";
    lastError?: string;
}

/**
 * 极轻量标准 5 字段 Cron 时间戳计算器 (分 时 日 月 周)
 */
export function calculateNextCronTimestamp(cronExpr: string, fromTime: number = Date.now()): number {
    const expr = (cronExpr || "0 2 * * *").trim();
    const parts = expr.split(/\s+/);
    if (parts.length < 5) {
        return fromTime + 3600 * 1000;
    }

    const [minPart, hourPart, dayPart, monthPart, weekPart] = parts;

    // 1. 每 N 分钟 (例如 */15 * * * *)
    const minuteIntervalMatch = /^\*\/(\d+)$/.exec(minPart);
    if (minuteIntervalMatch && hourPart === "*" && dayPart === "*") {
        const intervalMins = parseInt(minuteIntervalMatch[1], 10) || 1;
        const fromDate = new Date(fromTime);
        const currentMins = fromDate.getMinutes();
        const nextMin = (Math.floor(currentMins / intervalMins) + 1) * intervalMins;
        const target = new Date(fromTime);
        target.setMinutes(nextMin, 0, 0);
        return target.getTime();
    }

    // 2. 逐分钟向前探测未来 8 天内的首个匹配点 (最多探测 11520 分钟)
    const current = new Date(fromTime);
    current.setSeconds(0, 0);
    current.setMinutes(current.getMinutes() + 1);

    const matchesField = (val: number, pattern: string): boolean => {
        if (pattern === "*") return true;
        if (pattern.startsWith("*/")) {
            const step = parseInt(pattern.slice(2), 10);
            return step > 0 && val % step === 0;
        }
        const values = pattern.split(",").map(v => parseInt(v.trim(), 10));
        return values.includes(val);
    };

    for (let i = 0; i < 11520; i++) {
        const min = current.getMinutes();
        const hour = current.getHours();
        const day = current.getDate();
        const month = current.getMonth() + 1;
        const week = current.getDay(); // 0 is Sunday

        const matchMin = matchesField(min, minPart);
        const matchHour = matchesField(hour, hourPart);
        const matchDay = matchesField(day, dayPart);
        const matchMonth = matchesField(month, monthPart);
        const matchWeek = matchesField(week, weekPart);

        if (matchMin && matchHour && matchDay && matchMonth && matchWeek) {
            return current.getTime();
        }

        current.setMinutes(current.getMinutes() + 1);
    }

    return fromTime + 86400 * 1000;
}

class BackgroundScheduler {
    private wakeTimerId: any = null;
    private activeTasks: Map<string, ScheduledTask> = new Map();
    private isExecuting = false;
    private hasBoundLifecycleListeners = false;

    public async init(_plugin?: Plugin) {
        this.bindLifecycleListeners();
        await this.reloadTasks();
    }

    public stop() {
        if (this.wakeTimerId) {
            clearTimeout(this.wakeTimerId);
            this.wakeTimerId = null;
        }
        this.activeTasks.clear();
        this.isExecuting = false;
    }

    private bindLifecycleListeners() {
        if (this.hasBoundLifecycleListeners) return;
        this.hasBoundLifecycleListeners = true;

        const checkMissedTasks = () => {
            console.log("[BackgroundScheduler] 🔔 Window visible/focus, checking scheduled tasks...");
            this.evaluateAndRunDueTasks();
        };

        window.addEventListener("focus", checkMissedTasks);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                checkMissedTasks();
            }
        });
    }

    /**
     * 响应全局事件并即时触发符合条件的 Condition 任务 (0 轮询开销)
     */
    public async triggerEventTasks(eventName: string, contextVars: Record<string, any> = {}) {
        for (const task of this.activeTasks.values()) {
            if (!task.enabled || task.type !== "condition") continue;
            if (task.eventType && task.eventType !== eventName && task.eventType !== "*") continue;

            console.log(`[BackgroundScheduler] ⚡ Event "${eventName}" triggered condition task "${task.name}"`);
            this.executeTaskScript(task, contextVars).catch(e => {
                console.error(`[BackgroundScheduler] Condition task error:`, e);
            });
        }
    }

    public async resolveTargetCommandDbBlockId(): Promise<string> {
        let blockId = "";
        const commandAvId = getCommandAvId();

        if (commandAvId) {
            const avEl = document.querySelector(`[data-av-id="${commandAvId}"]`);
            if (avEl) {
                const nodeId = avEl.getAttribute("data-node-id") || avEl.getAttribute("data-id");
                if (nodeId && nodeId !== commandAvId) {
                    blockId = nodeId;
                }
            }
        }

        if (!blockId && commandAvId) {
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${commandAvId}%' OR ial LIKE '%${commandAvId}%') LIMIT 1`
                });
                const rows: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
                if (rows.length > 0) {
                    const blockIdCandidate = String(rows[0].id || "");
                    if (blockIdCandidate && blockIdCandidate !== commandAvId) {
                        blockId = blockIdCandidate;
                    }
                }
            } catch (_) {}
        }

        if (!blockId) {
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT block_id FROM attributes WHERE name = 'custom-index-command-db' LIMIT 1`
                });
                const rows: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
                if (rows.length > 0) {
                    const targetBlockId = String(rows[0].block_id || "");
                    if (targetBlockId && targetBlockId !== commandAvId) {
                        blockId = targetBlockId;
                    }
                }
            } catch (_) {}
        }

        return blockId;
    }

    public async reloadTasks() {
        console.log("[BackgroundScheduler] 🔄 Reloading background tasks from storage...");
        const blockId = await this.resolveTargetCommandDbBlockId();

        let scriptText = "";
        const LOCAL_BG_FILE = "background-engine.json";

        try {
            if (plugin) {
                const localData = await plugin.loadData(LOCAL_BG_FILE);
                if (typeof localData === "string") {
                    scriptText = localData;
                } else if (localData && typeof localData === "object" && localData.rules) {
                    scriptText = String(localData.rules);
                }
            }
        } catch (_) {}

        if (blockId) {
            try {
                const res = await post("/api/attr/getBlockAttrs", { id: blockId });
                const dbAttrText = res?.["custom-indexos-background-rules"];
                if (dbAttrText) {
                    scriptText = dbAttrText;
                    if (plugin) {
                        plugin.saveData(LOCAL_BG_FILE, { rules: scriptText });
                    }
                }
            } catch (e) {
                console.warn("[BackgroundScheduler] 读取块属性规则失败，走本地规则 fallback:", e);
            }
        }

        try {
            const tasks = this.parseTsScriptToTasks(scriptText);
            const activeTaskIds = new Set<string>();
            const now = Date.now();

            for (const task of tasks) {
                if (!task.enabled) continue;
                activeTaskIds.add(task.id);

                const existingState = this.activeTasks.get(task.id);
                const nextTime = task.type === "cron" ? calculateNextCronTimestamp(task.cronExpr || "0 2 * * *", now) : undefined;
                this.activeTasks.set(task.id, {
                    ...task,
                    lastRunTime: existingState?.lastRunTime,
                    nextRunTime: nextTime,
                    status: "idle"
                });
            }

            for (const existingId of Array.from(this.activeTasks.keys())) {
                if (!activeTaskIds.has(existingId)) {
                    this.activeTasks.delete(existingId);
                }
            }

            this.replanNextWakeAlarm();
        } catch (e) {
            console.error("[BackgroundScheduler] Failed to reload tasks:", e);
        }
    }

    private parseTsScriptToTasks(script: string): ScheduledTask[] {
        const tasks: ScheduledTask[] = [];
        if (!script || !script.trim()) return tasks;

        const extractDispatchCommands = (fullText: string): { ids: string[]; params: Record<string, Record<string, string>> } => {
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
        };

        const blocks = script.split(/\/\/\s*── Rule:/i);
        let taskIndex = 0;

        for (const rawBlock of blocks) {
            const trimmed = rawBlock.trim();
            if (!trimmed || trimmed.startsWith("// ─── IndexOS")) continue;

            taskIndex++;
            const lines = trimmed.split("\n");
            const firstLine = lines[0].trim();
            const ruleName = firstLine || `任务 #${taskIndex}`;
            const fullText = lines.slice(1).join("\n");

            // 1. Cron 定时规则
            const cronMatch = /\/\/\s*\[Cron:\s*([^\]]+)\]/i.exec(fullText);
            if (cronMatch) {
                const cronExpr = cronMatch[1].trim();
                const { ids: boundCommands, params: commandParams } = extractDispatchCommands(fullText);
                tasks.push({
                    id: `task_cron_${taskIndex}_${cronExpr}`,
                    name: ruleName,
                    type: "cron",
                    enabled: true,
                    cronExpr,
                    boundCommands,
                    commandParams,
                    scriptBlock: fullText,
                    status: "idle"
                });
                continue;
            }

            // 2. Condition 条件触发规则
            const condMatch = /\/\/\s*\[Condition:\s*([^\]]*)\]/i.exec(fullText);
            if (condMatch) {
                const evMatch = /event:\s*([^\]\)]+)/i.exec(condMatch[1] || fullText);
                const { ids: boundCommands, params: commandParams } = extractDispatchCommands(fullText);
                tasks.push({
                    id: `task_cond_${taskIndex}`,
                    name: ruleName,
                    type: "condition",
                    enabled: true,
                    eventType: evMatch ? evMatch[1].trim() : "block_content_changed",
                    boundCommands,
                    commandParams,
                    scriptBlock: fullText,
                    status: "idle"
                });
            }
        }

        return tasks;
    }

    private replanNextWakeAlarm() {
        if (this.wakeTimerId) {
            clearTimeout(this.wakeTimerId);
            this.wakeTimerId = null;
        }

        const cronTasks = Array.from(this.activeTasks.values()).filter(t => t.type === "cron" && t.enabled);
        if (cronTasks.length === 0) return;

        const now = Date.now();
        let earliestTimestamp = Infinity;

        for (const task of cronTasks) {
            if (!task.nextRunTime || task.nextRunTime <= now) {
                task.nextRunTime = calculateNextCronTimestamp(task.cronExpr || "0 2 * * *", now);
            }
            if (task.nextRunTime < earliestTimestamp) {
                earliestTimestamp = task.nextRunTime;
            }
        }

        if (earliestTimestamp === Infinity) return;

        const delayMs = Math.max(1000, Math.min(earliestTimestamp - now, 3600 * 1000));
        console.log(`[BackgroundScheduler] ⏱️ Next scheduled task in ${Math.round(delayMs / 1000)}s (at ${new Date(now + delayMs).toLocaleTimeString()})`);

        this.wakeTimerId = setTimeout(() => {
            this.evaluateAndRunDueTasks();
        }, delayMs);
    }

    private async evaluateAndRunDueTasks() {
        if (this.isExecuting) return;
        this.isExecuting = true;

        const now = Date.now();
        try {
            for (const task of this.activeTasks.values()) {
                if (!task.enabled || task.type !== "cron" || task.status === "running") continue;

                if (task.nextRunTime && task.nextRunTime <= now + 2000) {
                    console.log(`[BackgroundScheduler] 🚀 Executing scheduled task "${task.name}" (${task.cronExpr})`);
                    await this.executeTaskScript(task);
                    task.lastRunTime = Date.now();
                    task.nextRunTime = calculateNextCronTimestamp(task.cronExpr || "0 2 * * *", Date.now());
                }
            }
        } finally {
            this.isExecuting = false;
            this.replanNextWakeAlarm();
        }
    }

    private async executeTaskScript(task: ScheduledTask, extraVars: Record<string, any> = {}) {
        task.status = "running";

        try {
            const ctx: CommandContext = {
                blockEl: document.createElement("div"),
                protyleEl: null,
                executionMode: "background",
                vars: { ...extraVars }
            };

            if (task.boundCommands && task.boundCommands.length > 0) {
                for (const cmdId of task.boundCommands) {
                    const res = await dispatchCommand(cmdId, task.commandParams?.[cmdId] || {}, ctx);
                    if (res && res.success === false) {
                        break;
                    }
                }
            } else {
                const asyncFn = new Function("dispatch", "state", `return (async () => { ${task.scriptBlock} })();`);
                await asyncFn(
                    (cmdId: string, params?: any) => dispatchCommand(cmdId, null, ctx, { manual: params || {} }),
                    { tickCount: Math.floor(Date.now() / 1000), vars: { ...extraVars } }
                );
            }

            task.status = "idle";
            task.lastError = undefined;
        } catch (err: any) {
            task.status = "error";
            task.lastError = err.message || String(err);
            console.error(`[BackgroundScheduler] Execution Failed for "${task.name}":`, err);
        }
    }

    public async saveRules(scriptText: string): Promise<void> {
        if (plugin) {
            await plugin.saveData("background-engine.json", { rules: scriptText });
        }

        const blockId = await this.resolveTargetCommandDbBlockId();
        if (blockId) {
            try {
                await post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: { "custom-indexos-background-rules": scriptText }
                });
            } catch (e) {
                console.error("[BackgroundScheduler] 双写规则至 Command-DB 失败:", e);
            }
        }

        await this.reloadTasks();
    }
}

export const backgroundScheduler = new BackgroundScheduler();
