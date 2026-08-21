<script lang="ts">
    import { evaluateCommandConstraints } from "../utils/constraint-checker";
    import { 
        commandRegistry, 
        type CommandDef, 
        inferCommandSource, 
        inferCommandDomain, 
        inferCommandScope,
        type CommandSourceType,
        type CommandDomainType,
        type CommandScopeType
    } from "../registry/command-registry";
    import { generateRuleScript, parseRuleScript } from "./script-dsl";
    import { outputsOf, outputName, suggestBinding, getCompositeOutputToken } from "./composite-auto-context";

    /** 可复用的命令序列编辑器：支持多步/重复命令（角标序号流）+ 多维元数据筛选 + 入参独立设置 + 茵蒂克丝金高亮 */
    export let initialScript: string | null = null;
    export let showName = true;
    export let namePlaceholder = "名称 (留空自动命名: 复合命令 N)";
    export let onScriptChange: ((script: string) => void) | undefined = undefined;
    /** 仅显示这些命令（如 Conditional 只显示绑定命令）；null = 全部 */
    export let allowedCommands: string[] | null = null;

    export interface SequenceStep {
        uid: string;
        commandRef: string;
        params: Record<string, string>;
    }

    const ENV_VARS = ["self.id", "doc.id", "doc.next.id", "doc.prev.id", "prev.id", "next.id", "parent.id", "block.id", "notebook.id", "date", "time", "prompt"];

    const COMMON_CONTROL_PARAMS = [
        { key: "enabled", label: "是否执行本步骤", type: "boolean", default: "true", description: "评估为 false 时跳过本步骤" },
        { key: "delayMs", label: "前置延时 (毫秒)", type: "number", default: "0", description: "本步骤执行前的延迟等待时间 (ms)" }
    ];

    let name = "";
    let steps: SequenceStep[] = [];
    let editingStepUid: string | null = null;
    let activeParam = "";
    let searchQuery = "";
    let showAdvancedParams = false;

    // ── 多维筛选状态 ──────────────────────────────────────────
    let activeViewTab: "all" | "selected" = "all";
    let filterSource: "all" | CommandSourceType = "all";
    let filterDomain: "all" | CommandDomainType = "all";
    let filterScope: "all" | CommandScopeType = "all";

    import { COMMAND_BINDINGS } from "../registration";
    import { getSeedCommandRows } from "../indexos/seed-data";

    $: layer2List = (() => {
        const bindings = Object.values(COMMAND_BINDINGS);
        if (bindings.length > 0) {
            return bindings.map(b => {
                const def = commandRegistry.getCommand(b.commandRef) || commandRegistry.findByNameOrId(b.methodName);
                return {
                    id: b.commandRef,
                    name: b.methodName || def?.name || b.commandRef,
                    def: def || ({
                        id: b.commandRef,
                        name: b.methodName,
                        description: "",
                        params: [],
                        outputs: [],
                        handler: async () => {}
                    } as CommandDef),
                    source: def ? inferCommandSource(def) : ("composite" as CommandSourceType),
                    domain: def ? inferCommandDomain(def) : ("other" as CommandDomainType),
                    scope: def ? inferCommandScope(def) : ("focused_block" as CommandScopeType)
                };
            });
        }

        // 兜底（未实例化或 bindings 尚未就绪）：从 seed-data.ts 常量读取 Layer 2 种子命令
        return getSeedCommandRows().map(row => {
            const def = commandRegistry.getCommand(row.commandID) || commandRegistry.findByNameOrId(row.label);
            return {
                id: row.commandID,
                name: row.label || def?.name || row.commandID,
                def: def || ({
                    id: row.commandID,
                    name: row.label,
                    description: "",
                    params: [],
                    outputs: [],
                    handler: async () => {}
                } as CommandDef),
                source: def ? inferCommandSource(def) : ("builtin" as CommandSourceType),
                domain: def ? inferCommandDomain(def) : ("other" as CommandDomainType),
                scope: def ? inferCommandScope(def) : ("focused_block" as CommandScopeType)
            };
        });
    })();

    $: commands = layer2List.sort((a, b) => a.name.localeCompare(b.name, "zh"));

    $: availableCommands = allowedCommands
        ? commands.filter(cmd => allowedCommands.includes(cmd.id) || allowedCommands.includes(cmd.name))
        : commands;

    // ── 过滤计算 ──────────────────────────────────────────────
    $: visibleCommands = availableCommands.filter(cmd => {
        // 1. 核心视图：已选 (Selected)
        if (activeViewTab === "selected") {
            const hasStep = steps.some(s => s.commandRef === cmd.id);
            if (!hasStep) return false;
        }

        // 2. 来源维度
        if (filterSource !== "all" && cmd.source !== filterSource) {
            return false;
        }

        // 3. 领域维度
        if (filterDomain !== "all" && cmd.domain !== filterDomain) {
            return false;
        }

        // 4. 作用范围维度
        if (filterScope !== "all" && cmd.scope !== filterScope) {
            return false;
        }

        // 5. 关键词搜索
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchName = cmd.name.toLowerCase().includes(q);
            const matchId = cmd.id.toLowerCase().includes(q);
            const matchDomain = String(cmd.domain).toLowerCase().includes(q);
            if (!matchName && !matchId && !matchDomain) return false;
        }

        return true;
    });

    $: currentEditingStep = steps.find(s => s.uid === editingStepUid) || null;
    $: currentEditingCmdDef = currentEditingStep ? commandRegistry.getCommand(currentEditingStep.commandRef) : null;

    $: currentEditingParams = currentEditingCmdDef
        ? (showAdvancedParams 
            ? [...(currentEditingCmdDef.params || []), ...COMMON_CONTROL_PARAMS] 
            : (currentEditingCmdDef.params || []))
        : [];

    $: editingBgCheck = currentEditingCmdDef
        ? evaluateCommandConstraints(currentEditingCmdDef, "background")
        : { allowed: true };

    let isInitialized = false;
    let lastLoadedScript: string | null = null;

    $: if (initialScript !== undefined && initialScript !== lastLoadedScript) {
        lastLoadedScript = initialScript;
        loadScript(initialScript || "");
    }

    /** 供外部直接调取的白盒脚本提取器 */
    export function getScript(): string {
        return generateRuleScript(name, steps.map(s => ({ commandRef: s.commandRef, params: s.params || {} })));
    }

    $: {
        const outScript = generateRuleScript(name, steps.map(s => ({ commandRef: s.commandRef, params: s.params || {} })));
        if (onScriptChange && isInitialized) {
            onScriptChange(outScript);
        }
    }

    function commandName(id: string): string {
        return commandRegistry.getCommand(id)?.name || id;
    }

    function generateUid(): string {
        return Math.random().toString(36).slice(2, 9);
    }

    function addStep(cmdId: string) {
        const newUid = generateUid();
        steps = [...steps, { uid: newUid, commandRef: cmdId, params: {} }];
    }

    function removeStep(stepIndex: number) {
        const targetStep = steps[stepIndex];
        steps = steps.filter((_, i) => i !== stepIndex);
        if (editingStepUid === targetStep?.uid) {
            editingStepUid = null;
            activeParam = "";
        }
    }

    function openStepSettings(stepUid: string) {
        editingStepUid = stepUid;
        const step = steps.find(s => s.uid === stepUid);
        if (step) {
            const def = commandRegistry.getCommand(step.commandRef);
            activeParam = def?.params?.[0]?.key || "";
        }
    }

    function setStepParam(key: string, value: string) {
        if (!editingStepUid) return;
        steps = steps.map(s => {
            if (s.uid !== editingStepUid) return s;
            const nextParams = { ...s.params };
            if (value === "") {
                delete nextParams[key];
            } else {
                nextParams[key] = value;
            }
            return { ...s, params: nextParams };
        });
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

    function insertQuick(token: string) {
        if (!editingStepUid || !currentEditingStep) return;
        if (!activeParam) {
            const def = commandRegistry.getCommand(currentEditingStep.commandRef);
            activeParam = def?.params?.[0]?.key || "";
            if (!activeParam) return;
        }
        const existing = currentEditingStep.params[activeParam] || "";
        const ref = (token.startsWith("var.") || token.includes("{{")) ? formatVarToken(token) : `{{${token}}}`;
        setStepParam(activeParam, existing ? `${existing} ${ref}` : ref);
    }

    function previousOutputsForStep(stepUid: string): { name: string; source: string }[] {
        const stepIdx = steps.findIndex(s => s.uid === stepUid);
        if (stepIdx <= 0) return [];
        const out: { name: string; source: string }[] = [];
        for (let i = 0; i < stepIdx; i++) {
            const prev = steps[i];
            const def = commandRegistry.getCommand(prev.commandRef);
            for (const o of outputsOf(def)) {
                const rawName = outputName(prev.commandRef, o.key);
                const normToken = formatVarToken(rawName);
                if (!out.some(x => x.name === normToken)) {
                    out.push({ name: normToken, source: `第${i + 1}步 ${commandName(prev.commandRef)}.${o.key}` });
                }
            }
        }
        return out;
    }

    function loadScript(script: string) {
        isInitialized = false;
        const rule = parseRuleScript(script);
        if (rule) {
            name = rule.name || "";
            steps = (rule.commands || []).map(c => {
                const def = commandRegistry.getCommand(c.commandRef) || commandRegistry.findByNameOrId(c.commandRef);
                const realId = def?.id || c.commandRef;
                return {
                    uid: generateUid(),
                    commandRef: realId,
                    params: { ...(c.params || {}) }
                };
            });
            editingStepUid = null;
        } else {
            name = "";
            steps = [];
            editingStepUid = null;
        }

        queueMicrotask(() => {
            isInitialized = true;
        });
    }

    function getAutoSuggestion(stepUid: string, schema: any): { varName: string; note: string } | null {
        const stepIdx = steps.findIndex(s => s.uid === stepUid);
        if (stepIdx > 0) {
            // 从紧邻的前置步骤依次向前寻找类型兼容或完全同名的出参
            for (let i = stepIdx - 1; i >= 0; i--) {
                const prev = steps[i];
                const prevDef = commandRegistry.getCommand(prev.commandRef);
                const outKey = suggestBinding(prevDef, schema.key, schema.type);
                if (outKey) {
                    const token = getCompositeOutputToken(prev.commandRef, outKey);
                    return { varName: formatVarToken(token), note: `(第 ${i + 1} 步出参)` };
                }
            }
        }
        return null;
    }

    /** 检测单个步骤是否已激活客制化参数或 Auto-Context 智能推导（金色标注） */
    function isStepGold(step: SequenceStep): boolean {
        // 1. 手填自定义参数检测
        const stepParams = step.params || {};
        if (Object.values(stepParams).some(v => v !== undefined && String(v).trim() !== "")) {
            return true;
        }
        // 2. 自动推导检测
        const def = commandRegistry.getCommand(step.commandRef);
        if (def && def.params) {
            return def.params.some(p => getAutoSuggestion(step.uid, p) !== null);
        }
        return false;
    }
</script>

<div style="display: flex; gap: 12px; flex: 1; min-height: 0; overflow: hidden;">
    <!-- 左侧：多维检索 + 命令序列列表 -->
    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; min-height: 0;">
        {#if showName}
            <input
                type="text"
                class="b3-text-field fn__block"
                style="font-size: 12px; padding: 5px 10px; flex-shrink: 0;"
                placeholder={namePlaceholder}
                bind:value={name}
            />
        {/if}

        <!-- 顶部核心视图切换 (All vs Selected) -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 8px;">
            <div class="indexos-tabbar" style="margin: 0; padding: 2px;">
                <button
                    type="button"
                    class="indexos-tab-item {activeViewTab === 'all' ? 'active' : ''}"
                    style="font-size: 11px; padding: 3px 10px;"
                    on:click={() => activeViewTab = 'all'}
                >
                    🌐 全量命令 ({availableCommands.length})
                </button>
                <button
                    type="button"
                    class="indexos-tab-item {activeViewTab === 'selected' ? 'active' : ''}"
                    style="font-size: 11px; padding: 3px 10px;"
                    on:click={() => activeViewTab = 'selected'}
                >
                    🌟 已选生效 ({steps.length})
                </button>
            </div>
            {#if steps.length > 0}
                <span class="indexos-tag-badge" style="font-size: 11px;">
                    已编排 {steps.length} 个步骤
                </span>
            {/if}
        </div>

        <!-- 搜索与多维分类下拉过滤栏 -->
        <div style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; background: var(--indexos-bg-card, rgba(0,0,0,0.02)); padding: 8px; border-radius: 6px; border: 1px solid var(--indexos-border-light);">
            <!-- 搜索框 -->
            <div style="position: relative;">
                <input
                    type="text"
                    class="b3-text-field fn__block"
                    style="font-size: 11px; padding: 5px 8px 5px 26px; box-sizing: border-box;"
                    placeholder="搜索全量命令名称、ID 或领域 (如 烟花 / 更新 / 属性)..."
                    bind:value={searchQuery}
                />
                <svg style="position: absolute; left: 8px; top: 7px; width: 13px; height: 13px; opacity: 0.5; pointer-events: none;"><use xlink:href="#iconSearch"></use></svg>
            </div>

            <!-- 3 大正交维度平铺下拉框 -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                <!-- 维度 1: 来源 -->
                <select 
                    class="b3-select" 
                    style="font-size: 11px; height: 30px; line-height: normal; padding: 4px 18px 4px 6px; width: 100%; box-sizing: border-box;" 
                    bind:value={filterSource}
                >
                    <option value="all">全部来源</option>
                    <option value="builtin">🧩 内置</option>
                    <option value="composite">⚡ 复合</option>
                    <option value="user">👤 自建</option>
                    <option value="plugin">🔌 插件</option>
                </select>

                <!-- 维度 2: 功能领域 -->
                <select 
                    class="b3-select" 
                    style="font-size: 11px; height: 30px; line-height: normal; padding: 4px 18px 4px 6px; width: 100%; box-sizing: border-box;" 
                    bind:value={filterDomain}
                >
                    <option value="all">全部领域</option>
                    <option value="block">🧱 块操作</option>
                    <option value="attribute">🏷️ 属性标签</option>
                    <option value="interaction">✨ 视效交互</option>
                    <option value="document">📄 文档大纲</option>
                    <option value="data_flow">🔄 数据流</option>
                    <option value="composite">⚡ 复合编排</option>
                </select>

                <!-- 维度 3: 作用范围 -->
                <select 
                    class="b3-select" 
                    style="font-size: 11px; height: 30px; line-height: normal; padding: 4px 18px 4px 6px; width: 100%; box-sizing: border-box;" 
                    bind:value={filterScope}
                >
                    <option value="all">全部范围</option>
                    <option value="focused_block">🎯 聚焦块</option>
                    <option value="document">📄 文档级</option>
                    <option value="global">🌐 全局</option>
                </select>
            </div>
        </div>

        <!-- 命令列表主体 -->
        <div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; padding-right: 4px;">
            {#each visibleCommands as cmd}
                {@const matchedIndices = steps.map((s, idx) => ({ idx, num: idx + 1, step: s })).filter(item => item.step.commandRef === cmd.id)}
                {@const isSelected = matchedIndices.length > 0}
                {@const isCurrentEditing = matchedIndices.some(m => m.step.uid === editingStepUid)}
                {@const hasGoldStep = matchedIndices.some(m => isStepGold(m.step))}

                <div
                    style="flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; border: 1px solid {isCurrentEditing ? (hasGoldStep ? 'var(--indexos-detached-gold, #D9A74A)' : 'var(--indexos-accent-primary)') : (isSelected ? 'rgba(40, 81, 127, 0.4)' : 'var(--indexos-border-light)')}; background: {isCurrentEditing ? (hasGoldStep ? 'var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.08))' : 'rgba(40, 81, 127, 0.08)') : (isSelected ? 'rgba(40, 81, 127, 0.03)' : 'var(--indexos-bg-card)')}; transition: all 0.15s ease;"
                >
                    <!-- [+] 追加执行步骤按钮 -->
                    <button
                        type="button"
                        class="b3-button b3-button--outline"
                        style="width: 24px; height: 24px; padding: 0; font-size: 14px; font-weight: bold; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px;"
                        title="将此命令追加到执行序列末尾"
                        on:click={() => addStep(cmd.id)}
                    >+</button>

                    <!-- 命令名称与 ID -->
                    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main);">{cmd.name}</span>
                            <span style="font-size: 9px; opacity: 0.6; font-family: monospace;">{cmd.id}</span>
                        </div>

                        <!-- 步骤角标序号流 (1, 2, 3...)，支持金色感应高亮，点击 ✖ 可单独移除对应步骤 -->
                        {#if matchedIndices.length > 0}
                            <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 2px;">
                                {#each matchedIndices as item}
                                    {@const stepGold = isStepGold(item.step)}
                                    {@const isCurrentStep = editingStepUid === item.step.uid}
                                    <span
                                        role="button"
                                        tabindex="0"
                                        class="b3-chip"
                                        style="font-size: 10px; font-weight: 600; padding: 1px 6px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; {stepGold ? (isCurrentStep ? 'background: var(--indexos-detached-gold, #D9A74A) !important; color: #fff !important; font-weight: 700; border: 1px solid var(--indexos-detached-gold, #D9A74A) !important;' : 'background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.14)) !important; color: var(--indexos-detached-gold, #D9A74A) !important; border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; font-weight: 600;') : (isCurrentStep ? 'background: var(--indexos-accent-primary); color: #fff;' : 'background: rgba(40, 81, 127, 0.12); color: var(--indexos-text-main);')}"
                                        title={stepGold ? `第 ${item.num} 步 (已配置客制化入参或已激活智能推导)。点击配置本步；点击右侧 ✖ 单独移除` : `第 ${item.num} 步。点击配置本步；点击右侧 ✖ 单独移除`}
                                        on:click={() => openStepSettings(item.step.uid)}
                                        on:keydown={e => e.key === 'Enter' && openStepSettings(item.step.uid)}
                                    >
                                        <span>第 {item.num} 步</span>
                                        <span
                                            role="button"
                                            tabindex="0"
                                            style="opacity: 0.6; font-size: 11px; font-weight: normal; cursor: pointer;"
                                            title="移除第 {item.num} 步"
                                            on:click|stopPropagation={() => removeStep(item.idx)}
                                            on:keydown|stopPropagation={e => e.key === 'Enter' && removeStep(item.idx)}
                                        >✕</span>
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <!-- 配置入参按钮 (若有金色感应则呈现金色高亮) -->
                    {#if matchedIndices.length > 0}
                        <button
                            type="button"
                            class="indexos-btn-bordered"
                            style="font-size: 11px; padding: 2px 8px; flex-shrink: 0; {hasGoldStep ? (isCurrentEditing ? 'background: var(--indexos-detached-gold, #D9A74A) !important; color: #fff !important; border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; font-weight: 700;' : 'border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; color: var(--indexos-detached-gold, #D9A74A) !important; background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.09)) !important; font-weight: 600;') : (isCurrentEditing ? 'background: var(--indexos-accent-primary); color: #fff; border-color: var(--indexos-accent-primary);' : '')}"
                            title={hasGoldStep ? "包含已激活智能推荐或客制化入参的步骤" : "配置本命令的入参"}
                            on:click={() => openStepSettings(matchedIndices[0].step.uid)}
                        >
                            ⚙ 入参
                        </button>
                    {/if}
                </div>
            {/each}

            {#if visibleCommands.length === 0}
                <div style="text-align: center; padding: 36px 0; opacity: 0.5; font-size: 12px;">
                    {activeViewTab === 'selected' ? '当前暂无已编排的步骤，点击全量命令中的 [+] 即可添加步骤' : '未找到匹配的命令'}
                </div>
            {/if}
        </div>

        <div style="font-size: 10px; color: var(--indexos-text-muted); flex-shrink: 0; line-height: 1.4;">
            💡 提示：点击命令左侧 <b>[+]</b> 可多次追加执行步骤（例如开头放烟花、结尾放烟花）。金色角标 <b>[第 N 步]</b> 代表已客制化或激活智能推导。
        </div>
    </div>

    <!-- 右侧：当前选中步骤的入参配置面板 -->
    {#if currentEditingStep && currentEditingCmdDef}
        {@const matchedStepsForCurrentCmd = steps.map((s, idx) => ({ ...s, stepNum: idx + 1 })).filter(s => s.commandRef === currentEditingStep.commandRef)}
        <div style="width: 290px; flex-shrink: 0; border-left: 1px solid var(--indexos-border-divider, rgba(161,196,230,0.2)); padding-left: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: hidden;">
            
            <!-- 头部：命令名称与关闭按钮 -->
            <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
                <div style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main);">
                    ⚙ {commandName(currentEditingStep.commandRef)}
                </div>
                <button
                    type="button"
                    style="font-size: 12px; padding: 0 4px; cursor: pointer; background: none; border: none; opacity: 0.5;"
                    title="关闭入参设置"
                    on:click={() => { editingStepUid = null; }}
                >✕</button>
            </div>

            <!-- 若该命令在步骤流中出现多次，提供步骤 Tab 切换 (带金色标记) -->
            {#if matchedStepsForCurrentCmd.length > 1}
                <div class="indexos-tabbar" style="margin: 0; padding: 2px; flex-shrink: 0;">
                    {#each matchedStepsForCurrentCmd as s}
                        {@const sGold = isStepGold(s)}
                        <button
                            type="button"
                            class="indexos-tab-item {editingStepUid === s.uid ? 'active' : ''}"
                            style="font-size: 10px; padding: 2px 6px; {sGold && editingStepUid !== s.uid ? 'color: var(--indexos-detached-gold, #D9A74A) !important; font-weight: 600;' : ''}"
                            on:click={() => editingStepUid = s.uid}
                        >
                            第 {s.stepNum} 步参数
                        </button>
                    {/each}
                </div>
            {/if}

            {#if !editingBgCheck.allowed}
                <div style="font-size: 10px; color: #d97706; background: rgba(217, 119, 6, 0.1); border: 1px dashed rgba(217, 119, 6, 0.3); padding: 4px 6px; border-radius: 4px; line-height: 1.3; flex-shrink: 0;">
                    ⚠️ 提示：{editingBgCheck.reason}
                </div>
            {/if}

            <!-- 入参表单列表 -->
            {#if currentEditingParams.length > 0}
                <div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
                    {#each currentEditingParams as schema}
                        {@const sug = getAutoSuggestion(currentEditingStep.uid, schema)}
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 10px; color: var(--indexos-text-muted);">
                                    {schema.label || schema.key}
                                    <code style="font-size: 9px; opacity: 0.7;">{schema.key}</code>
                                </span>
                                {#if sug}
                                    <div style="font-size: 10px; color: var(--indexos-text-muted); display: flex; align-items: center; gap: 3px;">
                                        <span style="color: var(--indexos-detached-gold, #D9A74A); font-weight: 600;">推荐:</span>
                                        <span
                                            role="button"
                                            tabindex="0"
                                            class="b3-chip"
                                            style="font-family: monospace; font-size: 10px; cursor: pointer; padding: 1px 4px; color: var(--indexos-detached-gold, #D9A74A); background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.12)); border: 1px dashed var(--indexos-detached-gold, #D9A74A);"
                                            title="点击将智能推导变量填入输入框"
                                            on:click={() => setStepParam(schema.key, sug.varName)}
                                            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && setStepParam(schema.key, sug.varName)}
                                        >{sug.varName}</span>
                                    </div>
                                {/if}
                            </div>
                            <input
                                type="text"
                                style="font-size: 11px; padding: 4px 8px; border: 1px solid {(currentEditingStep.params || {})[schema.key] ? 'var(--indexos-detached-gold, #D9A74A)' : 'var(--indexos-border-light)'}; border-radius: 4px; background: var(--indexos-bg-container); color: var(--indexos-text-main);"
                                value={(currentEditingStep.params || {})[schema.key] || ""}
                                placeholder={sug ? `默认: ${sug.varName} (智能推导)` : (schema.default !== undefined ? `默认: ${schema.default}` : (schema.description || "空 = 继承缺省；支持 {{变量}}"))}
                                on:focus={() => { activeParam = schema.key; }}
                                on:input={e => setStepParam(schema.key, e.currentTarget.value)}
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
                            {showAdvancedParams ? "🔼 隐藏控制参数 (enabled, delayMs)" : "🔽 高级控制参数 (enabled, delayMs)"}
                        </button>
                    </div>
                </div>
            {:else}
                <div style="font-size: 11px; color: var(--indexos-text-muted); opacity: 0.6; padding: 12px 0;">该命令没有可配置的入参。</div>
            {/if}

            <!-- 快捷变量药丸栏 -->
            <div style="flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--indexos-border-subtle); padding-top: 8px;">
                <div style="font-size: 10px; color: var(--indexos-text-muted);">
                    快捷变量（插入到当前选中的入参 <code style="font-size: 9px;">{activeParam || "（点击输入框选中）"}</code>）
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                    {#each ENV_VARS as v}
                        <button type="button" class="indexos-btn-bordered" style="font-size: 10px; padding: 1px 7px;" on:click={() => insertQuick(v)}>&#123;&#123;{v}&#125;&#125;</button>
                    {/each}
                </div>
                {#if previousOutputsForStep(currentEditingStep.uid).length > 0}
                    <div style="font-size: 10px; color: var(--indexos-text-muted); margin-top: 2px;">前序出参</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        {#each previousOutputsForStep(currentEditingStep.uid) as po}
                            <button
                                type="button"
                                class="indexos-btn-bordered"
                                style="font-size: 10px; padding: 1px 7px; color: var(--indexos-status-success);"
                                title="{po.source}"
                                on:click={() => insertQuick(po.name)}
                            >{po.name}</button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
