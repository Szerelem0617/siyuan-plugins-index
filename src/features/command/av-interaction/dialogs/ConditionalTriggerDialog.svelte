<script lang="ts">
    import { onMount } from "svelte";
    import { COMMAND_BINDINGS } from "../../registration";

    export let dialog: any;
    export let supertag: string;
    export let boundCommands: { label: string; rowId: string; commandRef?: string }[];
    export let currentValue: string;
    export let onSave: (updatedValue: string) => Promise<void>;

    interface EventConfig {
        condition: string;
        selectedList: string[];
    }

    let eventConfigs: Record<string, EventConfig> = {
        tag_created: { condition: "", selectedList: [] },
        tag_removed: { condition: "", selectedList: [] },
        block_content_changed: { condition: "", selectedList: [] },
        block_attribute_changed: { condition: "", selectedList: [] },
        task_completed: { condition: "", selectedList: [] }
    };

    let activeEvent: string = "tag_created";
    let activeEventIds: string[] = ["tag_created"];
    let isAddDropdownOpen: boolean = false;

    const ALL_EVENT_TYPES = [
        { id: "tag_created", label: "添加标签时" },
        { id: "tag_removed", label: "移除标签时" },
        { id: "block_content_changed", label: "内容变动时" },
        { id: "block_attribute_changed", label: "属性变动时" },
        { id: "task_completed", label: "任务完成时" }
    ];

    $: activeEventTypes = ALL_EVENT_TYPES.filter(ev => activeEventIds.includes(ev.id));
    $: remainingEventTypes = ALL_EVENT_TYPES.filter(ev => !activeEventIds.includes(ev.id));

    function activateEvent(eventType: string) {
        if (!activeEventIds.includes(eventType)) {
            activeEventIds = [...activeEventIds, eventType];
        }
    }

    function addEvent(id: string) {
        activateEvent(id);
        activeEvent = id;
        isAddDropdownOpen = false;
    }

    function removeEvent(id: string, e: MouseEvent) {
        e.stopPropagation();
        if (id === "tag_created") return;
        activeEventIds = activeEventIds.filter(i => i !== id);
        if (eventConfigs[id]) {
            eventConfigs[id].selectedList = [];
            eventConfigs[id].condition = "";
        }
        if (activeEvent === id) {
            activeEvent = "tag_created";
        }
    }

    function splitCommands(text: string): string[] {
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

    function resolveLabelFromRef(refOrLabel: string): string {
        const base = refOrLabel.split("(")[0].trim();
        const argsStr = refOrLabel.includes("(") ? refOrLabel.slice(refOrLabel.indexOf("(")) : "";
        const bound = boundCommands.find(c => c.commandRef === base || c.label === base);
        if (bound) return bound.label + argsStr;
        for (const [lbl, def] of Object.entries(COMMAND_BINDINGS)) {
            if (def.commandRef === base || lbl === base) {
                return lbl + argsStr;
            }
        }
        return refOrLabel;
    }

    // Helper parser for multiline configurations & TS dynamic scripts
    function parseConditional(text: string) {
        text = (text || "").trim();
        activeEventIds = ["tag_created"];
        activeEvent = "tag_created";

        // Reset eventConfigs to ensure fresh parsing without duplicates
        for (const key of Object.keys(eventConfigs)) {
            eventConfigs[key].selectedList = [];
            eventConfigs[key].condition = "";
        }

        if (!text) return;

        // 1. 如果包含 TS 脚本或者带有 // 注释
        if (text.includes("async") || text.includes("dispatch(") || text.includes("//")) {
            // 首先尝试从顶部的注释行中精确读取说明： // [打上标签时] -> ☑ 转换为任务
            const commentLineRegex = /\/\/\s*\[([^\]]+)\](?:\(([^\)]+)\))?\s*->\s*(.+)/g;
            let commentMatch;
            let foundCommentConfig = false;

            while ((commentMatch = commentLineRegex.exec(text)) !== null) {
                foundCommentConfig = true;
                const rawEvent = commentMatch[1].trim();
                const condition = commentMatch[2] ? commentMatch[2].trim() : "";
                const cmdsText = commentMatch[3].trim();
                const rawCmds = splitCommands(cmdsText);
                const cmds = rawCmds.map(resolveLabelFromRef);

                let eventType = "tag_created";
                if (rawEvent === "打上标签时" || rawEvent === "tag_created") eventType = "tag_created";
                else if (rawEvent === "移除标签时" || rawEvent === "tag_removed") eventType = "tag_removed";
                else if (rawEvent === "内容变动时" || rawEvent === "block_content_changed") eventType = "block_content_changed";
                else if (rawEvent === "属性变动时" || rawEvent === "block_attribute_changed") eventType = "block_attribute_changed";
                else if (rawEvent === "任务完成时" || rawEvent === "task_completed") eventType = "task_completed";

                if (eventConfigs[eventType]) {
                    eventConfigs[eventType].condition = condition;
                    eventConfigs[eventType].selectedList = cmds;
                    activateEvent(eventType);
                }
            }

            if (foundCommentConfig) return;

            // 其次尝试从代码片段中的 dispatch 结构还原
            const regex = /eventName\s*===\s*["']([^"']+)["'][\s\S]*?\{([\s\S]*?)\}/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const eventType = match[1].trim();
                const body = match[2];
                const dispatchRegex = /dispatch\(["']([^"']+)["'](?:,\s*(\{[\s\S]*?\}|[^)]+))?\)/g;
                let dMatch;
                const cmds: string[] = [];
                while ((dMatch = dispatchRegex.exec(body)) !== null) {
                    const rawRef = dMatch[1];
                    const label = resolveLabelFromRef(rawRef);
                    const rawArgs = dMatch[2];
                    if (rawArgs) {
                        let cleanArgs = rawArgs.trim();
                        if (cleanArgs.startsWith("{") && cleanArgs.endsWith("}")) {
                            cleanArgs = cleanArgs.slice(1, -1).trim();
                        }
                        cmds.push(`${label}(${cleanArgs})`);
                    } else {
                        cmds.push(label);
                    }
                }
                if (eventConfigs[eventType]) {
                    eventConfigs[eventType].selectedList = cmds;
                    activateEvent(eventType);
                }
            }
            return;
        }

        // 2. 传统纯文本解析 (Legacy Fallback)
        const lines = text.split("\n").map(l => l.trim()).filter(l => Boolean(l) && !l.startsWith("//") && !l.startsWith("#"));
        for (const line of lines) {
            const match = line.match(/^\[([^\]]+)\](?:\(([^\)]+)\))?\s*->\s*(.+)$/);
            if (match) {
                const rawEvent = match[1].trim();
                const condition = match[2] ? match[2].trim() : "";
                const cmdsText = match[3].trim();
                const rawCmds = splitCommands(cmdsText);
                const cmds = rawCmds.map(resolveLabelFromRef);

                let eventType = "tag_created";
                if (rawEvent === "打上标签时" || rawEvent === "tag_created") eventType = "tag_created";
                else if (rawEvent === "移除标签时" || rawEvent === "tag_removed") eventType = "tag_removed";
                else if (rawEvent === "内容变动时" || rawEvent === "block_content_changed") eventType = "block_content_changed";
                else if (rawEvent === "属性变动时" || rawEvent === "block_attribute_changed") eventType = "block_attribute_changed";
                else if (rawEvent === "任务完成时" || rawEvent === "task_completed") eventType = "task_completed";

                if (eventConfigs[eventType]) {
                    eventConfigs[eventType].condition = condition;
                    eventConfigs[eventType].selectedList = cmds;
                    activateEvent(eventType);
                }
            }
        }
    }

    onMount(() => {
        console.log("[TriggerDialog-Debug] mounted with:", { supertag, boundCommands, currentValue });
        parseConditional(currentValue);
        console.log("[TriggerDialog-Debug] parsed configs:", eventConfigs, "activeEventIds:", activeEventIds);
    });

    function findSelectionIndex(list: string[], label: string): number {
        return list.findIndex(item => {
            const base = item.split("(")[0].trim();
            return base === label;
        });
    }

    function toggleSelect(label: string) {
        const config = eventConfigs[activeEvent];
        const index = findSelectionIndex(config.selectedList, label);
        if (index > -1) {
            config.selectedList = config.selectedList.filter((_, idx) => idx !== index);
        } else {
            config.selectedList = [...config.selectedList, label];
        }
        eventConfigs = { ...eventConfigs };
    }

    async function handleSave() {
        const commentLines: string[] = [];
        const statements: string[] = [];
        const eventLabels: Record<string, string> = {
            tag_created: "打上标签时",
            tag_removed: "移除标签时",
            block_content_changed: "内容变动时",
            block_attribute_changed: "属性变动时",
            task_completed: "任务完成时"
        };

        for (const eventType of activeEventIds) {
            const config = eventConfigs[eventType];
            if (config && config.selectedList.length > 0) {
                const eventLabel = eventLabels[eventType] || eventType;
                const condPart = config.condition.trim() ? `(${config.condition.trim()})` : "";
                const cmdsPart = config.selectedList.join(", ");
                commentLines.push(`// [${eventLabel}]${condPart} -> ${cmdsPart}`);

                const subStatements: string[] = [];
                for (const cmdItem of config.selectedList) {
                    const matchArgs = cmdItem.match(/^([^(]+)\((.*)\)$/);
                    const label = matchArgs ? matchArgs[1].trim() : cmdItem.trim();
                    const boundCmd = boundCommands.find(c => c.label === label);
                    const cmdRef = boundCmd?.commandRef || COMMAND_BINDINGS[label]?.commandRef || label;

                    if (matchArgs) {
                        const argsStr = matchArgs[2].trim();
                        const formattedArgs = argsStr.startsWith("{") ? argsStr : `{ ${argsStr} }`;
                        subStatements.push(`        await dispatch("${cmdRef}", ${formattedArgs});`);
                    } else {
                        subStatements.push(`        await dispatch("${cmdRef}");`);
                    }
                }
                
                statements.push(`    if (eventName === "${eventType}") {\n${subStatements.join("\n")}\n    }`);
            }
        }

        if (statements.length === 0) {
            await onSave("");
            dialog.destroy();
            return;
        }

        const commentsHeader = commentLines.join("\n");
        const scriptBody = `async ({ dispatch, state, eventName, showMessage }) => {\n${statements.join("\n")}\n}`;
        const scriptContent = `${commentsHeader}\n\n${scriptBody}`;
        await onSave(scriptContent);
        dialog.destroy();
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box;">
    <!-- Dialog Header -->
    <div style="margin-bottom: 12px; flex-shrink: 0;">
        <div style="font-size: 16px; font-weight: bold; color: var(--b3-theme-on-surface); display: flex; align-items: center; gap: 8px;">
            <svg class="b3-list-item__graphic" style="height: 18px; width: 18px; color: var(--b3-theme-primary);"><use xlink:href="#iconPlay"></use></svg>
            <span>配置条件触发器 (Conditional Triggers)</span>
        </div>
        <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 6px; padding: 6px; border-radius: 4px; background-color: var(--b3-theme-surface); border: 1px solid var(--b3-border-color);">
            <div style="font-weight: bold;">超级标签: <span style="color: var(--b3-theme-primary); font-family: monospace;">{supertag}</span></div>
        </div>
    </div>

    <!-- Event Switch Tabs Bar with Add Dropdown -->
    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--b3-border-color); margin-bottom: 12px; flex-shrink: 0; position: relative;">
        <div style="display: flex; gap: 4px; overflow-x: auto; flex: 1; padding-bottom: 2px;">
            {#each activeEventTypes as ev}
                <div 
                    class="b3-button {activeEvent === ev.id ? 'b3-button--primary' : 'b3-button--text'}" 
                    style="font-size: 11px; padding: 4px 8px; border-radius: 4px 4px 0 0; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; height: 26px;"
                    on:click={() => activeEvent = ev.id}
                >
                    <span>{ev.label}</span>
                    {#if ev.id !== 'tag_created'}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span 
                            class="index-tab-remove"
                            style="font-size: 11px; line-height: 1; opacity: 0.7; padding: 1px 3px; border-radius: 50%; display: flex; align-items: center; justify-content: center;"
                            on:click={(e) => removeEvent(ev.id, e)}
                            title="移除此触发事件"
                        >
                            ✕
                        </span>
                    {/if}
                </div>
            {/each}
        </div>

        {#if remainingEventTypes.length > 0}
            <div style="position: relative; flex-shrink: 0; margin-left: 8px;">
                <button 
                    class="b3-button b3-button--outline" 
                    style="font-size: 11px; padding: 2px 8px; height: 26px; display: flex; align-items: center; gap: 4px;"
                    on:click={() => isAddDropdownOpen = !isAddDropdownOpen}
                    title="添加其他触发事件"
                >
                    <span style="font-weight: bold; font-size: 13px; line-height: 1;">+</span>
                    <span>添加事件</span>
                </button>

                {#if isAddDropdownOpen}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div 
                        style="position: absolute; right: 0; top: 30px; z-index: 100; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); border-radius: 6px; box-shadow: var(--b3-dialog-shadow); padding: 4px; min-width: 130px; display: flex; flex-direction: column; gap: 2px;"
                    >
                        {#each remainingEventTypes as rem}
                            <div 
                                class="b3-list-item" 
                                style="font-size: 11px; padding: 6px 10px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; justify-content: space-between;"
                                on:click={() => addEvent(rem.id)}
                            >
                                <span>{rem.label}</span>
                                <span style="font-size: 10px; color: var(--b3-theme-primary); font-weight: bold;">+</span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    <!-- Active Tab Configuration Body -->
    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; flex-shrink: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--b3-border-color); background: var(--b3-theme-surface);">
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light);">触发条件 (Condition) - 可选</label>
            <input 
                type="text" 
                class="b3-text-field" 
                style="font-size: 12px; padding: 4px 8px;" 
                placeholder="例如: is_task_completed，留空代表无条件执行" 
                bind:value={eventConfigs[activeEvent].condition} 
            />
        </div>
    </div>

    <!-- Scrollable Checklist Content -->
    <div style="flex: 1; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 6px;">
        {#if boundCommands.length === 0}
            <div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 30px 0; font-size: 12px;">
                ⚠️ 该超级标签未绑定任何命令。<br/>
                <span style="font-size: 11px; opacity: 0.8; display: inline-block; margin-top: 4px;">
                    请先在【绑定命令】列中为该行关联命令。
                </span>
            </div>
        {:else}
            <div style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light); margin-bottom: 2px;">
                选择并排序动作命令 (Actions)：
            </div>
            {#each boundCommands as cmd}
                {@const selIndex = findSelectionIndex(eventConfigs[activeEvent].selectedList, cmd.label)}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div 
                    class="index-trigger-list-item" 
                    style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-radius: 4px; cursor: pointer; border: 1px solid {selIndex > -1 ? 'var(--b3-theme-primary)' : 'var(--b3-border-color)'}; background-color: {selIndex > -1 ? 'var(--b3-theme-background-hover)' : 'transparent'}; transition: all 0.1s ease;"
                    on:click={() => toggleSelect(cmd.label)}
                >
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                        <input 
                            type="checkbox" 
                            class="b3-checkbox" 
                            checked={selIndex > -1} 
                            on:click|stopPropagation={() => toggleSelect(cmd.label)}
                        />
                        <span style="font-size: 12px; font-weight: {selIndex > -1 ? 'bold' : 'normal'}; color: var(--b3-theme-on-surface); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                            {cmd.label}
                        </span>
                    </div>

                    {#if selIndex > -1}
                        <span 
                            style="background-color: var(--b3-theme-primary); color: var(--b3-theme-on-primary); font-size: 10px; font-weight: bold; height: 16px; width: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"
                            title="第 {selIndex + 1} 个执行"
                        >
                            {selIndex + 1}
                        </span>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- Dialog Footer -->
    <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" style="padding: 4px 12px; font-size: 12px;" on:click={() => dialog.destroy()}>
            取消
        </button>
        <button class="b3-button b3-button--primary" style="padding: 4px 16px; font-size: 12px; font-weight: 500;" on:click={handleSave}>
            保存配置
        </button>
    </div>
</div>

<style>
    .index-trigger-list-item:hover {
        background-color: var(--b3-theme-background-hover) !important;
    }
</style>
