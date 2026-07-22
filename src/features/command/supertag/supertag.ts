import { post } from "../../../shared/api-client/request";
import { SUPERTAG_REGISTRY, COMMAND_REGISTRY, getTypeAvId } from "../registration";
import { refreshSupertagRegistry } from "../utils/sync-service";
import { getGlobalTypeConfigs } from "../../data/av-setting/db-config";
import { type TypeConfig } from "../../data/av-setting/types";
import { showMessage } from "siyuan";
import { formatDate } from "../../../shared/utils";
import { getColIDMap } from "../../../shared/utils/av-utils";
import { tableSyncTimes, instantiateAV, getSqliteEngine } from "../../sqlite/sqlite-manager";
import { dispatchCommand, parseParam, updateContextVar, type CommandContext } from "../command-dispatcher";
import { SupertagRenderer } from "./SupertagRenderer";

export async function executeTsScript(scriptText: string, context: CommandContext, eventName?: string): Promise<boolean> {
    try {
        console.log(`[Supertag-TS] Executing dynamic TS/JS script for block ${context.blockEl?.getAttribute("data-node-id")} on event ${eventName}`);
        
        const delay = (ms: number | string) => {
            let numMs = typeof ms === "number" ? ms : 0;
            if (typeof ms === "string") {
                if (ms.endsWith("s")) numMs = parseFloat(ms) * 1000;
                else if (ms.endsWith("m")) numMs = parseFloat(ms) * 60 * 1000;
                else numMs = parseFloat(ms);
            }
            return new Promise(resolve => setTimeout(resolve, numMs));
        };

        const dispatch = async (commandId: string, params?: any) => {
            console.log(`[Supertag-TS-Dispatch] Executing dispatch("${commandId}") on event "${eventName}"`);
            const res = await dispatchCommand(commandId, params, context);
            if (res && res.id) {
                if (!context.vars) context.vars = {};
                context.vars.createdblock = res.id;
                context.vars.last_id = res.id;
                context.vars.id = res.id;
            }
            if (params && params._outputMapping) {
                if (!context.vars) context.vars = {};
                context.vars._outputMapping = params._outputMapping;
            }

            // 自动把命令产出的变量（出参）写回/建列落盘到 Layer 4 数据库
            const targetBlockId = context.blockEl?.getAttribute("data-node-id") || getBlockId(context);
            if (targetBlockId && context.supertag && context.vars) {
                await persistOutputVariablesToLayer4(targetBlockId, context.supertag, context.vars);
            }

            return res;
        };

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        
        let codeText = scriptText.trim();
        // 剥离顶部的 // 注释行，找到真实代码起始行
        const lines = codeText.split("\n");
        const firstCodeLineIndex = lines.findIndex(line => {
            const l = line.trim();
            return l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*");
        });

        if (firstCodeLineIndex > -1) {
            codeText = lines.slice(firstCodeLineIndex).join("\n").trim();
        }

        let body = codeText;
        if (body.startsWith("async ({") || body.startsWith("async (") || body.startsWith("({")) {
            body = `return (${body})(arguments[0]);`;
        } else if (body.startsWith("async function") || body.startsWith("function")) {
            body = `return (${body})(arguments[0]);`;
        } else {
            body = `return (async ({ dispatch, state, delay, context, eventName, showMessage, updateVar }) => {\n${body}\n})(arguments[0]);`;
        }

        console.log(`[Supertag-TS-CompiledBody] Executing compiled body for event "${eventName}":\n${body}`);

        const fn = new AsyncFunction("env", body);
        const env = {
            dispatch,
            state: { vars: context.vars },
            delay,
            context,
            eventName,
            showMessage,
            updateVar: (k: string, v: any, persist?: boolean) => updateContextVar(context, k, v, { persist })
        };

        await fn(env);
        return true;
    } catch (err) {
        console.error(`[Supertag-TS] Error executing dynamic TS/JS script:`, err);
        showMessage(`❌ TS 动态脚本执行报错: ${err}`, 5000, "error");
        return false;
    }
}

export interface TriggerCommandRef {
    labelOrId: string;
    args?: Record<string, any>;
}

export interface TriggerRule {
    event: string;
    condition: string;
    commands: TriggerCommandRef[];
}

export function splitCommands(text: string): string[] {
    const result: string[] = [];
    let current = "";
    let parenDepth = 0;
    let inQuotes = false;
    let quoteChar = "";
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === quoteChar && text[i - 1] !== "\\") {
                inQuotes = false;
            }
            current += char;
        } else {
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
                current += char;
            } else if (char === "(") {
                parenDepth++;
                current += char;
            } else if (char === ")") {
                parenDepth--;
                current += char;
            } else if ((char === "," || char === "，") && parenDepth === 0) {
                result.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
    }
    if (current.trim()) {
        result.push(current.trim());
    }
    return result;
}

export function parseCommandWithArgs(cmdStr: string): TriggerCommandRef {
    cmdStr = cmdStr.trim();
    const match = cmdStr.match(/^([^(]+)(?:\((.*)\))?$/);
    if (!match) {
        return { labelOrId: cmdStr };
    }
    
    const labelOrId = match[1].trim();
    const argsStr = match[2] ? match[2].trim() : "";
    if (!argsStr) {
        return { labelOrId };
    }
    
    const args: Record<string, any> = {};
    const regex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
    let argMatch;
    while ((argMatch = regex.exec(argsStr)) !== null) {
        const key = argMatch[1];
        const val = argMatch[2] ?? argMatch[3] ?? argMatch[4];
        
        if (val === "true") {
            args[key] = true;
        } else if (val === "false") {
            args[key] = false;
        } else if (!isNaN(Number(val)) && val.trim() !== "") {
            args[key] = Number(val);
        } else {
            args[key] = val;
        }
    }
    
    return { labelOrId, args };
}

export function parseConditionalString(text: string): TriggerRule[] {
    const rules: TriggerRule[] = [];
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    
    for (const line of lines) {
        const match = line.match(/^\[([^\]]+)\](?:\(([^\)]+)\))?\s*->\s*(.+)$/);
        if (match) {
            const rawEvent = match[1].trim();
            const condition = match[2] ? match[2].trim() : "";
            const cmdsText = match[3].trim();
            
            let event = "tag_created";
            if (rawEvent === "打上标签时" || rawEvent === "tag_created") {
                event = "tag_created";
            } else if (rawEvent === "移除标签时" || rawEvent === "tag_removed") {
                event = "tag_removed";
            } else if (rawEvent === "内容变动时" || rawEvent === "block_content_changed") {
                event = "block_content_changed";
            } else if (rawEvent === "属性变动时" || rawEvent === "block_attribute_changed") {
                event = "block_attribute_changed";
            } else if (rawEvent === "任务完成时" || rawEvent === "task_completed") {
                event = "task_completed";
            } else {
                event = rawEvent;
            }
            
            const commandTokens = splitCommands(cmdsText);
            const commands = commandTokens.map(parseCommandWithArgs);
            rules.push({ event, condition, commands });
        } else {
            // Fallback for legacy comma-separated lists
            const commandTokens = splitCommands(line);
            if (commandTokens.length > 0) {
                rules.push({
                    event: "tag_created",
                    condition: "",
                    commands: commandTokens.map(parseCommandWithArgs)
                });
            }
        }
    }
    return rules;
}

export class SupertagMonitor {
    private dataRegistry: TypeConfig[] = [];
    private lastUpdate = 0;
    private tagCache = new Map<string, Set<string>>();

    private refreshBoundHandler = this.refreshRegistry.bind(this);

    constructor() {
        window.addEventListener("index-plugin-refresh-supertags", this.refreshBoundHandler);
    }

    async refreshRegistry() {
        // 1. Refresh Logic Registry (Layer 3)
        await refreshSupertagRegistry();

        // 2. Refresh Data Component Registry (Layer 4 - Scanning individual DBs)
        this.dataRegistry = await getGlobalTypeConfigs();

        this.lastUpdate = Date.now();
    }

    public getDataRegistry(): TypeConfig[] {
        return this.dataRegistry.filter(c => this.isTagEnabled(c.typeName));
    }

    public isTagEnabled(tagName: string, isLogicTag?: boolean): boolean {
        const tagKey = tagName.toLowerCase();
        const prefs = this.prefs as any;

        // Check if explicitly disabled or enabled in prefs
        if (prefs.disabledTags && prefs.disabledTags[tagKey] === true) {
            return false;
        }
        if (prefs.enabledTags && prefs.enabledTags[tagKey] === true) {
            return true;
        }

        // Default behavior if not explicitly overridden by user:
        // 如果是 命令tag (isLogicTag = true)，默认启用 (true)
        // 如果是 纯数据tag (isLogicTag = false)，默认禁用 (false)
        if (isLogicTag !== undefined) {
            return isLogicTag;
        }
        
        // Fallback: check if it exists in SUPERTAG_REGISTRY
        const isRegisteredLogic = SUPERTAG_REGISTRY.some(l => l.typeTag.toLowerCase() === tagKey);
        return isRegisteredLogic;
    }

    public async setTagEnabled(tagName: string, enabled: boolean) {
        const tagKey = tagName.toLowerCase();
        if (!(this.prefs as any).enabledTags) (this.prefs as any).enabledTags = {};
        if (!(this.prefs as any).disabledTags) (this.prefs as any).disabledTags = {};

        if (enabled) {
            (this.prefs as any).enabledTags[tagKey] = true;
            delete (this.prefs as any).disabledTags[tagKey];
        } else {
            (this.prefs as any).disabledTags[tagKey] = true;
            delete (this.prefs as any).enabledTags[tagKey];
        }

        if (this.pluginInstance) {
            await this.pluginInstance.saveData("supertag-prefs.json", this.prefs);
        }
    }
    private boundHandler = this.handleWsMessage.bind(this);
    private pluginInstance: any = null;

    private prefs: Record<string, string> = {};

    init(plugin: any) {
        this.pluginInstance = plugin;
        if (this.pluginInstance && this.pluginInstance.eventBus) {
            this.pluginInstance.eventBus.on("ws-main", this.boundHandler);

            // Load preferences
            this.pluginInstance.loadData("supertag-prefs.json").then((data: any) => {
                if (data) this.prefs = data;
            }).catch(() => { });

            // Refresh registry once on initialization
            this.refreshRegistry().catch(e => {
                console.error("[Supertag] Failed to refresh registry during init:", e);
            });
        } else {
            console.error("[Supertag] Failed to start monitor: Plugin eventbus not provided.");
        }
    }

    async setPreferredConfig(typeName: string, avId: string) {
        this.prefs[typeName] = avId;
        if (this.pluginInstance) {
            await this.pluginInstance.saveData("supertag-prefs.json", this.prefs);
        }
    }

    public getPreferredConfig(typeName: string) {
        return this.prefs[typeName];
    }

    public async processBlockContentChanged(blockId: string) {
        let tags = this.tagCache.get(blockId);
        if (!tags) {
            try {
                const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
                const rawVal = attrsRes ? attrsRes["custom-supertags"] : null;
                if (rawVal) {
                    const parsed = JSON.parse(rawVal);
                    if (Array.isArray(parsed)) {
                        tags = new Set(parsed.map(t => String(t).trim().toLowerCase()));
                        this.tagCache.set(blockId, tags);
                    }
                }
            } catch (_) {}
        }
        if (!tags) tags = new Set<string>();
        
        if (tags.size > 0) {
            for (const tag of tags) {
                await this.triggerConditionalCommands(blockId, tag, "block_content_changed");
            }
        }
    }

    public async processTaskCompleted(blockId: string) {
        let tags = this.tagCache.get(blockId);
        if (!tags) {
            try {
                const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
                const rawVal = attrsRes ? attrsRes["custom-supertags"] : null;
                if (rawVal) {
                    const parsed = JSON.parse(rawVal);
                    if (Array.isArray(parsed)) {
                        tags = new Set(parsed.map(t => String(t).trim().toLowerCase()));
                        this.tagCache.set(blockId, tags);
                    }
                }
            } catch (_) {}
        }
        if (!tags) tags = new Set<string>();
        // Ensure "task" supertag is always present so task_completed triggers default task rules
        tags.add("task");
        
        for (const tag of tags) {
            await this.triggerConditionalCommands(blockId, tag, "task_completed");
        }
    }

    destroy() {
        window.removeEventListener("index-plugin-refresh-supertags", this.refreshBoundHandler);
        if (this.pluginInstance && this.pluginInstance.eventBus) {
            this.pluginInstance.eventBus.off("ws-main", this.boundHandler);
        }
    }

    private async handleWsMessage({ detail }: any) {
        if (detail.cmd !== "transactions") return;

        const transactions = detail.data;
        for (const trans of transactions) {
            for (const op of trans.doOperations) {
                // Focus on operations that carry tag info: update (DOM), insert (DOM), setAttrs (JSON string), updateAttrs (Object/JSON)
                if (op.action === "update" || op.action === "insert" || op.action === "setAttrs" || op.action === "updateAttrs") {
                    const blockId = op.id;
                    if (!blockId || !op.data) continue;

                    // If it is a DOM update/insert, intercept and migrate native tags
                    if (op.action === "update" || op.action === "insert") {
                        await this.detectAndMigrateNativeTags(blockId, op.data);
                    }

                    // Extract all tags currently embedded in the operation payload
                    const newTags = this.extractTagsFromPayload(op.data, op.action, blockId);
                    
                    // Fetch existing tags from cache or lazily from Siyuan API if cache is empty (e.g. document just loaded)
                    let oldTags = this.tagCache.get(blockId);
                    if (!oldTags) {
                        try {
                            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
                            const rawVal = attrsRes ? attrsRes["custom-supertags"] : null;
                            if (rawVal) {
                                const parsed = JSON.parse(rawVal);
                                if (Array.isArray(parsed)) {
                                    oldTags = new Set(parsed.map(t => String(t).trim().toLowerCase()));
                                    this.tagCache.set(blockId, oldTags);
                                }
                            }
                        } catch (_) {}
                    }
                    if (!oldTags) oldTags = new Set<string>();

                    const activeTags = newTags !== null ? newTags : oldTags;

                    if (newTags !== null) {
                        this.tagCache.set(blockId, newTags);
                    }

                    // Detect if tags list was actually added/removed in this transaction
                    let tagsChanged = false;
                    if (newTags !== null) {
                        if (newTags.size !== oldTags.size) {
                            tagsChanged = true;
                        } else {
                            for (const t of newTags) {
                                if (!oldTags.has(t)) {
                                    tagsChanged = true;
                                    break;
                                }
                            }
                        }
                    }

                    // Trigger block changes if it is a normal edit (no tag modification in this transaction)
                    if (!tagsChanged && activeTags.size > 0) {
                        if (op.action === "update") {
                            for (const tag of activeTags) {
                                await this.triggerConditionalCommands(blockId, tag, "block_content_changed");
                            }
                        } else if (op.action === "setAttrs" || op.action === "updateAttrs") {
                            for (const tag of activeTags) {
                                await this.triggerConditionalCommands(blockId, tag, "block_attribute_changed");
                            }
                        }
                    }
                }
            }
        }
    }

    private async detectAndMigrateNativeTags(blockId: string, payload: any) {
        if (!payload || typeof payload !== "string") {
            return;
        }
        if (!payload.includes('data-type="tag"') && !payload.includes('data-type="NodeTag"')) {
            return;
        }

        try {
            // Query all registered supertags from SQLite sys_type_db
            const { db } = await getSqliteEngine();
            const res = db.exec(`SELECT supertag FROM sys_type_db`);
            if (res.length === 0 || res[0].values.length === 0) {
                return;
            }

            const supertags = new Set(
                res[0].values.map((row: any) => 
                    String(row[0]).replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase()
                ).filter(Boolean)
            );

            // Parse HTML to find matching tags
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = payload;
            const tagEls = tempDiv.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
            
            const tagsToMigrate: string[] = [];
            tagEls.forEach((el: any) => {
                const tagText = (el.textContent || el.getAttribute("data-content") || "")
                    .replace(/#/g, '')
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim()
                    .toLowerCase();
                if (supertags.has(tagText)) {
                    tagsToMigrate.push(tagText);
                    el.remove();
                }
            });

            if (tagsToMigrate.length === 0) {
                return;
            }

            console.log(`[Supertag-Migration] Intercepted native tags to migrate on block ${blockId}:`, tagsToMigrate);

            // Get current custom-supertags
            const attrsRes = await post("/api/attr/getBlockAttrs", { id: blockId });
            const attrs = attrsRes || {};
            const rawTags = attrs["custom-supertags"];
            let currentCustom: string[] = [];
            if (rawTags) {
                try {
                    const parsed = JSON.parse(rawTags);
                    if (Array.isArray(parsed)) currentCustom = parsed;
                } catch (_) {}
            }

            // Add newly migrated tags
            const updatedCustom = Array.from(new Set([...currentCustom, ...tagsToMigrate]));

            // Set the custom-supertags attribute directly on the DOM wrapper div inside tempDiv
            const blockDiv = tempDiv.firstElementChild as HTMLElement;
            if (blockDiv) {
                blockDiv.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
            }

            // Update block attributes first
            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    "custom-supertags": JSON.stringify(updatedCustom)
                }
            });

            // Check if the block is currently in the active editor DOM
            const activeProtyle = (window as any).activeProtyleInstance;
            let blockInActiveEditor = false;

            if (activeProtyle) {
                const blockEl = activeProtyle.element.querySelector(`[data-node-id="${blockId}"]`);
                if (blockEl) {
                    blockInActiveEditor = true;
                    
                    const oldHTML = blockEl.outerHTML;
                    
                    // Create clean DOM replica
                    const temp = document.createElement("div");
                    temp.innerHTML = oldHTML;
                    const innerBlock = temp.firstElementChild as HTMLElement;
                    if (innerBlock) {
                        innerBlock.setAttribute("custom-supertags", JSON.stringify(updatedCustom));
                        const tagEls = innerBlock.querySelectorAll('[data-type="tag"], [data-type="NodeTag"]');
                        tagEls.forEach((el: any) => {
                            const text = (el.textContent || "").replace(/#/g, '').trim().toLowerCase();
                            if (supertags.has(text)) el.remove();
                        });
                    }
                    const cleanHTML = temp.innerHTML.trim();

                    // Natively tell Siyuan to execute a transaction update on the editor model
                    try {
                        activeProtyle.updateTransaction(blockId, cleanHTML, oldHTML);
                    } catch (e) {
                        console.error("[Supertag] Native updateTransaction failed, falling back:", e);
                        blockInActiveEditor = false;
                    }

                    // Render capsule pill
                    SupertagRenderer.render(activeProtyle);
                }
            }

            // If not in the active editor, safely update block content via API
            if (!blockInActiveEditor) {
                const cleanDOM = tempDiv.innerHTML.trim();
                await post("/api/block/updateBlock", {
                    id: blockId,
                    dataType: "dom",
                    data: cleanDOM
                });
            }

            // Explicitly trigger processNewTag for the newly migrated tags!
            for (const tag of tagsToMigrate) {
                await this.processNewTag(blockId, tag);
            }
        } catch (err) {
            console.error("[Supertag-Migration] Error during native tag auto migration:", err);
        }
    }

    private extractTagsFromPayload(payload: any, action?: string, opId?: string): Set<string> | null {
        if (!payload) return new Set<string>();

        // 1. Try extracting from HTML DOM payload (actions: update, insert)
        if (typeof payload === "string" && payload.includes("<") && payload.includes(">")) {
            const match = payload.match(/custom-supertags="([^"]+)"/);
            if (match) {
                const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                const tags = new Set<string>();
                try {
                    const parsed = JSON.parse(decoded);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((t: any) => {
                            const clean = String(t || "").trim();
                            if (clean) tags.add(clean);
                        });
                    }
                } catch (_) {}
                return tags;
            }
            // If DOM doesn't have custom-supertags attribute, it means this content update
            // does not carry attribute changes. We return null to preserve current cached tags.
            return null;
        }

        // 2. Try extracting from JSON object or string (actions: setAttrs, updateAttrs)
        let attrs: any = null;
        if (typeof payload === "object") {
            attrs = payload.new || payload;
        } else if (typeof payload === "string" && payload.trim().startsWith("{")) {
            try {
                attrs = JSON.parse(payload);
                if (attrs.new) attrs = attrs.new;
            } catch (_) {}
        }

        if (attrs && attrs["custom-supertags"] !== undefined) {
            const rawVal = attrs["custom-supertags"];
            const tags = new Set<string>();
            if (rawVal) {
                try {
                    const parsed = JSON.parse(rawVal);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((t: any) => {
                            const clean = String(t || "").trim();
                            if (clean) tags.add(clean);
                        });
                    }
                } catch (_) {
                    // Fallback
                    const sep = rawVal.includes(',') ? ',' : ' ';
                    rawVal.split(sep).forEach((t: string) => {
                        const clean = t.trim().replace(/#/g, '');
                        if (clean) tags.add(clean);
                    });
                }
            }
            return tags;
        }

        // Also check legacy "tags" or "tag" in case we want to support fallback (optional, let's keep only custom-supertags for clean take over)
        return null; // Signifies "no custom-supertags updates in this transaction"
    }

    public async processNewTag(blockId: string, tag: string) {
        try {
            const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
            console.log(`[Supertag] 🏷️ Processing supertag #${cleanTag} for block "${blockId}"...`);

            // --- Step 1: Data Component Persistence (Layer 4) ---
            // 确保全量扫描刷新 TypeConfigs
            this.dataRegistry = await getGlobalTypeConfigs();

            let dataMatches = this.dataRegistry.filter(c =>
                this.isTagEnabled(c.typeName) && c.typeName.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase() === cleanTag
            );

            const isLogicTag = SUPERTAG_REGISTRY.some(l => l.typeTag.toLowerCase() === cleanTag);
            const tagEnabled = this.isTagEnabled(cleanTag, isLogicTag);

            // 检查绑定的命令中是否有需要跨步骤/持久化输出的逻辑（例如含有 _outputMapping，或使用了 {{var.createdblock}} 等跨命令出参入参映射）
            const boundCommands = SUPERTAG_REGISTRY.filter(l => l.typeTag.toLowerCase() === cleanTag);
            const requiresPersistence = !isLogicTag || boundCommands.some(cmd => {
                const pm = cmd.paramMapping || "";
                return pm.includes("_outputMapping") || pm.includes("{{var.") || pm.includes("createdblock") || pm.includes("updatedblock");
            });

            let targetConfig: TypeConfig | null = null;

            if (dataMatches.length > 0) {
                targetConfig = dataMatches[0];
                if (dataMatches.length > 1) {
                    const prefAvId = this.prefs[cleanTag];
                    if (prefAvId) {
                        targetConfig = dataMatches.find(c => c.avId === prefAvId) || targetConfig;
                    }
                }
            } else if (tagEnabled && requiresPersistence) {
                // 如果开启且需要持久化（纯数据tag 或 含有出参落盘/跨命令变量映射的命令tag，如 permanent），自动建立数据库
                // 对于在一个管道中即时流转、无需持久化的命令 tag，默认不新建数据库
                console.log(`[Supertag] No existing AV found for enabled tag #${cleanTag} (requiresPersistence=${requiresPersistence}). Instantiating new AV database under IndexOS / data-dbs...`);
                try {
                    const { getOrStoreDataDbDoc } = await import("../data-db-management");
                    const newDb = await getOrStoreDataDbDoc(cleanTag);
                    if (newDb.avId) {
                        targetConfig = {
                            typeName: cleanTag,
                            avId: newDb.avId,
                            blockId: newDb.docId,
                            avName: cleanTag
                        };
                        // 重新刷一遍 global type configs
                        this.dataRegistry = await getGlobalTypeConfigs();
                    }
                } catch (instErr) {
                    console.error(`[Supertag] Failed to auto-create AV database under data-dbs for #${cleanTag}:`, instErr);
                }
            }

            if (targetConfig) {
                console.log(`[Supertag] Step 1: Binding block "${blockId}" as row in Layer 4 AV "${targetConfig.avName}" (${targetConfig.avId})...`);
                await this.applySupertag(blockId, cleanTag, targetConfig);
            } else {
                console.log(`[Supertag] Step 1: No Layer 4 AV matching #${cleanTag} bound.`);
            }

            // --- Step 2: Execute Trigger Commands (Layer 3 trigger) ---
            console.log(`[Supertag] Step 2: Executing conditional trigger commands for #${cleanTag}...`);
            await this.triggerConditionalCommands(blockId, cleanTag, "tag_created");
        } catch (e) {
            console.error("[Supertag] Failed to process new tag:", blockId, e);
        }
    }

    public async processRemovedTag(blockId: string, tag: string) {
        try {
            const cleanTag = tag.replace(/#/g, "").replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
            
            // Trigger tag_removed commands
            await this.triggerConditionalCommands(blockId, cleanTag, "tag_removed");
        } catch (e) {
            console.error("[Supertag] Failed to process removed tag:", blockId, e);
        }
    }

    private async triggerConditionalCommands(
        blockId: string, 
        cleanTag: string, 
        eventName: "tag_created" | "tag_removed" | "block_content_changed" | "block_attribute_changed" | "task_completed"
    ) {
        const typeAvId = getTypeAvId();
        if (!typeAvId) return;

        try {
            const tableName = `av_${typeAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const { db } = await getSqliteEngine();
            
            // Find primary key column name (usually block type)
            const schemaCols = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [typeAvId]);
            let supertagColName = "supertag";
            if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
                supertagColName = String(schemaCols[0].values[0][0]);
            }

            // Find Conditional trigger column name
            const schemaConditional = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Conditional' OR key_name = '触发器' OR key_name = 'On Create' OR key_name = '创建时')`, [typeAvId]);
            let conditionalColName = "Conditional";
            if (schemaConditional.length > 0 && schemaConditional[0].values.length > 0) {
                conditionalColName = String(schemaConditional[0].values[0][0]);
            }

            const typeDbRes = db.exec(`SELECT "${conditionalColName}" FROM ${tableName} WHERE LOWER("${supertagColName}") = '#${cleanTag}' OR LOWER("${supertagColName}") = '${cleanTag}'`);

            if (typeDbRes && typeDbRes.length > 0 && typeDbRes[0].values.length > 0) {
                const conditionalVal = String(typeDbRes[0].values[0][0] || "").trim();
                if (conditionalVal) {
                    const doc = document;
                    const blockEl = doc.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement || doc.createElement("div");
                    if (blockEl && !blockEl.getAttribute("data-node-id")) {
                        blockEl.setAttribute("data-node-id", blockId);
                    }

                    const protyle = (window as any).siyuan?.ws?.protyle || null;
                    const pipelineVars: Record<string, any> = {};

                    // 1. 自动预加载目标块的持久化属性到 pipelineVars 中 (统一 vars 属性池)
                    try {
                        const attrRes = await post("/api/attr/getBlockAttrs", { id: blockId });
                        if (attrRes && typeof attrRes === "object") {
                            for (const [k, v] of Object.entries(attrRes)) {
                                pipelineVars[k] = v;
                                if (k.startsWith("custom-")) {
                                    const cleanKey = k.replace(/^custom-/, "");
                                    pipelineVars[cleanKey] = v;
                                }
                            }
                        }
                        const taskVal = pipelineVars["index-task"] || pipelineVars["task-status"] || pipelineVars["task_status"] || (eventName === "task_completed" ? "completed" : "pending");
                        pipelineVars["completed"] = taskVal;
                        pipelineVars["task_status"] = taskVal;
                        pipelineVars["task-status"] = taskVal;
                        pipelineVars["index-task"] = taskVal;

                        console.log(`[Supertag-Debug] Pre-loaded block attributes for ${blockId} on event ${eventName}:`, pipelineVars);
                    } catch (e) {
                        console.warn(`[Supertag-Trigger] Failed to pre-load block attributes for ${blockId}:`, e);
                    }

                    const context: CommandContext = {
                        blockEl,
                        protyleEl: protyle?.element || null,
                        protyle,
                        supertag: cleanTag,
                        vars: pipelineVars
                    };

                    // 2. 判定是否为原生 TS/JS 动态脚本模式
                    const isTsScript = conditionalVal.includes("async") || conditionalVal.includes("dispatch(") || (conditionalVal.includes("=>") && !conditionalVal.includes("->"));
                    if (isTsScript) {
                        console.log(`[Supertag-Trigger] Executing native TS/JS dynamic script for tag #${cleanTag} on event ${eventName}`);
                        await executeTsScript(conditionalVal, context, eventName);
                        return;
                    }

                    // 3. 否则走结构化命令管道解析
                    const rules = parseConditionalString(conditionalVal);
                    const targetRule = rules.find(r => r.event === eventName);

                    if (targetRule && targetRule.commands.length > 0) {
                        let conditionMet = true;
                        if (targetRule.condition) {
                            console.log(`[Supertag-Trigger] Evaluating condition: ${targetRule.condition}`);
                        }

                        if (conditionMet) {
                            console.log(`[Supertag-Trigger] Condition met. Executing commands for tag #${cleanTag} on event ${eventName}:`, targetRule.commands);

                            for (const cmdObj of targetRule.commands) {
                                const cmdLabel = cmdObj.labelOrId;
                                const cmdInfo = COMMAND_REGISTRY[cmdLabel];
                                const commandRef = cmdInfo?.commandRef || cmdLabel;
                                
                                const baseParamMapping = cmdInfo?.paramMapping || "";
                                const baseParams = parseParam(baseParamMapping);
                                const inlineArgs = cmdObj.args || {};
                                const mergedParams = Object.assign({}, baseParams, inlineArgs);

                                console.log(`[Supertag-Trigger] Dispatching command: "${cmdLabel}" (ID: ${commandRef}) on block ${blockId} with merged params:`, mergedParams);

                                try {
                                    const dispatchRes = await dispatchCommand(commandRef, mergedParams, context);
                                    if (!dispatchRes.success || dispatchRes.continue === false || dispatchRes.value === false || dispatchRes.status === "break") {
                                        console.log(`[Supertag-Trigger] Pipeline execution halted: Command "${cmdLabel}" returned break, false, or failed.`);
                                        break;
                                    }
                                } catch (cmdErr) {
                                    console.error(`[Supertag-Trigger] Failed to dispatch command: ${cmdLabel}`, cmdErr);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[Supertag-Trigger] Error triggering ${eventName} commands:`, e);
        }
    }

    private async applySupertag(blockId: string, cleanTag: string, config: TypeConfig) {
        try {
            const avId = config.avId;
            console.log(`[Supertag-Debug] Applying supertag: "${cleanTag}" for block "${blockId}". Database: "${config.avName}" (${avId})`);

            // 1. Get current state of the AV
            const { blockToItem, idToType, keyValues } = await getColIDMap(avId);
            let itemId = blockToItem.get(blockId);
            console.log(`[Supertag-Debug] Current block to item mapping: "${itemId || 'not found'}"`);

            if (!itemId) {
                // 2. Add block to AV if not present
                // @ts-ignore
                itemId = window.Lute.NewNodeID();
                console.log(`[Supertag-Debug] Block not in database. Generating new itemId: "${itemId}" and adding block...`);

                const addRes = await post("/api/av/addAttributeViewBlocks", {
                    avID: avId,
                    srcs: [{ itemID: itemId, id: blockId, isDetached: false }]
                });
                console.log(`[Supertag-Debug] addAttributeViewBlocks response:`, JSON.stringify(addRes));

                // Wait 300ms for Siyuan to complete disk/memory write transaction for new row
                await new Promise(r => setTimeout(r, 300));
            } else {
                // 3. IDEMPOTENCY check
                if (config.typeFieldId && config.mappedValue !== undefined) {
                    const colKV = keyValues.find(kv => kv.key.id === config.typeFieldId);
                    if (colKV && colKV.values) {
                        const cell = colKV.values.find((v: any) => (v.itemID || v.itemId || v.id) === itemId);
                        if (cell) {
                            const currentVal = (cell.mSelect?.[0]?.content || cell.text?.content || cell.number?.content || cell.content || "").toString();
                            console.log(`[Supertag-Debug] Idempotency check. Column: "${colKV.key.name}", expected: "${config.mappedValue}", current: "${currentVal}"`);
                            if (currentVal === config.mappedValue.toString()) {
                                console.log(`[Supertag-Debug] Value matches expected. Skipping update.`);
                                return;
                            }
                        }
                    }
                }
            }

            // 4. Set specific attribute value
            if (config.typeFieldId && config.mappedValue !== undefined) {
                const colType = idToType[config.typeFieldId] || "text";
                const valuePayload = this.formatValue(String(config.mappedValue).trim(), colType);
                console.log(`[Supertag-Debug] Setting column ${config.typeFieldId} (type: ${colType}) to value:`, JSON.stringify(valuePayload));

                const setRes = await post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: avId,
                    values: [{
                        keyID: config.typeFieldId,
                        itemID: itemId,
                        value: valuePayload
                    }]
                });
                console.log(`[Supertag-Debug] batchSetAttributeViewBlockAttrs response:`, JSON.stringify(setRes));
            }

            // Clear SQLite cache and force sync to SQLite in-memory DB immediately
            tableSyncTimes.delete(avId);
            console.log(`[Supertag-Debug] Cleared SQLite sync cache for AV: "${avId}". Force-synchronizing AV to SQLite...`);
            await instantiateAV(avId, true);
            console.log(`[Supertag-Debug] SQLite synchronization complete.`);

            // 5. Force UI refresh
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: blockId, data: formatDate(new Date()) }] }]
            });

            showMessage(`✨ Supertag: 已自动同步至 "${config.avName || cleanTag}"`);

        } catch (e) {
            console.error("[Supertag] Failed to apply data sync:", e);
        }
    }


    private formatValue(val: string, colType: string) {

        if (colType === "number") {
            const numContent = Number(val);
            return {
                type: "number",
                number: { content: isNaN(numContent) ? 0 : numContent, isNotEmpty: true }
            };
        } else if (colType === "text" || colType === "block") {
            return {
                type: "text",
                text: { content: val }
            };
        } else if (colType === "select" || colType === "mSelect") {
            return {
                type: colType,
                mSelect: [{ content: val, color: "" }]
            };
        } else {
            // Best effort generic fallback for other column types
            return {
                type: "mSelect",
                mSelect: [{ content: val, color: "" }]
            };
        }
    }
}

export const supertagMonitor = new SupertagMonitor();

/**
 * 将命令执行后产出的变量 (例如 createdblock = "20260721...")
 * 自动写入 Layer 4 对应 Supertag 的数据库中。
 * 如果对应列 (Column) 不存在，自动建列并落盘！
 */
export async function persistOutputVariablesToLayer4(
    blockId: string,
    cleanTag: string,
    outputVars: Record<string, any>
) {
    if (!blockId || !cleanTag || !outputVars || Object.keys(outputVars).length === 0) return;

    try {
        // 1. 查找此 supertag 对应的 Layer 4 AV 数据库
        const configs = await getGlobalTypeConfigs();
        const tagMatch = configs.find(c => c.typeName.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase() === cleanTag.toLowerCase());
        
        if (!tagMatch) {
            console.log(`[Supertag-Output] Layer 4 AV for supertag #${cleanTag} not found. Skipping output persistence.`);
            return;
        }

        const avId = tagMatch.avId;
        let { blockToItem } = await getColIDMap(avId);
        let itemId = blockToItem.get(blockId);

        if (!itemId) {
            // 若块尚未在该 AV 数据库行中，实时补齐添加该块为独立行
            const newGenItemId = window.Lute?.NewNodeID() || Date.now().toString();
            await post("/api/av/addAttributeViewBlocks", {
                avID: avId,
                srcs: [{ itemID: newGenItemId, id: blockId, isDetached: false }]
            });
            await sleep(300);
            const refreshedMap = await getColIDMap(avId);
            itemId = refreshedMap.blockToItem.get(blockId) || newGenItemId;
        }

        // 2. 获取当前 AV 的全量列定义 (Keys)
        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
        const existingKeys: any[] = Array.isArray(keysRes) ? keysRes : (keysRes?.keys || []);
        let lastKeyId = existingKeys.length > 0 ? existingKeys[existingKeys.length - 1].id : "";

        // 仅收集在 _outputMapping 中被用户显式命名/映射的出参变量！
        const mappingAliases = (outputVars._outputMapping || {}) as Record<string, string>;
        const targetOutputEntries: [string, string][] = [];

        for (const [outKey, alias] of Object.entries(mappingAliases)) {
            if (!alias) continue;
            // 尝试按出参别名 alias 或原始出参键名 outKey 查找解出的真实变量值
            const val = outputVars[alias] ?? outputVars[outKey] ?? outputVars.id ?? outputVars.createdblock ?? outputVars.last_id;
            if (val !== undefined && val !== null && String(val).trim() !== "") {
                targetOutputEntries.push([alias, String(val).trim()]);
            }
        }

        // 兜底：若未显式指定 _outputMapping 但存在 createdblock 出参，也记录为 createdblock
        if (targetOutputEntries.length === 0 && outputVars.createdblock) {
            targetOutputEntries.push(["createdblock", String(outputVars.createdblock).trim()]);
        }

        if (targetOutputEntries.length === 0) return;

        console.log(`[Supertag-Output] 📤 Persisting ${targetOutputEntries.length} explicit output variables to Layer 4 AV #${cleanTag} (${avId}):`, targetOutputEntries);

        // 3. 逐个检查并自动建列 (Auto-create missing Column)
        for (const [colName, valStr] of targetOutputEntries) {
            let keyObj = existingKeys.find((k: any) => k.name === colName);
            let keyId = keyObj?.id;

            if (!keyId) {
                // 动态自动新增列！
                // @ts-ignore
                keyId = window.Lute.NewNodeID();
                console.log(`[Supertag-Output] ✨ Auto-creating missing Text Column "${colName}" in Layer 4 AV #${cleanTag}...`);
                
                await post("/api/av/addAttributeViewKey", {
                    avID: avId,
                    keyID: keyId,
                    keyName: colName,
                    keyType: "text",
                    keyIcon: "iconText",
                    previousKeyID: lastKeyId
                });

                lastKeyId = keyId;
                existingKeys.push({ id: keyId, name: colName, type: "text" });
                await new Promise(r => setTimeout(r, 200));
            }

            // 4. 将出参数据写入对应列的单元格中！
            console.log(`[Supertag-Output] 💾 Writing cell value for Column "${colName}": ${valStr}`);
            await post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID: avId,
                values: [{
                    keyID: keyId,
                    itemID: itemId,
                    value: {
                        type: "text",
                        text: { content: valStr }
                    }
                }]
            });
        }

        // 清理 SQLite 刷新缓存
        tableSyncTimes.delete(avId);
        await instantiateAV(avId, true);
        console.log(`[Supertag-Output] ✅ Successfully persisted output variables into Layer 4 AV #${cleanTag}`);

    } catch (e) {
        console.error(`[Supertag-Output] Error persisting output variables to Layer 4:`, e);
    }
}
