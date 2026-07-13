<script lang="ts">
    import { onMount } from "svelte";
    import { getTargetTablesInfo, refreshSupertagRegistry } from "../../command/registration";
    import { runQuery, getSqliteEngine, saveDatabaseToDisk, tableNameToAvId } from "../sqlite-manager";
    import { dispatchCommand } from "../../command/command-dispatcher";
    import { showMessage } from "siyuan";
    import { constructCommandStorage } from "../../command/construct-dir";
    import { reverseDbToList } from "../../command/hierarchy/db-reverse-list";
    import { getSystemTableNames, initSystemTables } from "../../command/indexos/command-sqlite";
    import { canUseFeature } from "../../dev-mode/policy-guard";

    let loading = true;
    let showPullModal = false;
    let pullableCommands: any[] = [];
    let pullLoading = false;
    let commandRows: any[] = [];
    let commandCols: string[] = [];
    let typeRows: any[] = [];
    let typeCols: string[] = [];
    
    let commandsTable = "";
    let typesTable = "";
    let commandLabelCol = "";
    let typeSupertagCol = "";
    let isInitialized = false;

    // Search and filter
    let cmdSearchQuery = "";
    let typeSearchQuery = "";

    async function loadData() {
        loading = true;
        try {
            const info = await getTargetTablesInfo();
            commandsTable = info.commandsTable;
            typesTable = info.typesTable;
            commandLabelCol = info.commandLabelCol;
            typeSupertagCol = info.typeSupertagCol;
            isInitialized = info.isInitialized;

            const cmdRes = await runQuery(`SELECT * FROM ${commandsTable}`);
            if (cmdRes) {
                commandCols = cmdRes.columns;
                commandRows = cmdRes.values;
            }

            const typeRes = await runQuery(`SELECT * FROM ${typesTable}`);
            if (typeRes) {
                typeCols = typeRes.columns;
                typeRows = typeRes.values;
            }
        } catch (e) {
            console.error("[CommandsPanel] Failed to query SQLite database:", e);
        } finally {
            loading = false;
        }
    }

    async function handleInitSystem() {
        try {
            showMessage("🗄️ 正在初始化系统存储库...");
            await constructCommandStorage();
            await refreshSupertagRegistry();
            await loadData();
        } catch (e: any) {
            console.error("Init system failed", e);
            showMessage(`初始化失败: ${e.message}`, 5000, "error");
        }
    }

    async function handleResetSqlite() {
        try {
            showMessage("⟳ 正在重置内置 SQLite 数据库...");
            const { db } = await getSqliteEngine();
            const { commands, types } = getSystemTableNames();

            db.run(`DROP TABLE IF EXISTS ${commands}`);
            db.run(`DROP TABLE IF EXISTS ${types}`);
            await initSystemTables();
            await saveDatabaseToDisk();
            await refreshSupertagRegistry();
            await loadData();
            showMessage("内置 SQLite 数据库已重置并加载默认数据");
        } catch (e: any) {
            console.error("Reset SQLite failed", e);
            showMessage(`重置失败: ${e.message}`, 5000, "error");
        }
    }

    async function handleGenerateOutline() {
        try {
            showMessage("📑 正在实例化命令数据库到本地...");
            const success = await reverseDbToList();
            if (success) {
                await refreshSupertagRegistry();
                await loadData();
            }
        } catch (e: any) {
            console.error("Generate outline failed", e);
            showMessage(`实例化失败: ${e.message}`, 5000, "error");
        }
    }

    async function openPullModal() {
        pullLoading = true;
        showPullModal = true;
        try {
            const { registry: registryTable, commands: commandsTable } = getSystemTableNames();
            const res = await runQuery(`
                SELECT id, name, description, dispatch, params, constraints, meta 
                FROM ${registryTable} 
                WHERE id NOT IN (SELECT Command_ID FROM ${commandsTable} WHERE Command_ID IS NOT NULL)
            `);
            if (res && res.values) {
                pullableCommands = res.values.map(row => ({
                    id: row[0],
                    name: row[1],
                    description: row[2],
                    dispatch: JSON.parse(row[3] || "{}"),
                    params: JSON.parse(row[4] || "[]"),
                    constraints: JSON.parse(row[5] || "{}"),
                    meta: JSON.parse(row[6] || "{}")
                }));
            } else {
                pullableCommands = [];
            }
        } catch (e) {
            console.error("[CommandsPanel] Failed to load pullable commands:", e);
            showMessage("无法加载内置命令列表", 5000, "error");
        } finally {
            pullLoading = false;
        }
    }

    async function handlePullCommand(cmd: any) {
        try {
            // Generate standard rowID
            const formatPart = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
            const randPart = Math.random().toString(36).slice(2, 9);
            const rowID = `${formatPart}-${randPart}`;

            const requiresParams = (Array.isArray(cmd.params) && cmd.params.length > 0) ? "是" : "否";
            const targetScope = cmd.meta?.scope ? (cmd.meta.scope.charAt(0).toUpperCase() + cmd.meta.scope.slice(1)) : "Global";

            const { db } = await getSqliteEngine();
            const { commands: commandsTable } = getSystemTableNames();

            // Detect if table has Requires_Params column or Command_Type column
            const columnsInfo = db.exec(`PRAGMA table_info(${commandsTable})`);
            const hasRequiresParams = columnsInfo[0]?.values.some(v => v[1] === "Requires_Params");
            const colName = hasRequiresParams ? "Requires_Params" : "Command_Type";

            db.run(`
                INSERT INTO ${commandsTable} (rowID, label, Command_ID, Param_Mapping, ${colName}, Target_Scope, Enable, Top_Bar, Inline_Button, Command_Palette)
                VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, 0)
            `, [
                rowID,
                cmd.name,
                cmd.id,
                "",
                requiresParams,
                targetScope
            ]);

            await saveDatabaseToDisk();
            await refreshSupertagRegistry();
            
            showMessage(`✓ 已将命令【${cmd.name}】拉取到 Layer 2`);
            
            await loadData();
            await openPullModal();
        } catch (e: any) {
            console.error("Pull command failed", e);
            showMessage(`拉取失败: ${e.message}`, 5000, "error");
        }
    }

    async function runCommand(cmdId: string, paramStr: string, label: string) {
        if (!cmdId) return;
        try {
            showMessage(`⚡ 正在运行指令: ${label || cmdId}`);
            const mockContext = { blockEl: document.body, protyleEl: null };
            const res = await dispatchCommand(cmdId, paramStr, mockContext);
            if (res.success) {
                showMessage(`✓ 执行成功: ${res.detail}`);
            } else {
                showMessage(`✗ 执行失败: ${res.detail}`, 5000, "error");
            }
        } catch (err: any) {
            console.error("[CommandsPanel] Execution error:", err);
            showMessage(`执行出错: ${err.message}`, 5000, "error");
        }
    }

    function copyButtonLink(cmdId: string, paramStr: string, label: string) {
        if (!cmdId) return;
        try {
            const cmdPart = encodeURIComponent(cmdId);
            const params = new URLSearchParams();
            if (paramStr) params.set("p", paramStr);
            const query = params.toString();
            const href = `siyuan-btn://exec/${cmdPart}${query ? "?" + query : ""}`;

            navigator.clipboard.writeText(href).then(() => {
                showMessage(`📋 已复制命令按钮链接: ${label || cmdId}`);
            }).catch(err => {
                console.error("Failed to copy link:", err);
                showMessage("复制链接失败", 5000, "error");
            });
        } catch (e: any) {
            console.error("Failed to copy button link:", e);
            showMessage(`复制出错: ${e.message}`, 5000, "error");
        }
    }

    const colIdx = (cols: string[], name: string) => {
        return cols.findIndex(c => c.toLowerCase() === name.toLowerCase());
    };

    // Derived indices
    $: cmdLabelIdx = colIdx(commandCols, commandLabelCol);
    $: cmdIdIdx = colIdx(commandCols, "Command_ID");
    $: cmdParamIdx = colIdx(commandCols, "Param_Mapping");
    $: cmdTypeIdx = colIdx(commandCols, "Requires_Params") !== -1 ? colIdx(commandCols, "Requires_Params") : colIdx(commandCols, "Command_Type");
    $: cmdScopeIdx = colIdx(commandCols, "Target_Scope");
    $: cmdEnableIdx = colIdx(commandCols, "Enable");
    $: cmdTopBarIdx = colIdx(commandCols, "Top_Bar");
    $: cmdInlineIdx = colIdx(commandCols, "Inline_Button");
    $: cmdPaletteIdx = colIdx(commandCols, "Command_Palette");

    $: typeSupertagIdx = colIdx(typeCols, typeSupertagCol);
    $: typeBlockMenuIdx = colIdx(typeCols, "Block_Icon_Menu");
    $: typePageMenuIdx = colIdx(typeCols, "Current_Page_Menu");
    $: typeEnableIdx = colIdx(typeCols, "Enable");

    // Filtered lists
    $: filteredCommands = commandRows.filter(row => {
        if (!cmdSearchQuery) return true;
        const label = String(row[cmdLabelIdx] || "").toLowerCase();
        const cmdId = String(row[cmdIdIdx] || "").toLowerCase();
        const query = cmdSearchQuery.toLowerCase();
        return label.includes(query) || cmdId.includes(query);
    });

    $: filteredTypes = typeRows.filter(row => {
        if (!typeSearchQuery) return true;
        const supertag = String(row[typeSupertagIdx] || "").toLowerCase();
        const query = typeSearchQuery.toLowerCase();
        return supertag.includes(query);
    });

    onMount(() => {
        loadData();
    });
</script>

<div class="commands-db-panel fn__flex-column" style="height: 100%; display: flex; flex-direction: column; gap: 16px; min-height: 0;">
    {#if loading}
        <div style="text-align: center; padding: 40px; opacity: 0.4;">加载指令数据中...</div>
    {:else}
        <!-- Source info badge -->
        <div class="fn__flex" style="align-items: center; gap: 8px; font-size: 11px; padding: 6px 12px; background: var(--b3-theme-surface); border-radius: 4px; border: 1px solid var(--b3-border-color);">
            <span>📊 数据源: <strong>{isInitialized ? "思源活数据表 (Live AV)" : "本地系统种子表 (SQLite Seeds)"}</strong></span>
            <span style="opacity: 0.3;">|</span>
            <span>指令表: <code style="font-family: monospace;">{tableNameToAvId(commandsTable)}</code></span>
            <span style="opacity: 0.3;">|</span>
            <span>类型表: <code style="font-family: monospace;">{tableNameToAvId(typesTable)}</code></span>
            <div style="flex: 1;"></div>
            <button class="b3-button b3-button--text" style="font-size: 10px; padding: 2px 6px;" on:click={loadData}>⟳ 刷新数据</button>
        </div>

        <!-- System Admin Action Bar -->
        <div class="fn__flex" style="align-items: center; gap: 8px; font-size: 11px; padding: 6px 12px; background: var(--b3-theme-surface); border-radius: 4px; border: 1px solid var(--b3-border-color);">
            <span style="font-weight: 600; color: var(--b3-theme-primary); margin-right: 4px;">⚙️ 系统管理:</span>
            <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 3px 8px; font-weight: 500;" on:click={handleInitSystem}>
                🗄️ 初始化系统存储库
            </button>
            <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 3px 8px; font-weight: 500;" on:click={handleResetSqlite}>
                ⟳ 重置内置 SQLite 数据库
            </button>
            <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 3px 8px; font-weight: 500;" on:click={handleGenerateOutline} disabled={!isInitialized}>
                📑 实例化命令数据库到本地
            </button>
            {#if canUseFeature("commands.pull")}
                <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 3px 8px; font-weight: 500;" on:click={openPullModal}>
                    📥 拉取内置命令
                </button>
            {/if}
        </div>

        <!-- Section 1: Command List (逻辑工厂) -->
        <div class="db-section fn__flex-column" style="flex: 1; min-height: 200px; display: flex; flex-direction: column;">
            <div class="fn__flex" style="align-items: center; margin-bottom: 8px; gap: 8px;">
                <h3 style="margin: 0; font-size: 13px; font-weight: 600;">🛠️ 指令注册列表 (Command-DB)</h3>
                <input
                    type="text"
                    class="b3-text-field"
                    style="font-size: 10px; padding: 2px 8px; width: 180px;"
                    placeholder="过滤指令名称或ID..."
                    bind:value={cmdSearchQuery}
                />
            </div>

            <div class="table-container fn__flex-1" style="overflow: auto; border: 1px solid var(--b3-border-color); border-radius: 6px; background: #111113;">
                {#if filteredCommands.length === 0}
                    <div style="text-align: center; padding: 20px; opacity: 0.4; font-size: 11px;">未找到指令</div>
                {:else}
                    <table class="db-table">
                        <thead>
                            <tr>
                                <th>指令名称 (主键)</th>
                                <th>Command ID</th>
                                <th>需要参数</th>
                                <th>作用域</th>
                                <th style="text-align: center;">启用</th>
                                <th style="text-align: center;">位置 (T/I/P)</th>
                                <th style="text-align: center; width: 80px;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each filteredCommands as row}
                                <tr class:disabled={Number(row[cmdEnableIdx]) === 0}>
                                    <td class="primary-col" title={row[cmdLabelIdx]}>{row[cmdLabelIdx]}</td>
                                    <td><code style="color: #4ec9b0;">{row[cmdIdIdx] || ""}</code></td>
                                    <td style="opacity: 0.7;">{row[cmdTypeIdx] || "否"}</td>
                                    <td style="opacity: 0.7;">{row[cmdScopeIdx] || "Global"}</td>
                                    <td style="text-align: center;">
                                        <span class="status-dot" class:active={Number(row[cmdEnableIdx]) === 1}></span>
                                    </td>
                                    <td style="text-align: center; font-size: 10px; opacity: 0.6;">
                                        {Number(row[cmdTopBarIdx]) ? '顶' : '-'}/{Number(row[cmdInlineIdx]) ? '内' : '-'}/{Number(row[cmdPaletteIdx]) ? '板' : '-'}
                                    </td>
                                    <td style="text-align: center;">
                                        <button
                                            class="b3-button b3-button--text run-btn"
                                            disabled={Number(row[cmdEnableIdx]) === 0}
                                            on:click={() => copyButtonLink(row[cmdIdIdx], row[cmdParamIdx], row[cmdLabelIdx])}
                                        >
                                            🔗 复制链接
                                        </button>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                {/if}
            </div>
        </div>

        <!-- Section 2: Type Bindings (超级标签管理) -->
        <div class="db-section fn__flex-column" style="flex: 1; min-height: 180px; display: flex; flex-direction: column;">
            <div class="fn__flex" style="align-items: center; margin-bottom: 8px; gap: 8px;">
                <h3 style="margin: 0; font-size: 13px; font-weight: 600;">🖇️ 超级标签管理 (Type-DB)</h3>
                <input
                    type="text"
                    class="b3-text-field"
                    style="font-size: 10px; padding: 2px 8px; width: 180px;"
                    placeholder="过滤 Supertag..."
                    bind:value={typeSearchQuery}
                />
            </div>

            <div class="table-container fn__flex-1" style="overflow: auto; border: 1px solid var(--b3-border-color); border-radius: 6px; background: #111113;">
                {#if filteredTypes.length === 0}
                    <div style="text-align: center; padding: 20px; opacity: 0.4; font-size: 11px;">未找到超级标签绑定</div>
                {:else}
                    <table class="db-table">
                        <thead>
                            <tr>
                                <th>超级标签 (Supertag)</th>
                                <th>块图标菜单绑定 (Class Methods)</th>
                                <th>当前页面菜单绑定 (Class Methods)</th>
                                <th style="text-align: center; width: 60px;">启用</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each filteredTypes as row}
                                <tr class:disabled={Number(row[typeEnableIdx]) === 0}>
                                    <td class="primary-col" style="color: var(--b3-theme-primary); font-weight: bold;">{row[typeSupertagIdx]}</td>
                                    <td>
                                        {#if row[typeBlockMenuIdx]}
                                            {#each String(row[typeBlockMenuIdx]).split(/[,，]/).map(s => s.trim()).filter(Boolean) as cmdName}
                                                <span class="cmd-chip">{cmdName}</span>
                                            {/each}
                                        {:else}
                                            <span style="opacity: 0.3; font-size: 10px;">-</span>
                                        {/if}
                                    </td>
                                    <td>
                                        {#if row[typePageMenuIdx]}
                                            {#each String(row[typePageMenuIdx]).split(/[,，]/).map(s => s.trim()).filter(Boolean) as cmdName}
                                                <span class="cmd-chip page-chip">{cmdName}</span>
                                            {/each}
                                        {:else}
                                            <span style="opacity: 0.3; font-size: 10px;">-</span>
                                        {/if}
                                    </td>
                                    <td style="text-align: center;">
                                        <span class="status-dot" class:active={Number(row[typeEnableIdx]) === 1}></span>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    /* ─── Table Styling ─── */
    .db-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
        font-family: system-ui, -apple-system, sans-serif;
        color: #e5e5e5;
    }
    .db-table thead {
        background: #1e1e22;
        position: sticky;
        top: 0;
        z-index: 2;
    }
    .db-table th {
        padding: 8px 12px;
        text-align: left;
        border-right: 1px solid #2a2a2e;
        border-bottom: 1px solid #2a2a2e;
        color: #b0b0b5;
        white-space: nowrap;
        font-weight: 600;
    }
    .db-table td {
        padding: 6px 12px;
        border-right: 1px solid #1e1e22;
        border-bottom: 1px solid #1e1e22;
        max-width: 250px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .db-table tbody tr:hover {
        background: #1d1d21;
    }
    .db-table tbody tr.disabled {
        opacity: 0.45;
        background: rgba(0,0,0,0.1);
    }
    .primary-col {
        font-weight: 500;
        color: #fff;
    }

    /* ─── Status Dot ─── */
    .status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #6b7280;
    }
    .status-dot.active {
        background: #10b981;
        box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
    }

    /* ─── Buttons ─── */
    .run-btn {
        font-size: 10px;
        padding: 2px 6px;
        color: var(--b3-theme-primary);
        border-radius: 3px;
    }
    .run-btn:hover {
        background: rgba(144, 205, 244, 0.1);
    }

    /* ─── Chips ─── */
    .cmd-chip {
        display: inline-block;
        background: rgba(99, 102, 241, 0.15);
        color: #a5b4fc;
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 9px;
        margin-right: 4px;
        border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .cmd-chip.page-chip {
        background: rgba(236, 72, 153, 0.15);
        color: #fbcfe8;
        border-color: rgba(236, 72, 153, 0.2);
    }

    /* ─── Modal styling ─── */
    .schema-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        backdrop-filter: blur(4px);
    }
    .schema-modal {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 12px;
        padding: 16px;
        width: 90%;
        max-height: 80%;
        overflow-y: auto;
        box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    }
</style>

{#if showPullModal}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="schema-overlay" on:click|self={() => showPullModal = false}>
        <div class="schema-modal" style="max-width: 600px;">
            <div class="fn__flex" style="align-items: center; margin-bottom: 12px; gap: 8px;">
                <h3 style="margin: 0; font-size: 14px; font-weight: 600; flex: 1;">📥 拉取内置命令至 Layer 2</h3>
                <button class="b3-button b3-button--text" style="font-size: 11px;" on:click={() => showPullModal = false}>✕</button>
            </div>
            {#if pullLoading}
                <div style="text-align: center; padding: 30px; opacity: 0.4; font-size: 11px;">加载可拉取命令中...</div>
            {:else if pullableCommands.length === 0}
                <div style="text-align: center; padding: 30px; opacity: 0.4; font-size: 11px;">所有内置命令已全部拉取到 Layer 2</div>
            {:else}
                <div class="pull-list" style="max-height: 350px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
                    {#each pullableCommands as cmd}
                        <div class="pull-item" style="padding: 10px; border: 1px solid var(--b3-border-color); border-radius: 6px; background: var(--b3-theme-surface-lighter); display: flex; align-items: flex-start; gap: 10px;">
                            <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <strong style="font-size: 12px; color: #fff;">{cmd.name}</strong>
                                    <code style="font-size: 9px; color: #4ec9b0; font-family: monospace;">{cmd.id}</code>
                                </div>
                                <div style="font-size: 10px; opacity: 0.6; line-height: 1.4;">{cmd.description || "无描述"}</div>
                                <div style="display: flex; gap: 6px; margin-top: 4px;">
                                    <span style="font-size: 9px; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; opacity: 0.7;">Scope: {cmd.meta?.scope || "global"}</span>
                                    <span style="font-size: 9px; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; opacity: 0.7;">Method: {cmd.dispatch?.method || "custom"}</span>
                                </div>
                            </div>
                            <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 4px 10px; font-weight: 500;" on:click={() => handlePullCommand(cmd)}>
                                📥 拉取
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}
