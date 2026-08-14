<script lang="ts">
    import { evaluateCommandConstraints } from "../utils/constraint-checker";
    import { commandRegistry } from "../registry/command-registry";
    import { generateRuleScript, parseRuleScript } from "./script-dsl";
    import { buildPipelineAutoContextBindings, outputsOf, outputName, getTagCreatedOutputPool } from "./pipeline-auto-context";

    /** 可复用的命令序列编辑器：勾选命令（顺序号）+ 每命令入参设置 + 快捷配置 */
    export let initialScript: string | null = null;
    export let showName = true;
    export let namePlaceholder = "名称 (留空自动命名: 复合命令 N)";
    export let onScriptChange: ((script: string) => void) | undefined = undefined;
    /** 仅显示这些命令（如 Conditional 只显示绑定命令）；null = 全部 */
    export let allowedCommands: string[] | null = null;

    const ENV_VARS = ["block_id", "root_id", "parent_id", "date", "time", "prompt"];

    const COMMON_CONTROL_PARAMS = [
        { key: "enabled", label: "是否执行本步骤", type: "boolean", default: "true", description: "评估为 false 时跳过本步骤" },
        { key: "delayMs", label: "前置延时 (毫秒)", type: "number", default: "0", description: "本步骤执行前的延迟等待时间 (ms)" }
    ];

    let name = "";
    let checked: string[] = [];
    let paramsByCmd: Record<string, Record<string, string>> = {};
    let editingCmd: string | null = null;
    let activeParam = "";
    let searchQuery = "";
    let showAdvancedParams = false;

    $: commands = commandRegistry
        .getAllCommands()
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));

    $: availableCommands = allowedCommands
        ? commands.filter(cmd => allowedCommands.includes(cmd.id) || allowedCommands.includes(cmd.name))
        : commands;

    $: currentEditingParams = editingCmd
        ? (showAdvancedParams 
            ? [...(commandRegistry.getCommand(editingCmd)?.params || []), ...COMMON_CONTROL_PARAMS] 
            : (commandRegistry.getCommand(editingCmd)?.params || []))
        : [];

    $: editingBgCheck = editingCmd && commandRegistry.getCommand(editingCmd)
        ? evaluateCommandConstraints(commandRegistry.getCommand(editingCmd)!, "background")
        : { allowed: true };

    $: visibleCommands = availableCommands.filter(cmd =>
        !searchQuery.trim()
        || cmd.name.toLowerCase().includes(searchQuery.toLowerCase())
        || cmd.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    let isInitialized = false;
    let lastLoadedScript: string | null = null;

    $: if (initialScript !== undefined && initialScript !== lastLoadedScript) {
        lastLoadedScript = initialScript;
        loadScript(initialScript || "");
    }

    /** 供外部直接调取的白盒脚本提取器 */
    export function getScript(): string {
        return generateRuleScript(name, checked.map(cmdId => ({ commandRef: cmdId, params: paramsByCmd[cmdId] || {} })));
    }

    $: {
        const outScript = generateRuleScript(name, checked.map(cmdId => ({ commandRef: cmdId, params: paramsByCmd[cmdId] || {} })));
        if (onScriptChange) {
            onScriptChange(outScript);
        }
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
        }
    }

    function smartFill(cmdId: string) {
        // 彻底停用偷摸往参数框中自动硬填变量的行为，保持输入框纯净留空
        return;
    }

    function openSettings(cmdId: string) {
        editingCmd = cmdId;
        const def = commandRegistry.getCommand(cmdId);
        activeParam = def?.params?.[0]?.key || "";
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

    function formatVarToken(raw: string): string {
        if (!raw) return "";
        let clean = String(raw).trim();
        while (/^\{\{\s*/.test(clean) || /\s*\}\}$/.test(clean) || /^var\./i.test(clean)) {
            clean = clean.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").replace(/^var\./i, "").trim();
        }
        if (!clean) return "";
        return `{{var.${clean}}}`;
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
        const ref = (token.startsWith("var.") || token.includes("{{")) ? formatVarToken(token) : `{{${token}}}`;
        setParam(cmdId, activeParam, existing ? `${existing} ${ref}` : ref);
    }

    function getCmdDef(idOrRef: string): CommandDef | undefined {
        return commandRegistry.getCommand(idOrRef) || commandRegistry.findByNameOrId(idOrRef);
    }

    function getCheckedIndex(cmdId: string): number {
        let idx = checked.indexOf(cmdId);
        if (idx !== -1) return idx;
        const targetDef = getCmdDef(cmdId);
        if (!targetDef) return -1;
        return checked.findIndex(item => {
            const itemDef = getCmdDef(item);
            return itemDef?.id === targetDef.id;
        });
    }

    function previousOutputs(cmdId: string): { name: string; source: string }[] {
        const idx = getCheckedIndex(cmdId);
        const out: { name: string; source: string }[] = [];
        if (idx > 0) {
            for (let i = 0; i < idx; i++) {
                const prevId = checked[i];
                const def = getCmdDef(prevId);
                for (const o of outputsOf(def)) {
                    const rawName = outputName(prevId, o.key);
                    const normToken = formatVarToken(rawName);
                    if (!out.some(x => x.name === normToken)) {
                        out.push({ name: normToken, source: `${commandName(prevId)}.${o.key}` });
                    }
                }
            }
        }
        return out;
    }

    function loadScript(script: string) {
        isInitialized = false;
        console.log("[SequenceEditor-Debug] 📥 内部 loadScript 接收脚本:", JSON.stringify(script));
        const rule = parseRuleScript(script);
        console.log("[SequenceEditor-Debug] parseRuleScript 结果:", rule);
        if (rule) {
            name = rule.name || "";
            checked = rule.commands.map(c => {
                const def = commandRegistry.getCommand(c.commandRef) || commandRegistry.findByNameOrId(c.commandRef);
                return def?.id || c.commandRef;
            });
            const params: Record<string, Record<string, string>> = {};
            for (const cmd of rule.commands) {
                const def = commandRegistry.getCommand(cmd.commandRef) || commandRegistry.findByNameOrId(cmd.commandRef);
                const realId = def?.id || cmd.commandRef;
                params[realId] = { ...cmd.params };
            }
            paramsByCmd = params;
            editingCmd = null;
        } else {
            checked = [];
            paramsByCmd = {};
            editingCmd = null;
        }
        console.log("[SequenceEditor-Debug] 装载完成，checked 项:", checked);

        // 状态装载完毕后，开启变更回调
        queueMicrotask(() => {
            isInitialized = true;
        });
    }

    function getAutoSuggestion(cmdId: string, schema: any): { varName: string; note: string } | null {
        const idx = getCheckedIndex(cmdId);
        if (idx > 0) {
            const prevOutputs = previousOutputs(cmdId);
            if (schema.key === "id" || schema.type === "blockid") {
                const matched = prevOutputs.find(po => po.name.includes("block") || po.name.includes("id")) || prevOutputs[0];
                if (matched) {
                    return { varName: formatVarToken(matched.name), note: "(不填自动推导)" };
                }
            }
            if (schema.key === "enabled") {
                return { varName: `{{var.last_boolean_result}}`, note: "(不填受前一步控制)" };
            }
        }
        return null;
    }

    function isCommandGoldHighlighted(cmdId: string, _checked: string[], _params: Record<string, Record<string, string>>): boolean {
        const targetDef = getCmdDef(cmdId);
        const realId = targetDef?.id || cmdId;

        // 1. 手填参数检测
        const cmdParams = _params[realId] || _params[cmdId] || {};
        if (Object.values(cmdParams).some(v => v !== undefined && String(v).trim() !== "")) {
            return true;
        }

        // 2. 自动推导胶囊检测 (与右侧推荐胶囊 100% 同源)
        if (targetDef && targetDef.params) {
            return targetDef.params.some(p => getAutoSuggestion(realId, p) !== null);
        }

        return false;
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
                        {@const isGold = isCommandGoldHighlighted(cmd.id, checked, paramsByCmd)}
                        <!-- 👑 茵蒂克丝刺绣金 (Index Gold): 用于标注 Layer 3 客制化参数配置或 Auto-Context 自动推导 -->
                        <button
                            type="button"
                            class="indexos-btn-bordered"
                            style="font-size: 10px; padding: 1px 8px; flex-shrink: 0; {isGold ? (editingCmd === cmd.id ? 'background: var(--indexos-detached-gold, #D9A74A) !important; color: #fff !important; border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; font-weight: 700;' : 'border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; color: var(--indexos-detached-gold, #D9A74A) !important; background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.09)) !important; font-weight: 600;') : (editingCmd === cmd.id ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : '')}"
                            title={isGold ? '👑 已激活 Auto-Context 智能推荐感应或客制化入参' : '配置该命令的入参'}
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
            {#if !editingBgCheck.allowed}
                <div style="font-size: 10px; color: #d97706; background: rgba(217, 119, 6, 0.1); border: 1px dashed rgba(217, 119, 6, 0.3); padding: 4px 6px; border-radius: 4px; line-height: 1.3;">
                    ⚠️ 提示：{editingBgCheck.reason}
                </div>
            {/if}
            {#if currentEditingParams.length > 0}
                <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
                    {#each currentEditingParams as schema}
                        {@const sug = getAutoSuggestion(editingCmd, schema)}
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <label style="font-size: 10px; color: var(--indexos-text-muted);">
                                    {schema.label || schema.key}
                                    <code style="font-size: 9px; opacity: 0.7;">{schema.key}</code>
                                </label>
                                {#if sug}
                                    <div style="font-size: 10px; color: var(--indexos-text-muted); display: flex; align-items: center; gap: 3px;">
                                        <span style="color: var(--indexos-accent-primary); font-weight: 600;">⚡ 推荐:</span>
                                        <span
                                            role="button"
                                            tabindex="0"
                                            class="b3-chip b3-chip--secondary"
                                            style="font-family: monospace; font-size: 10px; cursor: pointer; padding: 1px 4px; color: var(--indexos-accent-primary); border: 1px dashed var(--indexos-accent-primary);"
                                            title="点击将推荐变量填入输入框"
                                            on:click={() => setParam(editingCmd, schema.key, sug.varName)}
                                            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && setParam(editingCmd, schema.key, sug.varName)}
                                        >{sug.varName}</span>
                                        <span style="opacity: 0.7; font-size: 9px;">{sug.note}</span>
                                    </div>
                                {/if}
                            </div>
                            <input
                                type="text"
                                style="font-size: 11px; padding: 4px 8px; border: 1px solid {(paramsByCmd[editingCmd] || {})[schema.key] ? 'rgba(40, 81, 127, 0.55)' : 'var(--indexos-border-light)'}; border-radius: 4px; background: var(--indexos-bg-container); color: var(--indexos-text-main);"
                                value={(paramsByCmd[editingCmd] || {})[schema.key] || ""}
                                placeholder={schema.default !== undefined ? `Layer 2 默认: ${schema.default}` : (schema.description || "空 = 自动继承缺省/推荐；可手写 {{变量}}")}
                                on:focus={() => { activeParam = schema.key; }}
                                on:input={e => setParam(editingCmd, schema.key, e.currentTarget.value)}
                            />
                        </div>
                    {/each}

                    <!-- 展开/隐藏控制参数 -->
                    <div style="display: flex; justify-content: center; margin-top: 4px;">
                        <button
                            type="button"
                            class="b3-button b3-button--text"
                            style="font-size: 10px; padding: 2px 6px; opacity: 0.8;"
                            on:click={() => showAdvancedParams = !showAdvancedParams}
                        >
                            {showAdvancedParams ? "🔼 隐藏步骤控制参数 (enabled, delayMs)" : "🔽 高级控制参数 (enabled, delayMs)"}
                        </button>
                    </div>
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
                            >{po.name}</button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
