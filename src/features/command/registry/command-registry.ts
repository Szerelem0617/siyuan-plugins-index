/**
 * command-registry.ts
 *
 * 命令注册表 —— 系统的 Source of Truth。
 *
 * 职责：
 *   1. 在插件启动时加载 commands.json 中定义的内置命令到内存 Map。
 *   2. 提供 registerCommand() 供第三方插件注册自定义命令。
 *   3. 提供 getCommand() 供 Dispatcher 查询命令的执行方式和约束。
 *
 * 不负责：执行命令、渲染 UI、读写 AV 数据库。
 *
 * 注意：本文件的 CommandDef 是 Layer 1 命令定义；
 * Layer 2 的绑定行（label → commandRef）见 registration.ts 的
 * CommandBinding / COMMAND_BINDINGS，两者勿混用。
 */

import commandsData from "./builtin";
import { runQuery } from "../../sqlite/sqlite-manager";
import { getSystemTableNames } from "../indexos/command-sqlite";

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** 参数的获取/注入方式 */
export type ParamMode =
    | "static"      // 写死在 AV Command Param 列里，执行时原样传入
    | "template"    // 字符串含 {{占位符}}，Dispatcher 在执行前实时解析替换
    | "interactive"; // 执行前弹出 UI 让用户手动填写

/** 命令的调度方式 */
export type DispatchMethod = "keyboard" | "global" | "api" | "custom";

/**
 * 命令裸绑定时的最小上下文需求（入口适配判断的推导依据）。
 * - none  : 不依赖任何块/文档上下文（视图、特效、提示等），可绑定到顶栏/快捷键等全局位置；
 * - block : 依赖当前块上下文（作用于块自身/其兄弟/其父的命令），只应出现在块菜单/命令按钮/;;菜单等；
 * - doc   : 依赖当前文档上下文，只应出现在页面/编辑器菜单等位置。
 */
export type ContextNeed = "none" | "block" | "doc";

/** 命令所属功能分类 */
export type CommandCategory =
    | "navigation" | "view" | "edit"
    | "clipboard" | "attribute" | "custom" | "user";

/** 命令可作用的思源块类型（建议性声明） */
export type BlockTarget =
    | "document"     // 文档根节点
    | "paragraph"    // 段落
    | "heading"      // 标题
    | "list"         // 列表（含任务列表）
    | "blockquote"   // 引述
    | "code"         // 代码块
    | "table"        // 表格
    | "super"        // 超级块
    | "embed"        // 嵌入块
    | "widget"       // 挂件
    | "any";         // 显式声明通用（等价于不填）

// ─────────────────────────────────────────────────────────────────────────────

/** 一个参数的 Schema 描述（对应 builtin/*.json 中 params[] 的每一项） */
export interface ParamSchema {
    /** 传给 API 时使用的字段名，如 "dataType" */
    key: string;
    /** 展示给用户看的名称，如 "内容类型" */
    label?: string;
    /** 数据类型 */
    type: "string" | "text" | "blockid" | "enum" | "object" | "number" | "boolean";
    /** 是否必填 */
    required?: boolean;
    /** 参数获取方式 */
    paramMode: ParamMode;
    /** type=enum 时的可选值 */
    values?: string[];
    /** 默认值（static 类型参数的缺省） */
    default?: unknown;
    /** 是否在配置界面默认折叠/隐藏 */
    hidden?: boolean;
    /** paramMode=template 时列出可用的占位符，如 ["{{date}}", "{{block_id}}"] */
    templateVars?: string[];
    /** 参数的描述文字，显示在 command-db UI 的 tooltip 里 */
    description?: string;
}

/** 命令的调度配置，决定 Dispatcher 走哪条执行路径 */
export interface DispatchConfig {
    method: DispatchMethod;
    /** keyboard: 在 keymap 中的层级路径，如 ["editor","general","duplicate"] */
    keymapPath?: string[];
    /** global: 传给 globalCommand() 的裸命令名，如 "graphView" */
    target?: string;
    /** api: 思源后端接口路径，如 "/api/block/insertBlock" */
    endpoint?: string;
    /**
     * custom: 第三方插件注册时直接提供的执行函数。
     * 仅存在于内存中，不序列化到 JSON。
     */
    executor?: (
        params: Record<string, unknown>,
        context: import("../dispatcher/types").CommandContext
    ) => Promise<unknown>;
}

export type ExecutionEnvironment = "ui" | "universal";
export type TargetScope = "none" | "block" | "doc" | "any";

/** 命令执行的约束条件，Dispatcher 在执行前做前置检查 */
export interface CommandConstraints {
    /** 执行环境：前端 UI 专属 (ui)、通用双端 (universal) */
    environment: ExecutionEnvironment;
    /** 目标节点作用域：全局无上下文 (none)、块专用 (block)、页面专用 (doc)、通用多态 (any) */
    targetScope: TargetScope;
    /** 补充说明，供开发者阅读 */
    comment?: string;
}

export type CommandSourceType = "builtin" | "composite" | "user" | "plugin";
export type CommandDomainType = "block" | "attribute" | "interaction" | "document" | "data_flow" | "composite" | "other";
export type CommandScopeType = "focused_block" | "document" | "global";

/** 命令的元信息，供 command-db 展示和多维筛选使用 */
export interface CommandMeta {
    /** 裸绑定时的最小上下文需求（none/block/doc），决定可绑定的入口位置 */
    contextNeed: ContextNeed;
    /** 功能分类 */
    category?: CommandCategory | string;
    /** 1. 命令来源维度 */
    source: CommandSourceType | "builtin" | "plugin" | "user";
    /** 2. 功能领域维度 */
    domain?: CommandDomainType;
    /** 3. 目标作用域维度 */
    scope?: CommandScopeType;
    /** source=plugin 时，记录插件名 */
    plugin?: string;
    /** 用户命令的图标 */
    icon?: string;
    /**
     * 如果该命令是 UI-only 且不可调度，这里指出功能等效的 API 版本 ID，
     * 供用户切换到 schedulable 替代方案时参考。
     */
    apiEquivalent?: string;
    /**
     * 命令适用的思源块类型（建议性约束，Layer 1 只读配置）。
     * 缺省或包含 "any" 表示不限制。
     * Dispatcher 不匹配时仅 warn，不阻断执行。
     */
    appliesTo?: BlockTarget[];
}

export function inferCommandSource(cmd: CommandDef): CommandSourceType {
    if (cmd.meta?.source) return cmd.meta.source as CommandSourceType;
    if (cmd.id.startsWith("composite.") || cmd.id.startsWith("pipeline.")) return "composite";
    if (cmd.id.startsWith("user.")) return "user";
    return "builtin";
}

export function inferCommandDomain(cmd: CommandDef): CommandDomainType {
    if (cmd.meta?.domain) return cmd.meta.domain;
    if (cmd.id.startsWith("composite.") || cmd.id.startsWith("pipeline.")) return "composite";
    const lowerId = cmd.id.toLowerCase();
    const lowerName = (cmd.name || "").toLowerCase();
    if (lowerId.includes("tag") || lowerId.includes("attr") || lowerName.includes("标签") || lowerName.includes("属性")) return "attribute";
    if (lowerId.includes("visual") || lowerId.includes("toast") || lowerId.includes("prompt") || lowerName.includes("特效") || lowerName.includes("通知") || lowerName.includes("烟花")) return "interaction";
    if (lowerId.includes("doc") || lowerId.includes("target") || lowerName.includes("文档") || lowerName.includes("打开")) return "document";
    if (lowerId.includes("sql") || lowerId.includes("fetch") || lowerName.includes("数据") || lowerName.includes("请求")) return "data_flow";
    if (lowerId.includes("block") || lowerName.includes("块")) return "block";
    return "other";
}

export function inferCommandScope(cmd: CommandDef): CommandScopeType {
    if (cmd.meta?.scope) return cmd.meta.scope;
    if (cmd.meta?.contextNeed === "none" || cmd.constraints?.targetScope === "none") return "global";
    if (cmd.meta?.contextNeed === "doc" || cmd.constraints?.targetScope === "doc") return "document";
    return "focused_block";
}

/** 完整的命令定义（Registry 中的存储单元） */
export interface CommandDef {
    /** 唯一 ID，两层扁平动宾路径，如 "index.duplicateBlock" 或 "index.insertBlock" 或 "user.myWorkflow" */
    id: string;
    /** 展示名称 */
    name: string;
    /** 描述，面向用户说明这个命令做什么 */
    description?: string;
    /** 用户命令的提示词（仅 user. 命令） */
    prompt?: string;
    /** 仅内置命令（commands.json）携带的默认参数配置 */
    seed?: { paramMapping?: string };
    /** 调度配置 */
    dispatch: DispatchConfig;
    /** 参数 Schema 列表（顺序即调用顺序） */
    params: ParamSchema[];
    /** 出参 Schema 列表（返回值与产出的变量字段） */
    outputs?: ParamSchema[];
    /** 执行约束 */
    constraints: CommandConstraints;
    /** 元信息 */
    meta: CommandMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry Implementation
// ─────────────────────────────────────────────────────────────────────────────

class CommandRegistry {
    private readonly store = new Map<string, CommandDef>();

    /**
     * 插件启动时调用。
     * 将 commands.json 中定义的内置命令全部载入内存 Map。
     */
    loadBuiltins(): void {
        let loaded = 0;
        for (const raw of (commandsData as any).commands) {
            const def = raw as CommandDef;
            if (!def.id) {
                console.warn("[Registry] Skipped a command entry with no id:", raw);
                continue;
            }
            this.store.set(def.id, def);
            loaded++;
        }
        this.loadUserCommandsFromStorage();
    }

    /**
     * 从 SQLite 数据库加载命令定义并刷新内存 Map。
     * 这让 SQLite 成为命令定义的 Source of Truth。
     */
    async loadFromDatabase(): Promise<void> {
        try {
            const { registry: registryTable } = getSystemTableNames();
            const res = await runQuery(`SELECT id, name, description, dispatch, params, constraints, meta FROM ${registryTable}`);
            if (!res || !res.values || res.values.length === 0) {
                console.warn("[Registry] No registry records found in SQLite, keeping existing builtins.");
                return;
            }

            let loaded = 0;
            for (const row of res.values) {
                const id = row[0];
                const name = row[1];
                const description = row[2];
                const dispatchRaw = row[3];
                const paramsRaw = row[4];
                const constraintsRaw = row[5];
                const metaRaw = row[6];

                if (!id) continue;

                try {
                    const existing = this.store.get(id);
                    const constraintsObj = constraintsRaw ? JSON.parse(constraintsRaw) : {};

                    const def: CommandDef = {
                        id,
                        name: name || "",
                        description: description || "",
                        outputs: existing?.outputs,
                        prompt: existing?.prompt,
                        dispatch: dispatchRaw ? JSON.parse(dispatchRaw) : { method: "custom" },
                        params: paramsRaw ? JSON.parse(paramsRaw) : [],
                        constraints: {
                            environment: constraintsObj.environment || "universal",
                            targetScope: constraintsObj.targetScope || "any",
                            comment: constraintsObj.comment
                        },
                        meta: metaRaw ? JSON.parse(metaRaw) : { contextNeed: "none", category: "custom", source: "plugin" }
                    };
                    if (existing && existing.dispatch.executor) {
                        def.dispatch.executor = existing.dispatch.executor;
                    }
                    this.store.set(id, def);
                    loaded++;
                } catch (parseErr) {
                    console.error(`[Registry] Error parsing registry record ID "${id}":`, parseErr);
                }
            }
        } catch (e) {
            console.error("[Registry] Failed to load registry from database, keeping existing builtins:", e);
        }
    }

    /**
     * 供第三方插件调用，动态注册一个自定义命令。
     */
    registerCommand(def: CommandDef): void {
        if (!def.id) throw new Error("[Registry] registerCommand: 'id' is required.");
        
        const isUserCmd = def.id.startsWith("user.") || def.meta?.source === "user";

        if (!isUserCmd) {
            const pluginName = def.meta?.plugin;
            if (!pluginName || typeof pluginName !== "string") {
                throw new Error(`[Registry] registerCommand: 'meta.plugin' is required and must be a string identifying the plugin.`);
            }

            const expectedPrefix = `plugin.${pluginName}.`;
            if (!def.id.startsWith(expectedPrefix)) {
                throw new Error(`[Registry] registerCommand: Command ID "${def.id}" must start with "${expectedPrefix}" to follow naming conventions.`);
            }
        }

        if (this.store.has(def.id)) {
            console.warn(`[Registry] Command "${def.id}" is being overwritten.`);
        }
        this.store.set(def.id, def);
        console.log(`[Registry] Successfully registered command:`, def.id, def.name);
    }

    /**
     * 注册用户自定义 user. 命令 (符合 Layer 1 Registry 规范)
     */
    registerUserCommand(userCmd: { id: string; name: string; description?: string; prompt?: string; icon?: string }): CommandDef {
        let cleanId = userCmd.id.trim();
        if (!cleanId.startsWith("user.")) {
            cleanId = `user.${cleanId}`;
        }

        const cmdDef: CommandDef = {
            id: cleanId,
            name: userCmd.name,
            description: userCmd.description || "",
            prompt: userCmd.prompt || "",
            dispatch: {
                method: "custom",
                executor: async (_params, _ctx) => {
                    console.log(`[UserCommand] Executing custom user command: ${cleanId}`, userCmd.prompt);
                    const { showMessage } = await import("siyuan");
                    showMessage(`🤖 执行自定义 User 命令: ${userCmd.name}`);
                }
            },
            params: [],
            constraints: { environment: "universal", targetScope: "none" },
            meta: { contextNeed: "none", category: "user", source: "user", plugin: "user", icon: userCmd.icon || "iconSparkles" }
        };

        this.registerCommand(cmdDef);
        this.saveUserCommandsToStorage();
        return cmdDef;
    }

    private saveUserCommandsToStorage() {
        try {
            const userCmds: any[] = [];
            for (const [id, def] of this.store) {
                if (id.startsWith("user.") || def.meta?.source === "user") {
                    userCmds.push({
                        id: def.id,
                        name: def.name,
                        description: def.description,
                        prompt: def.prompt,
                        icon: def.meta?.icon
                    });
                }
            }
            localStorage.setItem("indexos_custom_user_commands", JSON.stringify(userCmds));
        } catch (_) {}
    }

    public loadUserCommandsFromStorage() {
        try {
            const raw = localStorage.getItem("indexos_custom_user_commands");
            if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    for (const item of list) {
                        this.registerUserCommand(item);
                    }
                }
            }
        } catch (_) {}
    }

    /**
     * 卸载插件时调用，移除该插件注册的所有命令。
     */
    unregisterPlugin(pluginName: string): void {
        let removed = 0;
        for (const [id, def] of this.store) {
            if (def.meta.source === "plugin" && def.meta.plugin === pluginName) {
                this.store.delete(id);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[Registry] Unregistered ${removed} commands from plugin "${pluginName}".`);
        }
    }

    /** 按 ID 查询命令定义。找不到时返回 undefined。 */
    getCommand(id: string): CommandDef | undefined {
        if (!id) return undefined;
        const baseId = id.replace(/-\d+$/, "");
        return this.store.get(baseId);
    }

    /**
     * 注销命令（复合命令刷新 / 插件卸载用）。
     */
    unregisterCommand(id: string): void {
        if (!id) return;
        const baseId = id.replace(/-\d+$/, "");
        if (this.store.delete(baseId)) {
            console.log(`[Registry] Unregistered command: ${baseId}`);
        }
    }

    /** 检查某个命令 ID 是否存在于注册表中 */
    hasCommand(id: string): boolean {
        if (!id) return false;
        const baseId = id.replace(/-\d+$/, "");
        return this.store.has(baseId);
    }

    /** 获取所有已注册命令的副本（用于 UI 浏览和 command-db 渲染） */
    getAllCommands(): CommandDef[] {
        return Array.from(this.store.values());
    }

    /** 按分类筛选命令 */
    getCommandsByCategory(category: CommandCategory): CommandDef[] {
        return this.getAllCommands().filter(c => c.meta.category === category);
    }

    /** 只返回可定时调度的命令（作为定时任务引擎的候选集：包含 universal 通用命令） */
    getSchedulableCommands(): CommandDef[] {
        return this.getAllCommands().filter(c => c.constraints.environment === "universal");
    }

    /**
     * 精确与前缀查找：
     * 1. 按 ID 精确匹配（最优先）
     * 2. 按 name 完整精确匹配（忽略大小写）
     * 3. 按 name 前缀/包含匹配（仅正向查找，严禁逆向匹配以防歧义误触发）
     */
    findByNameOrId(idOrName: string): CommandDef | undefined {
        const cleanIdOrName = idOrName.replace(/-\d+$/, "");
        // 1. ID 精确匹配
        const byId = this.store.get(cleanIdOrName);
        if (byId) return byId;

        // 2. name 完整精确匹配
        const lower = cleanIdOrName.toLowerCase();
        for (const def of this.store.values()) {
            if (def.name.toLowerCase() === lower) return def;
        }

        // 3. name 前缀/包含匹配（仅正向：命令名称包含查询词）
        for (const def of this.store.values()) {
            if (def.name.toLowerCase().includes(lower)) return def;
        }
        return undefined;
    }
}

// 单例导出，全局唯一
export const commandRegistry = new CommandRegistry();
