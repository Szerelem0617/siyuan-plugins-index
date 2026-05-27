<script lang="ts">
    import { onMount } from "svelte";
    import { fetchAllAVBlocks } from "./sqlite-data-fetcher";
    import {
        instantiateAV, runQuery, getInstantiatedIds, getSyncMetadata,
        getAVSchema, saveQuery, getSavedQueries, deleteSavedQuery,
        exportToCSV, exportToJSON, downloadFile,
        avIdToTableName, type AVColumnSchema, type SavedQuery
    } from "./sqlite-manager";
    import CommandsPanel from "./commands-db/CommandsPanel.svelte";

    let avBlocks: any[] = [];
    let loading = true;
    let syncStatus: Record<string, string> = {};
    let instantiatedIds = new Set<string>();
    let syncMeta: Record<string, { updated: string; rowCount: number; colCount: number }> = {};
    let batchProcessing = false;
    
    // SQL Console
    let sqlInput = "SELECT * FROM ";
    let queryResult: { columns: any[], values: any[] } | null = null;
    let queryError = "";
    let copyStatus = "Copy";

    // Saved Queries
    let savedQueries: SavedQuery[] = [];
    let showSavedQueries = false;
    let saveQueryName = "";

    // Schema Panel
    let showSchema = false;
    let selectedSchemaAvId = "";
    let schemaColumns: AVColumnSchema[] = [];

    // Export
    let showExportMenu = false;

    // Tabs
    let activeTab: "databases" | "console" | "commands" = "commands";

    function detectSqlType(sql: string): string {
        return sql.trim().split(/\s+/)[0]?.toUpperCase() || "";
    }

    async function init() {
        loading = true;
        try {
            avBlocks = await fetchAllAVBlocks();
            instantiatedIds = await getInstantiatedIds();
            syncMeta = await getSyncMetadata();
            savedQueries = await getSavedQueries();
            avBlocks.forEach(b => {
                if (instantiatedIds.has(b.avId)) {
                    const meta = syncMeta[b.avId];
                    syncStatus[b.avId] = meta
                        ? `✓ ${meta.rowCount}r × ${meta.colCount}c`
                        : "Ready";
                }
            });
        } catch (e) {
            console.error("Init failed", e);
        } finally {
            loading = false;
        }
    }

    async function handleSync(avId: string, force = false) {
        syncStatus[avId] = "⟳ Syncing...";
        syncStatus = syncStatus;
        try {
            const res = await instantiateAV(avId, force);
            if (res.success) {
                if (res.unchanged) {
                    syncStatus[avId] = syncMeta[avId]
                        ? `✓ ${syncMeta[avId].rowCount}r (unchanged)`
                        : "✓ Up to date";
                } else {
                    syncStatus[avId] = `✓ ${res.rowCount} rows`;
                }
                instantiatedIds.add(avId);
                syncMeta = await getSyncMetadata();
            } else {
                syncStatus[avId] = "✗ " + res.message;
            }
        } catch (e) {
            console.error(`[SQLite-UI] Sync failed for ${avId}:`, e);
            syncStatus[avId] = "✗ Error";
        }
        syncStatus = syncStatus;
    }

    async function instantiateAll() {
        if (avBlocks.length === 0) return;
        batchProcessing = true;
        for (const block of avBlocks) {
            await handleSync(block.avId);
        }
        batchProcessing = false;
    }

    async function executeSQL() {
        queryError = "";
        showExportMenu = false;

        const sqlType = detectSqlType(sqlInput);

        if (["UPDATE", "DELETE", "INSERT", "DROP", "ALTER", "CREATE"].includes(sqlType)) {
            queryError = `⚠️ ${sqlType} 语句在 SQL 终端中已被禁用。本地 SQLite 仅作为只读缓存使用。请在思源笔记的表格界面或通过官方 API 修改数据。`;
            queryResult = null;
        } else {
            // Read-only query (SELECT, PRAGMA, EXPLAIN, etc.)
            try {
                queryResult = await runQuery(sqlInput);
                copyStatus = "Copy";
            } catch (e: any) {
                queryError = e.message;
                queryResult = null;
            }
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
        sqlInput = sql;
        showSavedQueries = false;
    }

    async function viewSchema(avId: string) {
        selectedSchemaAvId = avId;
        schemaColumns = await getAVSchema(avId);
        showSchema = true;
    }

    function getTypeIcon(type: string): string {
        const icons: Record<string, string> = {
            text: "Aa", number: "#", select: "◉", mSelect: "☰",
            date: "📅", checkbox: "☑", url: "🔗", email: "✉",
            phone: "📞", relation: "↗", rollup: "Σ", block: "▣",
            mAsset: "📎", template: "{ }", created: "⏰", updated: "⏰"
        };
        return icons[type] || "?";
    }

    function formatTimestamp(iso: string): string {
        if (!iso) return "";
        try {
            const d = new Date(iso);
            return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        } catch { return iso; }
    }

    function formatChangeTs(iso: string): string {
        if (!iso) return "";
        try {
            const d = new Date(iso);
            return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        } catch { return iso; }
    }

    function truncate(s: any, len: number = 20): string {
        if (s === null || s === undefined) return "NULL";
        const str = String(s);
        return str.length > len ? str.slice(0, len) + "…" : str;
    }

    function useSqlForAv(avId: string) {
        sqlInput = `SELECT * FROM ${avIdToTableName(avId)} LIMIT 20`;
        activeTab = "console";
    }

    onMount(() => {
        init();
    });
</script>

<div class="av-explorer-panel fn__flex-column" style="padding: 16px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); height: 100%; display: flex; flex-direction: column; min-height: 480px;">
    <!-- Header -->
    <div class="fn__flex" style="align-items: center; margin-bottom: 12px; gap: 8px;">
        <h1 style="font-size: 16px; margin: 0; font-weight: 600; letter-spacing: -0.3px;">⚡ AV SQL Explorer</h1>
        <div style="flex: 1;"></div>
        <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 4px 10px;" on:click={init} disabled={loading || batchProcessing}>
            {loading ? "..." : "Scan"}
        </button>
        <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 4px 10px;" on:click={instantiateAll} disabled={loading || batchProcessing || avBlocks.length === 0}>
            {batchProcessing ? "⟳..." : "Sync All"}
        </button>
    </div>

    <!-- Tab Bar -->
    <div class="fn__flex" style="gap: 0; margin-bottom: 12px; border-bottom: 1px solid var(--b3-border-color);">
        <button
            class="tab-btn"
            class:active={activeTab === "commands"}
            on:click={() => activeTab = "commands"}
        >
            Command Control (命令面板)
        </button>
        <button
            class="tab-btn"
            class:active={activeTab === "databases"}
            on:click={() => activeTab = "databases"}
        >
            Databases ({avBlocks.length})
        </button>
        <button
            class="tab-btn"
            class:active={activeTab === "console"}
            on:click={() => activeTab = "console"}
        >
            SQL Console
        </button>
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
                <div style="text-align: center; padding: 40px; opacity: 0.4;">Scanning...</div>
            {:else if avBlocks.length === 0}
                <div style="text-align: center; padding: 40px; opacity: 0.4;">No AV blocks found</div>
            {:else}
                <div class="av-grid">
                    {#each avBlocks as block}
                        <div class="av-card" class:synced={instantiatedIds.has(block.avId)}>
                            <div class="av-card__header">
                                <span class="av-card__name" title={block.name}>{block.name}</span>
                                <span class="av-card__status" class:ready={instantiatedIds.has(block.avId)}>
                                    {syncStatus[block.avId] || "Pending"}
                                </span>
                            </div>
                            <div class="av-card__id" title={block.avId}>{avIdToTableName(block.avId)}</div>
                            {#if syncMeta[block.avId]}
                                <div class="av-card__meta">
                                    Last: {formatTimestamp(syncMeta[block.avId].updated)}
                                </div>
                            {/if}
                            <div class="av-card__actions">
                                <button class="b3-button b3-button--text" style="font-size: 10px;" on:click={() => handleSync(block.avId, true)}>Sync</button>
                                {#if instantiatedIds.has(block.avId)}
                                    <button class="b3-button b3-button--text" style="font-size: 10px;" on:click={() => useSqlForAv(block.avId)}>Query</button>
                                    <button class="b3-button b3-button--text" style="font-size: 10px;" on:click={() => viewSchema(block.avId)}>Schema</button>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Schema Modal -->
        {#if showSchema}
            <div class="schema-overlay" on:click|self={() => showSchema = false}>
                <div class="schema-modal">
                    <div class="fn__flex" style="align-items: center; margin-bottom: 12px;">
                        <h3 style="margin: 0; font-size: 14px; flex: 1;">Schema: {avIdToTableName(selectedSchemaAvId)}</h3>
                        <button class="b3-button b3-button--text" style="font-size: 11px;" on:click={() => showSchema = false}>✕</button>
                    </div>
                    {#if schemaColumns.length === 0}
                        <div style="opacity: 0.4; text-align: center; padding: 20px;">No schema data</div>
                    {:else}
                        <table class="schema-table">
                            <thead>
                                <tr>
                                    <th style="width: 24px;"></th>
                                    <th>Column</th>
                                    <th>AV Name</th>
                                    <th>Type</th>
                                    <th>Access</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each schemaColumns as col}
                                    <tr>
                                        <td style="text-align: center; font-size: 12px;">{getTypeIcon(col.keyType)}</td>
                                        <td><code>{col.colName}</code></td>
                                        <td style="opacity: 0.7;">{col.keyName}</td>
                                        <td><span class="type-badge">{col.keyType}</span></td>
                                        <td>
                                            <span class="access-badge" class:writable={col.writable} class:readonly={!col.writable}>
                                                {col.writable ? "RW" : "RO"}
                                            </span>
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    {/if}
                </div>
            </div>
        {/if}
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
            {#if queryResult && queryResult.values.length > 0}
                <div class="fn__flex" style="gap: 6px; margin-bottom: 6px; align-items: center;">
                    <span style="font-size: 11px; opacity: 0.5;">{queryResult.values.length} rows × {queryResult.columns.length} cols</span>
                    <div style="flex: 1;"></div>
                    <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 2px 8px;" on:click={copyResults}>{copyStatus}</button>
                    <div style="position: relative;">
                        <button class="b3-button b3-button--outline" style="font-size: 10px; padding: 2px 8px;" on:click={() => showExportMenu = !showExportMenu}>↓ Export</button>
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
            <div class="result-viewer fn__flex-1" style="min-height: 150px;">
                {#if queryResult && queryResult.values.length > 0}
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
                {:else if queryResult}
                    <div class="empty-result">Query returned 0 rows</div>
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
        transition: border-color 0.15s, box-shadow 0.15s;
    }
    .av-card:hover {
        border-color: var(--b3-theme-primary-lighter);
        box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .av-card.synced {
        border-left: 3px solid #10b981;
    }
    .av-card__header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
    }
    .av-card__name {
        font-weight: 500;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }
    .av-card__status {
        font-size: 10px;
        opacity: 0.6;
        white-space: nowrap;
    }
    .av-card__status.ready { color: #10b981; opacity: 1; }
    .av-card__id {
        font-family: monospace;
        font-size: 9px;
        opacity: 0.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-bottom: 4px;
    }
    .av-card__meta {
        font-size: 10px;
        opacity: 0.45;
        margin-bottom: 4px;
    }
    .av-card__actions {
        display: flex;
        gap: 2px;
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

    /* ─── Schema & Changelog Modals ─── */
    .schema-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }
    .schema-modal {
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 10px;
        padding: 16px;
        max-width: 560px;
        width: 90%;
        max-height: 60vh;
        overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.25);
    }
    .schema-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
    }
    .schema-table th {
        padding: 6px 8px;
        text-align: left;
        font-weight: 500;
        border-bottom: 2px solid var(--b3-border-color);
        font-size: 10px;
        text-transform: uppercase;
        opacity: 0.6;
    }
    .schema-table td {
        padding: 5px 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }
    .schema-table code {
        font-size: 11px;
        background: rgba(100,100,100,0.15);
        padding: 1px 4px;
        border-radius: 3px;
    }
    .type-badge {
        display: inline-block;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(78, 201, 176, 0.15);
        color: #4ec9b0;
    }
    .access-badge {
        display: inline-block;
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 3px;
        font-weight: 600;
    }
    .access-badge.writable {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
    }
    .access-badge.readonly {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
    }



    /* ─── General ─── */
    .b3-button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
