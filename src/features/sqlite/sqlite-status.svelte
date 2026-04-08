<script lang="ts">
    import { onMount } from "svelte";
    import { fetchAllAVBlocks } from "./sqlite-data-fetcher";
    import { instantiateAV, runQuery, getInstantiatedIds } from "./sqlite-manager";

    let avBlocks: any[] = [];
    let loading = true;
    let syncStatus: Record<string, string> = {};
    let instantiatedIds = new Set<string>();
    
    // SQL Console
    let sqlInput = "SELECT * FROM ";
    let queryResult: { columns: any[], values: any[] } | null = null;
    let queryError = "";

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

    async function executeSQL() {
        queryError = "";
        try {
            queryResult = await runQuery(sqlInput);
        } catch (e) {
            queryError = e.message;
            queryResult = null;
        }
    }

    onMount(() => {
        init();
    });
</script>

<div class="av-explorer-panel fn__flex-column" style="padding: 20px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); height: 100%; display: flex; flex-direction: column;">
    <div class="fn__flex" style="align-items: center; margin-bottom: 20px;">
        <h1 style="font-size: 20px; margin: 0; flex: 1; font-weight: 600;">IndexOS Database Diagnostic</h1>
        <button class="b3-button b3-button--outline" on:click={init} disabled={loading}>Scan Workspace</button>
    </div>

    <div class="table-container" style="max-height: 250px; overflow-y: auto; border: 1px solid var(--b3-border-color); border-radius: 8px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
            <thead style="background: var(--b3-theme-surface); position: sticky; top: 0; z-index: 5;">
                <tr>
                    <th style="padding: 10px; text-align: left; width: 30%;">Database Name</th>
                    <th style="padding: 10px; text-align: left; width: 35%;">Logical AV ID</th>
                    <th style="padding: 10px; text-align: left; width: 20%;">Local Status</th>
                    <th style="padding: 10px; text-align: right; width: 15%;">Action</th>
                </tr>
            </thead>
            <tbody>
                {#each avBlocks as block}
                    <tr style="border-top: 1px solid var(--b3-border-color);">
                        <td style="padding: 10px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{block.name}</td>
                        <td style="padding: 10px; font-family: monospace; opacity: 0.8; overflow: hidden; text-overflow: ellipsis;">{block.avId}</td>
                        <td style="padding: 10px;">
                            <span style="color: {instantiatedIds.has(block.avId) ? '#10b981' : 'inherit'}; opacity: 0.8;">
                                {syncStatus[block.avId] || 'Not Cached'}
                            </span>
                        </td>
                        <td style="padding: 10px; text-align: right;">
                            <button class="b3-button b3-button--text" style="font-size: 11px;" on:click={() => handleSync(block.avId)}>
                                {instantiatedIds.has(block.avId) ? 'Re-Sync' : 'Instantiate'}
                            </button>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    <!-- SQL Console -->
    <div class="sql-console fn__flex-1 fn__flex-column" style="border-top: 2px solid var(--b3-border-color); padding-top: 20px; min-height: 0;">
        <div class="fn__flex" style="gap: 12px; margin-bottom: 12px; align-items: flex-end;">
            <div class="fn__flex-1">
                <input class="b3-text-field fn__block" bind:value={sqlInput} on:keydown={(e) => e.key === 'Enter' && executeSQL()} placeholder="SELECT * FROM avID" />
            </div>
            <button class="b3-button" on:click={executeSQL} style="height: 32px;">Execute</button>
        </div>

        {#if queryError}
            <div style="color: #f87171; font-size: 12px; padding: 10px; background: rgba(239, 68, 68, 0.1); border-radius: 4px; margin-bottom: 10px;">{queryError}</div>
        {/if}

        <div class="result-viewer fn__flex-1" style="overflow: auto; border: 1px solid var(--b3-border-color); border-radius: 4px; background: #1e1e1e; color: #d4d4d4;">
            {#if queryResult}
                <table style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: monospace;">
                    <thead style="background: #333; position: sticky; top: 0;">
                        <tr>
                            {#each queryResult.columns as col}
                                <th style="padding: 8px; text-align: left; border-right: 1px solid #444; color: #9cdcfe;">{col}</th>
                            {/each}
                        </tr>
                    </thead>
                    <tbody>
                        {#each queryResult.values as row}
                            <tr style="border-bottom: 1px solid #333;">
                                {#each row as val}
                                    <td style="padding: 8px; border-right: 1px solid #333;">{val === null ? 'NULL' : val}</td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            {:else}
                <div style="height: 100%; display: flex; align-items: center; justify-content: center; opacity: 0.3;">
                    Ready for Query.
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    tr:hover { background-color: var(--b3-theme-background-hover); }
</style>
