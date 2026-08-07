<script lang="ts">
    import { commandRegistry } from "../registry/command-registry";
    import { generateRuleScript, parseRuleScript } from "./script-dsl";
    import { buildSmartBindings, outputsOf, outputName } from "./smart-bindings";

    /** 可复用的命令序列编辑器：勾选命令（顺序号）+ 每命令入参设置 + 快捷配置 */
    export let initialScript: string | null = null;
    export let showName = true;
    export let namePlaceholder = "名称，例如：创建任务并更新";
    export let onScriptChange: ((script: string) => void) | undefined = undefined;
    /** 仅显示这些命令（如 Conditional 只显示绑定命令）；null = 全部 */
    export let allowedCommands: string[] | null = null;

    const ENV_VARS = ["block_id", "root_id", "parent_id", "date", "time"];

    let name = "";
    let checked: string[] = [];
    let paramsByCmd: Record<string, Record<string, string>> = {};
    let editingCmd: string | null = null;
    let activeParam = "";
    let searchQuery = "";

    $: commands = commandRegistry
        .getAllCommands()
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));

    $: availableCommands = allowedCommands
        ? commands.filter(cmd => allowedCommands.includes(cmd.id))
        : commands;

    $: visibleCommands = availableCommands.filter(cmd =>
        !searchQuery.trim()
        || cmd.name.toLowerCase().includes(searchQuery.toLowerCase())
        || cmd.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    $: if (onScriptChange) {
        onScriptChange(generateRuleScript(name, checked.map(cmdId => ({ commandRef: cmdId, params: paramsByCmd[cmdId] || {} }))));
    }

    function commandName(id: string): string {
        return commandRegistry.getCommand(id)?.name || id;
    }

    function paramsOf(cmdId: string): Record<string, string> {
        return paramsByCmd[cmdId] || {};
    }

    function toggleCommand(id: string) {
        if (checked.includes(id)) {
            checked = checked.filter(x => x !== id);
            if (editingCmd === id) editingCmd = null;
        } else {
            checked = [...checked, id];
            smartFill(id);
        }
    }

    function smartFill(cmdId: string) {
        const idx = checked.indexOf(cmdId);
        if (idx === -1) return;
        const suggestions = buildSmartBindings(checked.map(c => ({ commandRef: c })), idx, commandRegistry);
        const current = { ...paramsOf(cmdId) };
        const filled: string[] = [];
        for (const [key, val] of Object.entries(suggestions)) {
            if (!current[key]) {
                current[key] = val;
                filled.push(key);
            }
        }
        if (filled.length > 0) {
            paramsByCmd = { ...paramsByCmd, [cmdId]: current };
            console.log(`[RuleEditor] step${idx}(${cmdId}) 智能填充:`, filled);
        }
    }

    function openSettings(cmdId: string) {
        editingCmd = cmdId;
        const def = commandRegistry.getCommand(cmdId);
        activeParam = def?.params?.[0]?.key || "";
        smartFill(cmdId);
    }

    function setParam(cmdId: string, key: string, value: string) {
        const current = { ...paramsOf(cmdId) };
        if (value === "") {
            delete current[key];
        } else {
            current[key] = value;
        }
        paramsByCmd = { ...paramsByCmd, [cmdId]: current };
    }

    function insertQuick(cmdId: string, token: string) {
        if (!activeParam) {
            const def = commandRegistry.getCommand(cmdId);
            activeParam = def?.params?.[0]?.key || "";
            if (!activeParam) {
                console.log(`[RuleEditor] 快捷配置被忽略：${cmdId} 无入参且 activeParam 为空`);
                return;
            }
        }
        const current = paramsOf(cmdId);
        const existing = current[activeParam] || "";
        const ref = `{{${token}}}`;
        setParam(cmdId, activeParam, existing ? `${existing} ${ref}` : ref);
    }

    function previousOutputs(cmdId: string): { name: string; source: string }[] {
        const idx = checked.indexOf(cmdId);
        if (idx <= 0) return [];
        const out: { name: string; source: string }[] = [];
        for (let i = 0; i < idx; i++) {
            const prevId = checked[i];
            const def = commandRegistry.getCommand(prevId);
            for (const o of outputsOf(def)) {
                out.push({ name: outputName(prevId, o.key), source: `${commandName(prevId)}.${o.key}` });
            }
        }
        return out;
    }

    function loadScript(script: string) {
        const rule = parseRuleScript(script);
        if (!rule) return;
        name = rule.name || "";
        checked = rule.commands.map(c => c.commandRef);
        const params: Record<string, Record<string, string>> = {};
        for (const cmd of rule.commands) {
            params[cmd.commandRef] = { ...cmd.params };
        }
        paramsByCmd = params;
        editingCmd = null;
    }

    if (initialScript) {
        loadScript(initialScript);
    }
</script>

<div style="display: flex; gap: 12px; flex: 1; min-height: 0;">
    <!-- 左：命令勾选列表 -->
    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;">
        {#if showName}
            <input
                type="text"
                class="b3-text-field fn__block"
                style="font-size: 12px; padding: 5px 10px; flex-shrink: 0;"
                placeholder={namePlaceholder}
                bind:value={name}
            />
        {/if}
        <input
            type="text"
            class="b3-text-field fn__block"
            style="font-size: 12px; padding: 5px 10px; flex-shrink: 0;"
            placeholder="搜索命令..."
            bind:value={searchQuery}
        />
        <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 4px;">
            {#each visibleCommands as cmd}
                <div
                    style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 5px; cursor: pointer; {checked.includes(cmd.id) ? 'background: rgba(40, 81, 127, 0.07); outline: 1px solid var(--indexos-accent-primary);' : 'border: 1px solid transparent;'}"
                    on:click={() => toggleCommand(cmd.id)}
                >
                    <span
                        style="width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; {checked.includes(cmd.id) ? 'background: var(--indexos-accent-primary); color: #fff;' : 'border: 1px solid var(--indexos-border-light); color: transparent;'}"
                    >{checked.includes(cmd.id) ? checked.indexOf(cmd.id) + 1 : ""}</span>
                    <span style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{cmd.name}</span>
                    {#if checked.includes(cmd.id)}
                        <button
                            type="button"
                            class="indexos-btn-bordered"
                            style="font-size: 10px; padding: 1px 8px; flex-shrink: 0; {editingCmd === cmd.id ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : ''}"
                            title="配置该命令的入参"
                            on:click={e => {
                                e.stopPropagation();
                                e.preventDefault();
                                openSettings(cmd.id);
                            }}
                        >⚙ 入参</button>
                    {/if}
                </div>
            {/each}
            {#if visibleCommands.length === 0}
                <div style="text-align: center; padding: 30px 0; opacity: 0.4; font-size: 12px;">无匹配的命令</div>
            {/if}
        </div>
        <div style="font-size: 11px; color: var(--indexos-text-muted); flex-shrink: 0; line-height: 1.5;">
            按勾选顺序执行（1 → 2 → 3…）。保存后自动智能填充常用参数；勾选命令后点“⚙ 入参”可配置并引用前序出参/环境变量。
        </div>
    </div>

    <!-- 右：当前命令的入参设置 -->
    {#if editingCmd}
        <div style="width: 280px; flex-shrink: 0; border-left: 1px solid var(--indexos-border-divider, rgba(161,196,230,0.2)); padding-left: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0;">
            <div style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">
                ⚙ {commandName(editingCmd)} 入参
                <button
                    type="button"
                    style="float: right; font-size: 12px; padding: 0 4px; cursor: pointer; background: none; border: none; opacity: 0.5;"
                    title="关闭入参设置"
                    on:click={() => { editingCmd = null; }}
                >✕</button>
            </div>
            {#if (commandRegistry.getCommand(editingCmd)?.params || []).length > 0}
                <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
                    {#each (commandRegistry.getCommand(editingCmd)?.params || []) as schema}
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <label style="font-size: 10px; color: var(--indexos-text-muted);">
                                {schema.label || schema.key}
                                <code style="font-size: 9px; opacity: 0.7;">{schema.key}</code>
                            </label>
                            <input
                                type="text"
                                style="font-size: 11px; padding: 4px 8px; border: 1px solid {(paramsByCmd[editingCmd] || {})[schema.key] ? 'rgba(40, 81, 127, 0.55)' : 'var(--indexos-border-light)'}; border-radius: 4px; background: var(--indexos-bg-container); color: var(--indexos-text-main);"
                                value={(paramsByCmd[editingCmd] || {})[schema.key] || ""}
                                placeholder="空 = 用 Command-DB 配置；可写 &#123;&#123;变量&#125;&#125;"
                                on:focus={() => { activeParam = schema.key; }}
                                on:input={e => setParam(editingCmd, schema.key, e.currentTarget.value)}
                            />
                        </div>
                    {/each}
                </div>
            {:else}
                <div style="font-size: 11px; color: var(--indexos-text-muted); opacity: 0.6;">该命令没有可配置的入参。</div>
            {/if}

            <div style="flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--indexos-border-subtle); padding-top: 8px;">
                <div style="font-size: 10px; color: var(--indexos-text-muted);">
                    快捷配置（插入到当前选中的入参 <code style="font-size: 9px;">{activeParam || "（点击入参框选中）"}</code>）
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                    {#each ENV_VARS as v}
                        <button type="button" class="indexos-btn-bordered" style="font-size: 10px; padding: 1px 7px;" on:click={() => insertQuick(editingCmd, v)}>&#123;&#123;{v}&#125;&#125;</button>
                    {/each}
                </div>
                {#if previousOutputs(editingCmd).length > 0}
                    <div style="font-size: 10px; color: var(--indexos-text-muted);">前序出参</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        {#each previousOutputs(editingCmd) as po}
                            <button
                                type="button"
                                class="indexos-btn-bordered"
                                style="font-size: 10px; padding: 1px 7px; color: var(--indexos-status-success);"
                                title="{po.source}"
                                on:click={() => insertQuick(editingCmd, po.name)}
                            >&#123;&#123;{po.name}&#125;&#125;</button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
