<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { commandRegistry } from "../registry/command-registry";
    import { createPipelineRow, registerPipelineCommand, pipelineCommandId, updatePipelineRow } from "./manager";
    import { generateRuleScript, parseRuleScript } from "./script-dsl";
    import { buildSmartBindings, outputsOf, outputName } from "./smart-bindings";
    import { refreshSupertagRegistry } from "../utils/sync-service";

    export let dialog: Dialog;
    export let onCreated: ((rowId: string, name: string) => void) | undefined = undefined;
    export let initialScript: string | null = null;
    export let editRowId: string | null = null;

    const ENV_VARS = ["block_id", "root_id", "parent_id", "date", "time", "attr:KEY"];

    let name = "";
    let checked: string[] = []; // 勾选顺序 = 执行顺序
    let paramsByCmd: Record<string, Record<string, string>> = {};
    let editingCmd: string | null = null; // 正在配置入参的命令
    let activeParam = "";
    let searchQuery = "";
    let error = "";
    let saving = false;

    $: commands = commandRegistry
        .getAllCommands()
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));

    $: visibleCommands = commands.filter(cmd =>
        !searchQuery.trim()
        || cmd.name.toLowerCase().includes(searchQuery.toLowerCase())
        || cmd.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    function commandName(id: string): string {
        return commandRegistry.getCommand(id)?.name || id;
    }

    function paramsOf(cmdId: string): Record<string, string> {
        return paramsByCmd[cmdId] || {};
    }

    // ─── 勾选 ───
    function toggleCommand(id: string) {
        if (checked.includes(id)) {
            checked = checked.filter(x => x !== id);
            if (editingCmd === id) editingCmd = null;
        } else {
            checked = [...checked, id];
            smartFill(id);
        }
    }

    /** 智能填充：只填空参数，引用平坦参数池名字（用户别名优先） */
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
            console.log(`[PipelineEditor] step${idx}(${cmdId}) 智能填充:`, filled);
        }
    }

    // ─── 设置面板 ───
    function openSettings(cmdId: string) {
        console.log(`[PipelineEditor] openSettings called: ${cmdId}`);
        editingCmd = cmdId;
        const def = commandRegistry.getCommand(cmdId);
        activeParam = def?.params?.[0]?.key || "";
        smartFill(cmdId);
        console.log(`[PipelineEditor] 打开 ${cmdId} 入参设置`);
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

    /** 快捷配置：把 {{token}} 插入当前激活的入参 */
    function insertQuick(cmdId: string, token: string) {
        if (!activeParam) {
            const def = commandRegistry.getCommand(cmdId);
            activeParam = def?.params?.[0]?.key || "";
            if (!activeParam) {
                console.log(`[PipelineEditor] 快捷配置被忽略：${cmdId} 无入参且 activeParam 为空`);
                return;
            }
        }
        const current = paramsOf(cmdId);
        const existing = current[activeParam] || "";
        const ref = `{{${token}}}`;
        setParam(cmdId, activeParam, existing ? `${existing} ${ref}` : ref);
        console.log(`[PipelineEditor] 快捷配置 ${cmdId}.${activeParam} += ${ref}，新值="${paramsOf(cmdId)[activeParam] || ""}"`);
    }

    /** 前序命令可引用的出参（参数池名字：用户别名优先） */
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

    // ─── 保存 ───
    function buildScript(): string {
        const ordered = checked.map(cmdId => ({
            commandRef: cmdId,
            params: paramsOf(cmdId)
        }));
        return generateRuleScript(name.trim(), ordered);
    }

    async function handleSave() {
        error = "";
        if (!name.trim()) {
            error = "请填写复合命令名称";
            return;
        }
        if (checked.length === 0) {
            error = "请至少勾选一个命令";
            return;
        }
        const script = buildScript();

        saving = true;
        try {
            let rowId: string;
            if (editRowId) {
                rowId = editRowId;
                await updatePipelineRow(rowId, name.trim(), script);
            } else {
                rowId = await createPipelineRow(name.trim(), script);
            }
            const commandId = pipelineCommandId(rowId);
            registerPipelineCommand(commandId, name.trim(), script, "{}");
            await refreshSupertagRegistry();
            console.log(`[PipelineEditor] saved ${commandId} (${name.trim()})`);
            showMessage(`✓ 复合命令已${editRowId ? "更新" : "创建"}：${commandId}`);
            onCreated?.(rowId, name.trim());
            dialog.destroy();
        } catch (e) {
            error = `保存失败: ${e.message}`;
        } finally {
            saving = false;
        }
    }

    /** 反向解析：从脚本还原勾选与入参配置 */
    function loadFromScript(script: string) {
        const rule = parseRuleScript(script);
        if (!rule) {
            error = "无法解析脚本，将以纯文本脚本形式保留（可在单元格中手改）";
            return;
        }
        name = rule.name || "";
        checked = rule.commands.map(c => c.commandRef);
        const params: Record<string, Record<string, string>> = {};
        for (const cmd of rule.commands) {
            params[cmd.commandRef] = { ...cmd.params };
        }
        paramsByCmd = params;
        console.log(`[PipelineEditor] 已从脚本还原 ${checked.length} 个命令`);
    }

    if (initialScript) {
        loadFromScript(initialScript);
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <div class="fn__flex" style="align-items: center; gap: 8px; flex-shrink: 0;">
        <span style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">🧩 复合命令</span>
        <input
            type="text"
            class="b3-text-field fn__flex-1"
            style="font-size: 12px; padding: 5px 10px;"
            placeholder="名称，例如：创建任务并更新"
            bind:value={name}
        />
    </div>

    <div style="display: flex; gap: 12px; flex: 1; min-height: 0;">
        <!-- 左：命令勾选列表 -->
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;">
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
                                    console.log(`[PipelineEditor] ⚙ 按钮点击 ${cmd.id}`);
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
            <div style="width: 300px; flex-shrink: 0; border-left: 1px solid var(--indexos-border-divider, rgba(161,196,230,0.2)); padding-left: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0;">
                <div style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">
                    ⚙ {commandName(editingCmd)} 入参
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
                            <button class="indexos-btn-bordered" style="font-size: 10px; padding: 1px 7px;" on:click={() => insertQuick(editingCmd, v)}>&#123;&#123;{v}&#125;&#125;</button>
                        {/each}
                    </div>
                    {#if previousOutputs(editingCmd).length > 0}
                        <div style="font-size: 10px; color: var(--indexos-text-muted);">前序出参</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                            {#each previousOutputs(editingCmd) as po}
                                <button
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

    {#if error}
        <div style="font-size: 11px; color: var(--indexos-status-error); background: rgba(220, 38, 38, 0.08); padding: 6px 10px; border-radius: 4px; word-break: break-all; flex-shrink: 0;">
            {error}
        </div>
    {/if}

    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存并注册"}
        </button>
    </div>
</div>
