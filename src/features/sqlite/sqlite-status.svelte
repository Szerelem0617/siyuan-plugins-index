<script lang="ts">
    import { onMount } from "svelte";
    import { fetchAllAVBlocks } from "./sqlite-data-fetcher";
    import { instantiateAV, runQuery, getInstantiatedIds } from "./sqlite-manager";

    let avBlocks: any[] = [];
    let loading = true;
    let syncStatus: Record<string, string> = {};
    let instantiatedIds = new Set<string>();
    let batchProcessing = false;
    
    // SQL Console
    let sqlInput = "SELECT * FROM ";
    let queryResult: { columns: any[], values: any[] } | null = null;
    let queryError = "";
    let copyStatus = "Copy CSV";

    async function init() {
        loading = true;
        try {
            avBlocks = await fetchAllAVBlocks();
            instantiatedIds = await getInstantiatedIds();
            avBlocks.forEach(b => {
                if (instantiatedIds.has(b.avId)) syncStatus[b.avId] = "Ready (Cached)";
            });
        } catch (e) {
            console.error("Init failed", e);
        } finally {
            loading = false;
        }
    }

    async function handleSync(avId: string) {
        syncStatus[avId] = "Syncing...";
        try {
            const res = await instantiateAV(avId);
            if (res.success) {
                syncStatus[avId] = `Ready (${res.rowCount} rows)`;
                sqlInput = `SELECT * FROM "${avId}" LIMIT 10`;
                instantiatedIds.add(avId);
            } else {
                syncStatus[avId] = "Failed: " + res.message;
            }
        } catch (e) {
            syncStatus[avId] = "Error";
        }
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
        try {
            queryResult = await runQuery(sqlInput);
            copyStatus = "Copy CSV"; // Reset copy button state
        } catch (e) {
            queryError = e.message;
            queryResult = null;
        }
    }

    function copyResults() {
        if (!queryResult) return;
        const csvRows = [];
        // Header
        csvRows.push(queryResult.columns.join(","));
        // Rows
        queryResult.values.forEach(row => {
            const escapedRow = row.map(val => {
                const s = val === null ? "" : String(val);
                // Simple CSV escaping: if contains comma or quote, wrap in quotes
                if (s.includes(",") || s.includes('"') || s.includes("\n")) {
                    return `"${s.replace(/"/g, '""')}"`;
                }
                return s;
            });
            csvRows.push(escapedRow.join(","));
        });
        
        navigator.clipboard.writeText(csvRows.join("\n")).then(() => {
            copyStatus = "Copied!";
            setTimeout(() => { copyStatus = "Copy CSV"; }, 2000);
        });
    }

    onMount(() => {
        init();
    });
</script>

<div class="av-explorer-panel fn__flex-column" style="padding: 20px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); height: 100%; display: flex; flex-direction: column; min-height: 480px;">
    <!-- Top Section -->
    <div class="fn__flex" style="align-items: center; margin-bottom: 16px; gap: 8px;">
        <h1 style="font-size: 18px; margin: 0; flex: 1; font-weight: 600;">AV SQL Explorer</h1>
        <button class="b3-button b3-button--outline" on:click={init} disabled={loading || batchProcessing}>Scan</button>
        <button class="b3-button b3-button--outline" on:click={instantiateAll} disabled={loading || batchProcessing || avBlocks.length === 0}>
            {batchProcessing ? "Processing..." : "Sync All"}
        </button>
    </div>

    <!-- AV Table -->
    <div class="table-container" style="max-height: 120px; overflow-y: auto; border: 1px solid var(--b3-border-color); border-radius: 8px; margin-bottom: 20px; flex-shrink: 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead style="background: var(--b3-theme-surface); position: sticky; top: 0; z-index: 5;">
                <tr>
                    <th style="padding: 8px; text-align: left; width: 30%;">Database</th>
                    <th style="padding: 8px; text-align: left; width: 40%;">ID</th>
                    <th style="padding: 8px; text-align: left; width: 20%;">Status</th>
                    <th style="padding: 8px; text-align: right; width: 10%;">Action</th>
                </tr>
            </thead>
            <tbody>
                {#each avBlocks as block}
                    <tr style="border-top: 1px solid var(--b3-border-color);">
                        <td style="padding: 8px; font-weight: 500;">{block.name}</td>
                        <td style="padding: 8px; font-family: monospace; opacity: 0.6; font-size: 10px;">{block.avId}</td>
                        <td style="padding: 8px;">
                            <span style="color: {instantiatedIds.has(block.avId) ? '#10b981' : 'inherit'};">
                                {syncStatus[block.avId] || 'Pending'}
                            </span>
                        </td>
                        <td style="padding: 8px; text-align: right;">
                            <button class="b3-button b3-button--text" style="font-size: 10px;" on:click={() => handleSync(block.avId)}>Sync</button>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    <!-- SQL Console -->
    <div class="sql-console fn__flex-1 fn__flex-column" style="border-top: 2px solid var(--b3-border-color); padding-top: 15px; min-height: 0; display: flex; flex-direction: column;">
        <div class="fn__flex" style="gap: 10px; margin-bottom: 10px; align-items: flex-end;">
            <div class="fn__flex-1">
                <input class="b3-text-field fn__block" bind:value={sqlInput} on:keydown={(e) => e.key === 'Enter' && executeSQL()} placeholder="SELECT * FROM table" />
            </div>
            <button class="b3-button" on:click={executeSQL}>Run SQL</button>
            <button class="b3-button b3-button--outline" on:click={copyResults} disabled={!queryResult} style="width: 80px;">
                {copyStatus}
            </button>
        </div>

        {#if queryError}
            <div style="color: #fca5a5; font-size: 11px; padding: 8px; background: rgba(220, 38, 38, 0.1); border-radius: 4px; margin-bottom: 8px;">
                {queryError}
            </div>
        {/if}

        <div class="result-viewer fn__flex-1" style="overflow: auto; border: 1px solid var(--b3-border-color); border-radius: 4px; background: #1a1a1a; color: #e5e5e5; min-height: 200px;">
            {#if queryResult}
                <table style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'JetBrains Mono', monospace; min-width: 100%;">
                    <thead style="background: #2d2d2d; position: sticky; top: 0; box-shadow: 0 1px 0 #444;">
                        <tr>
                            {#each queryResult.columns as col}
                                <th style="padding: 8px; text-align: left; border-right: 1px solid #3d3d3d; color: #4ec9b0; white-space: nowrap;">{col}</th>
                            {/each}
                        </tr>
                    </thead>
                    <tbody>
                        {#each queryResult.values as row}
                            <tr style="border-bottom: 1px solid #2d2d2d;">
                                {#each row as val}
                                    <td style="padding: 6px 8px; border-right: 1px solid #2d2d2d; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={val}>
                                        {val === null ? 'NULL' : val}
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            {:else}
                <div style="height: 100%; display: flex; align-items: center; justify-content: center; opacity: 0.2; font-style: italic;">
                    Query Result Empty
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    tr:hover { background-color: var(--b3-theme-background-hover); }
    .b3-button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
