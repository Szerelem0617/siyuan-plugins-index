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
            showMessage("🗄️ 正在实例化系统存储库...");
            await constructCommandStorage();
            await refreshSupertagRegistry();
            await loadData();
        } catch (e: any) {
            console.error("Init system failed", e);
            showMessage(`实例化失败: ${e.message}`, 5000, "error");
        }
    }



    async function handleGenerateOutline() {
        try {
            showMessage("📑 正在生成列表...");
            const success = await reverseDbToList();
            if (success) {
                await refreshSupertagRegistry();
                await loadData();
            }
        } catch (e: any) {
            console.error("Generate outline failed", e);
            showMessage(`生成列表失败: ${e.message}`, 5000, "error");
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

            const { db } = await getSqliteEngine();
            const { commands: commandsTable } = getSystemTableNames();

            const defaultEntries: string[] = [];
            if (cmd.seed && cmd.seed.uiEntries) {
                if (cmd.seed.uiEntries.includes("topbar")) defaultEntries.push("顶栏");
                if (cmd.seed.uiEntries.includes("inline")) defaultEntries.push("行内按钮");
                if (cmd.seed.uiEntries.includes("palette")) defaultEntries.push("快捷命令");
            } else {
                defaultEntries.push("快捷命令");
            }
            const uiEntriesStr = defaultEntries.join(", ");

            db.run(`
                INSERT INTO ${commandsTable} (rowID, label, Command_ID, Param_Mapping, UI_Entries)
                VALUES (?, ?, ?, ?, ?)
            `, [
                rowID,
                cmd.name,
                cmd.id,
                "",
                uiEntriesStr
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
            const href = `siyuan-btn://exec/${cmdPart}`;

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
    $: cmdUiEntriesIdx = colIdx(commandCols, "UI_Entries");

    $: typeSupertagIdx = colIdx(typeCols, typeSupertagCol);
    $: typeIconMenuIdx = colIdx(typeCols, "Icon_Menu");

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
                🗄️ 实例化
            </button>
            <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 3px 8px; font-weight: 500;" on:click={handleGenerateOutline} disabled={!isInitialized}>
                📑 生成列表
            </button>
            {#if canUseFeature("commands.pull")}
                <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 3px 8px; font-weight: 500;" on:click={openPullModal}>
                    📥 拉取内置命令
                </button>
            {/if}
        </div>

        <!-- Section 1: Command List (逻辑工厂) -->
        <div class="db-section fn__flex-column" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
            <div class="fn__flex" style="align-items: center; margin-bottom: 12px; gap: 8px; justify-content: space-between; flex-wrap: wrap;">
                <div class="fn__flex" style="align-items: center; gap: 8px;">
                    <h3 style="margin: 0; font-size: 13px; font-weight: 600;">🛠️ 指令注册列表 (Command-DB)</h3>
                    <input
                        type="text"
                        class="b3-text-field"
                        style="font-size: 10px; padding: 2px 8px; width: 180px;"
                        placeholder="过滤指令名称或ID..."
                        bind:value={cmdSearchQuery}
                    />
                </div>
                <div style="font-size: 11px; opacity: 0.8; color: var(--b3-theme-primary); font-weight: 500;">
                    💡 点击任意指令卡片，即可快速复制对应的“按钮链接 (siyuan-btn://)”到剪贴板。
                </div>
            </div>

            <div class="table-container fn__flex-1" style="overflow: auto; border: 1px solid var(--b3-border-color); border-radius: 8px; background: #111113; padding: 16px;">
                {#if filteredCommands.length === 0}
                    <div style="text-align: center; padding: 20px; opacity: 0.4; font-size: 11px;">未找到指令</div>
                {:else}
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; align-content: start;">
                        {#each filteredCommands as row}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <div 
                                class="cmd-item-card" 
                                on:click={() => copyButtonLink(row[cmdIdIdx], row[cmdParamIdx], row[cmdLabelIdx])}
                            >
                                <div class="cmd-card-body" style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px;">
                                    <span class="cmd-name-label" style="font-weight: 500; font-size: 12px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        {row[cmdLabelIdx]}
                                    </span>
                                    <span class="copy-hint-icon" style="font-size: 12px; opacity: 0.3; transition: opacity 0.2s ease;">🔗</span>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    /* ─── Command Cards Grid Styling ─── */
    .cmd-item-card {
        display: flex;
        align-items: center;
        padding: 10px 14px;
        background: #1e1e22;
        border: 1px solid #2a2a2e;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
    }
    .cmd-item-card:hover {
        background: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .cmd-item-card:hover .cmd-name-label {
        color: var(--b3-theme-on-primary) !important;
    }
    .cmd-item-card:hover .copy-hint-icon {
        opacity: 0.9 !important;
        color: var(--b3-theme-on-primary);
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
