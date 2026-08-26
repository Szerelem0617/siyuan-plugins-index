<script lang="ts">
    import { onMount } from "svelte";
    import { openTab } from "siyuan";
    import { plugin } from "../../shared/utils";
    import { fetchAllAVBlocks } from "./sqlite-data-fetcher";
    import {
        runQuery, saveQuery, getSavedQueries, deleteSavedQuery,
        exportToCSV, exportToJSON, downloadFile,
        avIdToTableName, type SavedQuery
    } from "./sqlite-manager";
    import CommandsPanel from "./commands-db/CommandsPanel.svelte";

    let avBlocks: any[] = [];
    let loading = true;
    
    // SQL Console
    let sqlInput = "SELECT * FROM ";
    let queryResult: { columns: any[], values: any[] } | null = null;
    let queryError = "";
    let copyStatus = "Copy";

    // Saved Queries
    let savedQueries: SavedQuery[] = [];
    let showSavedQueries = false;
    let saveQueryName = "";

    // Export
    let showExportMenu = false;
    
    // Cyclic locating index tracker
    let locateIndices: Record<string, number> = {};

    // Tabs
    let activeTab: "databases" | "console" | "commands" = "databases";

    async function init() {
        loading = true;
        try {
            const rawBlocks = await fetchAllAVBlocks();
            savedQueries = await getSavedQueries();
            
            // Group by avId to deduplicate and count mirrors
            const groups: Record<string, any> = {};
            rawBlocks.forEach(b => {
                if (!b.avId || b.avId === "Not Found") return;
                if (!groups[b.avId]) {
                    groups[b.avId] = {
                        name: b.name,
                        avId: b.avId,
                        mirrorCount: 0,
                        blockIds: [],
                        isDuplicateName: false
                    };
                }
                groups[b.avId].blockIds.push(b.blockId);
                groups[b.avId].mirrorCount = groups[b.avId].blockIds.length;
            });
            
            const tempBlocks = Object.values(groups);
            
            // Check for duplicate AV names (ignore empty or default unnamed database names)
            const nameCounts: Record<string, number> = {};
            tempBlocks.forEach((b: any) => {
                const name = (b.name || "").trim();
                const isUnnamed = !name || name === "Unnamed Database" || name === "Unnamed" || name === "未命名数据库";
                if (isUnnamed) {
                    b.isUnnamed = true;
                } else {
                    nameCounts[name] = (nameCounts[name] || 0) + 1;
                }
            });
            tempBlocks.forEach((b: any) => {
                const name = (b.name || "").trim();
                if (!b.isUnnamed && nameCounts[name] > 1) {
                    b.isDuplicateName = true;
                }
            });
            
            // Sort avBlocks: Pin command-db and supertag-db to top
            tempBlocks.sort((a: any, b: any) => {
                const nameA = (a.name || "").toLowerCase();
                const nameB = (b.name || "").toLowerCase();
                const isCmdA = nameA === "command-db";
                const isCmdB = nameB === "command-db";
                const isTagA = nameA === "supertag-db";
                const isTagB = nameB === "supertag-db";

                if (isCmdA) return -1;
                if (isCmdB) return 1;
                if (isTagA) return -1;
                if (isTagB) return 1;
                return nameA.localeCompare(nameB);
            });
            
            avBlocks = tempBlocks;
        } catch (e) {
            console.error("Init failed", e);
        } finally {
            loading = false;
        }
    }

    async function executeSQL() {
        console.log("[IndexOS-SQL-Debug] executeSQL triggered with SQL:", sqlInput);
        queryError = "";
        showExportMenu = false;
        queryResult = null; // 强行重置触发 Svelte 重新渲染

        try {
            const res = await runQuery(sqlInput);
            console.log("[IndexOS-SQL-Debug] runQuery execution result:", res);
            queryResult = res;
            copyStatus = "Copy";
        } catch (e: any) {
            console.error("[IndexOS-SQL-Debug] executeSQL failed with error:", e);
            queryError = e.message || String(e);
            queryResult = null;
        }
    }

    function copyResults() {
        if (!queryResult) return;
        const csv = exportToCSV(queryResult);
        navigator.clipboard.writeText(csv).then(() => {
            copyStatus = "Copied!";
            setTimeout(() => { copyStatus = "Copy"; }, 2000);
        });
    }

    function handleExportCSV() {
        if (!queryResult) return;
        const csv = exportToCSV(queryResult);
        downloadFile(csv, `query_${Date.now()}.csv`, "text/csv");
        showExportMenu = false;
    }

    function handleExportJSON() {
        if (!queryResult) return;
        const json = exportToJSON(queryResult);
        downloadFile(json, `query_${Date.now()}.json`, "application/json");
        showExportMenu = false;
    }

    async function handleSaveQuery() {
        if (!saveQueryName.trim() || !sqlInput.trim()) return;
        await saveQuery(saveQueryName.trim(), sqlInput.trim());
        savedQueries = await getSavedQueries();
        saveQueryName = "";
        showSavedQueries = true;
    }

    async function handleDeleteQuery(id: string) {
        await deleteSavedQuery(id);
        savedQueries = await getSavedQueries();
    }

    function loadQuery(sql: string) {
        console.log("[IndexOS-SQL-Debug] loadQuery clicked, loading SQL:", sql);
        sqlInput = sql;
        showSavedQueries = false;
        executeSQL();
    }

    function useSqlForAv(avId: string) {
        const tableName = avIdToTableName(avId);
        console.log("[IndexOS-SQL-Debug] useSqlForAv clicked, avId:", avId, "tableName:", tableName);
        sqlInput = `SELECT * FROM ${tableName} LIMIT 20`;
        activeTab = "console";
        setTimeout(() => {
            executeSQL();
        }, 50);
    }

    function locateAv(block: any) {
        if (block.blockIds && block.blockIds.length > 0) {
            const list = block.blockIds;
            const currentIdx = locateIndices[block.avId] !== undefined ? locateIndices[block.avId] : 0;
            const nextIdx = (currentIdx + 1) % list.length;
            locateIndices[block.avId] = nextIdx;
            
            const targetBlockId = list[currentIdx];
            console.log(`[SQLiteManager] Locating AV block ${targetBlockId} (index ${currentIdx}/${list.length}) for avID ${block.avId}`);
            openTab({
                app: plugin.app,
                doc: {
                    id: targetBlockId,
                    action: ["cb-get-hl", "cb-get-focus"]
                }
            });
        }
    }

    onMount(() => {
        init();
    });
</script>

<div class="av-explorer-panel indexos-management-panel fn__flex-column" style="padding: 16px; height: 100%; display: flex; flex-direction: column; min-height: 0; box-sizing: border-box; overflow: hidden;">
    <!-- Tab Bar -->
    <div class="fn__flex" style="gap: 0; margin-bottom: 12px; border-bottom: 1px solid var(--b3-border-color); align-items: center;">
        <button
            class="tab-btn"
            class:active={activeTab === "databases"}
            on:click={() => activeTab = "databases"}
        >
            数据库 ({avBlocks.length})
        </button>
        <button
            class="tab-btn"
            class:active={activeTab === "console"}
            on:click={() => activeTab = "console"}
        >
            SQL 控制台
        </button>
        <button
            class="tab-btn"
            class:active={activeTab === "commands"}
            on:click={() => activeTab = "commands"}
        >
            命令管理
        </button>
        <div style="flex: 1;"></div>
    </div>

    <!-- Tab Content: Command Control -->
    {#if activeTab === "commands"}
        <div class="fn__flex-1 fn__flex-column" style="min-height: 0; display: flex; flex-direction: column;">
            <CommandsPanel />
        </div>
    {/if}

    <!-- Tab Content: Databases -->
    {#if activeTab === "databases"}
        <div class="fn__flex-1" style="overflow-y: auto; min-height: 0;">
            {#if loading}
                <div style="text-align: center; padding: 40px; opacity: 0.4;">正在扫描数据库...</div>
            {:else if avBlocks.length === 0}
                <div style="text-align: center; padding: 40px; opacity: 0.4;">未发现数据库块</div>
            {:else}
                <div class="av-grid">
                    {#each avBlocks as block}
                        <div class="av-card">
                            <div class="av-card__header">
                                <span class="av-card__name" class:duplicate-name-warning={block.isDuplicateName} title={block.name}>
                                    {block.name}
                                    {#if block.mirrorCount > 1}
                                        <span class="indexos-tag-badge" style="font-size: 10px; margin-left: 4px;" title="此数据库在 {block.mirrorCount} 个块中被引用（镜像）。">
                                            <span class="badge-dot"></span>{block.mirrorCount} 镜像
                                        </span>
                                    {/if}
                                    {#if block.isUnnamed}
                                        <span class="indexos-tag-badge indexos-tag-badge--duplicate" style="font-size: 10px; margin-left: 4px;" title="该数据库未命名。请在界面上重命名以支持基于表名的 SQL 查询。">
                                            <span class="badge-dot"></span>未命名
                                        </span>
                                    {:else if block.isDuplicateName}
                                        <span class="indexos-tag-badge indexos-tag-badge--duplicate" style="font-size: 10px; margin-left: 4px;" title="多个数据库共享此名称，可能导致 SQL 表名冲突。">
                                            <span class="badge-dot"></span>同名冲突
                                        </span>
                                    {/if}
                                </span>
                            </div>
                            <div class="av-card__table" title="SQLite Table Name: {avIdToTableName(block.avId)}">
                                Table: {avIdToTableName(block.avId)}
                            </div>
                            <div class="av-card__id" title="AV ID: {block.avId}">
                                AV ID: {block.avId}
                            </div>
                            <div class="av-card__actions" style="margin-top: 8px; display: flex; gap: 6px; justify-content: flex-end;">
                                <button class="indexos-btn-bordered" style="font-size: 10px; padding: 2px 6px;" on:click={() => useSqlForAv(block.avId)}>Query</button>
                                <button class="indexos-btn-bordered" style="font-size: 10px; padding: 2px 6px;" on:click={() => locateAv(block)}>Locate</button>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <!-- Tab Content: SQL Console -->
    {#if activeTab === "console"}
        <div class="sql-console fn__flex-1 fn__flex-column" style="min-height: 0; display: flex; flex-direction: column;">
            <!-- SQL Input Area -->
            <div class="fn__flex" style="gap: 6px; margin-bottom: 8px; align-items: stretch;">
                <div class="fn__flex-1" style="position: relative;">
                    <textarea
                        class="b3-text-field fn__block sql-input"
                        bind:value={sqlInput}
                        on:keydown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                executeSQL();
                            }
                        }}
                        placeholder="SELECT * FROM table — Ctrl/⌘+Enter to run"
                        rows="3"
                    ></textarea>
                </div>
                <div class="fn__flex-column" style="gap: 4px;">
                    <button
                        class="b3-button"
                        style="font-size: 11px; padding: 4px 12px;"
                        on:click={executeSQL}
                    >
                        ▶ Run
                    </button>
                    <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 4px 12px; position: relative;"
                        on:click={() => showSavedQueries = !showSavedQueries}
                    >
                        ★ {savedQueries.length}
                    </button>
                </div>
            </div>

            <!-- Saved Queries Dropdown -->
            {#if showSavedQueries}
                <div class="saved-queries-panel" style="margin-bottom: 8px;">
                    <div class="fn__flex" style="gap: 6px; margin-bottom: 6px;">
                        <input class="b3-text-field fn__flex-1" bind:value={saveQueryName} placeholder="Query name..." style="font-size: 11px;" />
                        <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 2px 8px;" on:click={handleSaveQuery} disabled={!saveQueryName.trim()}>Save Current</button>
                    </div>
                    {#if savedQueries.length > 0}
                        <div style="max-height: 100px; overflow-y: auto;">
                            {#each savedQueries as q}
                                <div class="saved-query-item fn__flex" style="align-items: center; gap: 6px;">
                                    <button class="b3-button b3-button--text fn__flex-1" style="font-size: 11px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" on:click={() => loadQuery(q.sql)} title={q.sql}>
                                        <strong>{q.name}</strong>
                                    </button>
                                    <button class="b3-button b3-button--text" style="font-size: 10px; color: var(--b3-theme-error); padding: 0 4px;" on:click={() => handleDeleteQuery(q.id)}>✕</button>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <div style="font-size: 11px; opacity: 0.4; text-align: center; padding: 6px;">No saved queries</div>
                    {/if}
                </div>
            {/if}

            <!-- Error Display -->
            {#if queryError}
                <div class="query-error" style="margin-bottom: 8px; white-space: pre-wrap;">
                    {queryError}
                </div>
            {/if}

            <!-- Results Toolbar -->
            {#if queryResult && (queryResult.values.length > 0 || queryResult.columns.length > 0)}
                <div class="fn__flex" style="gap: 6px; margin-bottom: 6px; align-items: center;">
                    <span style="font-size: 11px; opacity: 0.7; font-weight: 500; font-family: monospace;">{queryResult.values.length} rows × {queryResult.columns.length} cols</span>
                    <div style="flex: 1;"></div>
                    <button class="indexos-btn-bordered" style="font-size: 10px; padding: 2px 8px;" on:click={copyResults}>{copyStatus}</button>
                    <div style="position: relative;">
                        <button class="indexos-btn-bordered" style="font-size: 10px; padding: 2px 8px;" on:click={() => showExportMenu = !showExportMenu}>↓ Export</button>
                        {#if showExportMenu}
                            <div class="export-menu">
                                <button class="export-menu__item" on:click={handleExportCSV}>📄 CSV File</button>
                                <button class="export-menu__item" on:click={handleExportJSON}>📦 JSON File</button>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}

            <!-- Results Table -->
            <div class="result-viewer fn__flex-1" style="min-height: 150px; overflow: auto;">
                {#if queryResult && (queryResult.columns.length > 0 || queryResult.values.length > 0)}
                    <table class="result-table">
                        <thead>
                            <tr>
                                <th class="row-num">#</th>
                                {#each queryResult.columns as col}
                                    <th>{col}</th>
                                {/each}
                            </tr>
                        </thead>
                        <tbody>
                            {#each queryResult.values as row, i}
                                <tr>
                                    <td class="row-num">{i + 1}</td>
                                    {#each row as val}
                                        <td title={val === null ? 'NULL' : String(val)}>
                                            {#if val === null}
                                                <span class="null-val">NULL</span>
                                            {:else}
                                                {val}
                                            {/if}
                                        </td>
                                    {/each}
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                    {#if queryResult.values.length === 0}
                        <div class="empty-result" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 12px; gap: 8px; text-align: center;">
                            <svg style="width: 28px; height: 28px; opacity: 0.3; color: var(--indexos-accent-primary);"><use xlink:href="#iconDatabase"></use></svg>
                            <div style="font-weight: 600; font-size: 12px; color: var(--b3-theme-on-background);">该数据库已解析结构 ({queryResult.columns.length} 列)，但当前暂无行数据 (0 行)</div>
                            <div style="font-size: 11px; opacity: 0.5;">请在页面数据库视图中为该数据库添加记录内容</div>
                        </div>
                    {/if}
                {:else if queryResult}
                    <div class="empty-result" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; padding: 24px 12px; box-sizing: border-box; text-align: center;">
                        <svg style="width: 32px; height: 32px; opacity: 0.3; color: var(--indexos-accent-primary);"><use xlink:href="#iconDatabase"></use></svg>
                        <div style="font-weight: 600; font-size: 13px; color: var(--b3-theme-on-background);">查询已执行完成，但当前数据库暂无记录 (0 行 / 0 列)</div>
                        <div style="font-size: 11px; opacity: 0.5; max-width: 360px; line-height: 1.4;">提示：若这是刚在思源笔记中创建的数据库，请先在页面数据库视图中添加条目或属性内容。</div>
                    </div>
                {:else}
                    <div class="empty-result">
                        <div style="text-align: center;">
                            <div style="margin-bottom: 8px;">Run a query to see results</div>
                            <div style="font-size: 10px; opacity: 0.5;">
                                SELECT → 只读查询
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .duplicate-name-warning {
        color: #ef4444 !important;
        font-weight: 600;
    }
    /* ─── Tab Bar ─── */
    .tab-btn {
        background: none;
        border: none;
        padding: 6px 14px;
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        opacity: 0.6;
        transition: all 0.15s;
    }
    .tab-btn:hover { opacity: 0.9; }
    .tab-btn.active {
        opacity: 1;
        border-bottom-color: var(--b3-theme-primary);
        color: var(--b3-theme-primary);
        font-weight: 500;
    }

    /* ─── AV Card Grid ─── */
    .av-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 8px;
    }
    .av-card {
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        padding: 10px 12px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        transition: border-color 0.15s, box-shadow 0.15s;
    }
    .av-card:hover {
        border-color: var(--b3-theme-primary);
        box-shadow: var(--b3-point-shadow);
    }
    .av-card__header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
    }
    .av-card__name {
        font-weight: 600;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }
    .av-card__table {
        font-family: var(--b3-font-family-code, monospace);
        font-size: 10px;
        color: var(--b3-theme-on-surface);
        opacity: 0.75;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-bottom: 2px;
    }
    .av-card__id {
        font-family: var(--b3-font-family-code, monospace);
        font-size: 9px;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.7;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-bottom: 4px;
    }
    .av-card__actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
    }

    /* ─── SQL Console ─── */
    .sql-input {
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 12px;
        resize: vertical;
        min-height: 48px;
        transition: border-color 0.15s;
    }


    .saved-queries-panel {
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 8px;
        background: var(--b3-theme-surface);
    }
    .saved-query-item {
        padding: 2px 0;
        border-bottom: 1px solid var(--b3-border-color);
    }
    .saved-query-item:last-child { border-bottom: none; }

    .query-error {
        color: #fca5a5;
        font-size: 11px;
        padding: 6px 10px;
        background: rgba(220, 38, 38, 0.1);
        border-radius: 4px;
        border-left: 3px solid #dc2626;
    }



    /* ─── Result Table ─── */
    .result-viewer {
        overflow: auto;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        background: #111113;
        color: #e5e5e5;
    }
    .result-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    .result-table thead {
        background: #1e1e22;
        position: sticky;
        top: 0;
        z-index: 2;
    }
    .result-table th {
        padding: 6px 8px;
        text-align: left;
        border-right: 1px solid #2a2a2e;
        color: #4ec9b0;
        white-space: nowrap;
        font-weight: 500;
    }
    .result-table td {
        padding: 4px 8px;
        border-right: 1px solid #1e1e22;
        border-bottom: 1px solid #1e1e22;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .result-table tbody tr:hover {
        background: #1a1a1e;
    }
    .row-num {
        color: #555;
        font-size: 9px;
        width: 30px;
        text-align: right;
        padding-right: 8px !important;
        user-select: none;
    }
    .null-val {
        color: #666;
        font-style: italic;
    }
    .empty-result {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.15;
        font-style: italic;
        font-size: 13px;
    }

    /* ─── Export Menu ─── */
    .export-menu {
        position: absolute;
        right: 0;
        top: 100%;
        margin-top: 4px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10;
        min-width: 120px;
        overflow: hidden;
    }
    .export-menu__item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 6px 12px;
        font-size: 11px;
        background: none;
        border: none;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
    }
    .export-menu__item:hover {
        background: var(--b3-theme-background-hover);
    }



    /* ─── General ─── */
    .b3-button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
