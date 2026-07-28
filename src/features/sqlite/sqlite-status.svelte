<script lang="ts">
    import { onMount } from "svelte";
    import { openTab } from "siyuan";
    import { plugin } from "../../shared/utils";
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
    
    // Cyclic locating index tracker
    let locateIndices: Record<string, number> = {};

    // Tabs
    let activeTab: "databases" | "console" | "commands" = "databases";



    async function init() {
        loading = true;
        try {
            const rawBlocks = await fetchAllAVBlocks();
            instantiatedIds = await getInstantiatedIds();
            syncMeta = await getSyncMetadata();
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

    async function executeSQL() {
        queryError = "";
        showExportMenu = false;

        try {
            queryResult = await runQuery(sqlInput);
            copyStatus = "Copy";
            
            // Refresh instantiated IDs list in UI after execution
            instantiatedIds = await getInstantiatedIds();
            syncMeta = await getSyncMetadata();
            avBlocks.forEach(b => {
                if (instantiatedIds.has(b.avId)) {
                    const meta = syncMeta[b.avId];
                    syncStatus[b.avId] = meta
                        ? `✓ ${meta.rowCount}r × ${meta.colCount}c`
                        : "Ready";
                }
            });
            syncStatus = syncStatus;
        } catch (e: any) {
            queryError = e.message;
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
        sqlInput = sql;
        showSavedQueries = false;
    }

    async function viewSchema(avId: string) {
        selectedSchemaAvId = avId;
        let cols = await getAVSchema(avId);
        if (cols.length === 0) {
            syncStatus[avId] = "⟳ Loading...";
            syncStatus = syncStatus;
            try {
                const res = await instantiateAV(avId, true);
                if (res.success) {
                    cols = await getAVSchema(avId);
                    instantiatedIds.add(avId);
                    instantiatedIds = instantiatedIds;
                    syncMeta = await getSyncMetadata();
                    syncStatus[avId] = `✓ ${res.rowCount} rows`;
                } else {
                    syncStatus[avId] = "✗ " + res.message;
                }
            } catch (e) {
                syncStatus[avId] = "✗ Error";
            }
            syncStatus = syncStatus;
        }
        schemaColumns = cols;
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

<div class="av-explorer-panel fn__flex-column" style="padding: 16px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); height: 100%; display: flex; flex-direction: column; min-height: 480px;">
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
        <button 
            class="b3-button b3-button--text" 
            style="font-size: 11px; padding: 2px 6px; display: flex; align-items: center; gap: 4px; border: none; background: none; color: var(--b3-theme-on-surface-light); cursor: pointer;" 
            on:click={init} 
            disabled={loading}
        >
            <svg style="width: 12px; height: 12px; fill: currentColor; margin-right: 2px;"><use xlink:href="#iconRefresh"></use></svg>
            {loading ? "扫描中..." : "刷新扫描"}
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
                                <span class="av-card__name" class:duplicate-name-warning={block.isDuplicateName} title={block.name}>
                                    {block.name}
                                    {#if block.mirrorCount > 1}
                                        <span class="av-card__mirrors-badge" style="font-size: 10px; color: var(--b3-theme-primary); font-weight: normal; margin-left: 4px; background: rgba(92, 184, 92, 0.15); padding: 1px 4px; border-radius: 3px;" title="This database is referenced by {block.mirrorCount} blocks (mirrors).">
                                            {block.mirrorCount} 镜像
                                        </span>
                                    {/if}
                                    {#if block.isUnnamed}
                                        <span class="av-card__duplicate-badge" style="font-size: 10px; color: #f59e0b; font-weight: normal; margin-left: 4px; background: rgba(245, 158, 11, 0.15); padding: 1px 4px; border-radius: 3px;" title="该数据库未命名。请在界面上重命名以支持基于表名的 SQL 查询。">
                                            ⚠️ 数据库未命名
                                        </span>
                                    {:else if block.isDuplicateName}
                                        <span class="av-card__duplicate-badge" style="font-size: 10px; color: #ef4444; font-weight: normal; margin-left: 4px; background: rgba(239, 68, 68, 0.15); padding: 1px 4px; border-radius: 3px;" title="Multiple databases share this name. SQL queries using this name will throw an error.">
                                            ⚠️ 同名冲突
                                        </span>
                                    {/if}
                                </span>
                                <span class="av-card__status" class:ready={instantiatedIds.has(block.avId)}>
                                    {syncStatus[block.avId] || "Pending"}
                                </span>
                            </div>
                            <div class="av-card__table" title="SQLite Table Name: {avIdToTableName(block.avId)}">
                                Table: {avIdToTableName(block.avId)}
                            </div>
                            <div class="av-card__id" title="AV ID: {block.avId}">
                                AV ID: {block.avId}
                            </div>
                            {#if syncMeta[block.avId]}
                                <div class="av-card__meta">
                                    Last: {formatTimestamp(syncMeta[block.avId].updated)}
                                </div>
                            {/if}
                            <div class="av-card__actions">
                                <button class="b3-button b3-button--text" style="font-size: 10px;" on:click={() => useSqlForAv(block.avId)}>Query</button>
                                <button class="b3-button b3-button--text" style="font-size: 10px;" on:click={() => viewSchema(block.avId)}>Schema</button>
                                <button class="b3-button b3-button--text" style="font-size: 10px;" on:click={() => locateAv(block)}>Locate</button>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Schema Modal -->
        {#if showSchema}
            <div 
                class="schema-overlay" 
                role="button" 
                tabindex="-1" 
                on:click|self={() => showSchema = false}
                on:keydown|self={(e) => { if (e.key === 'Escape') showSchema = false; }}
            >
                <div class="schema-modal">
                    <div class="fn__flex" style="align-items: center; margin-bottom: 12px;">
                        <h3 style="margin: 0; font-size: 14px; flex: 1; display: flex; align-items: center; gap: 6px;">
                            <span>Schema: {avIdToTableName(selectedSchemaAvId)}</span>
                            <span style="opacity: 0.4; font-size: 10px; font-weight: normal; font-family: monospace;">({selectedSchemaAvId})</span>
                        </h3>
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
    .av-card__table {
        font-family: monospace;
        font-size: 10px;
        opacity: 0.75;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-bottom: 2px;
    }
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
