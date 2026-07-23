<script lang="ts">
    import { onMount } from "svelte";
    import { getTargetTablesInfo, refreshSupertagRegistry } from "../../command/utils/sync-service";
    import { runQuery, getSqliteEngine, saveDatabaseToDisk, tableNameToAvId } from "../sqlite-manager";
    import { dispatchCommand } from "../../command/command-dispatcher";
    import { showMessage } from "siyuan";
    import { constructCommandStorage } from "../../command/construct-dir";
    import { getSystemTableNames, initSystemTables } from "../../command/indexos/command-sqlite";

    let loading = true;
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
            showMessage("正在从默认模版实例化系统 Command-DB 与 Type-DB...", 3000, "info");
            await constructCommandStorage();
            await refreshSupertagRegistry();
            showMessage("✓ 系统数据库与初始化规则实例化完成！", 3000, "info");
            await loadData();
        } catch (e: any) {
            console.error("System init failed", e);
            showMessage(`实例化失败: ${e.message}`, 5000, "error");
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

    import { encodeBtnHref } from "../../command/global-registration/inline-button";

    function copyButtonLink(cmdId: string, paramStr: string, label: string) {
        if (!cmdId) return;
        try {
            // 复制为普通命令链接（尊重系统/Supertag动态配置，不强行冻结/脱钩参数）
            const href = encodeBtnHref({ command: cmdId });

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
                    <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 2px 8px; font-weight: 500; margin-left: 4px;" on:click={handleInitSystem}>
                        🗄️ 实例化数据库
                    </button>
                </div>
                <div style="font-size: 11px; opacity: 0.8; color: var(--b3-theme-primary); font-weight: 500;">
                    💡 点击任意指令卡片，即可快速复制对应的“按钮链接”到剪贴板。
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
