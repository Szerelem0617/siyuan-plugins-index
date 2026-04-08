<script lang="ts">
    import { onMount } from "svelte";
    import { fetchAllAVBlocks } from "./sqlite-data-fetcher";

    let avBlocks: any[] = [];
    let loading = true;
    let error = "";

    async function refresh() {
        loading = true;
        error = "";
        try {
            avBlocks = await fetchAllAVBlocks();
        } catch (e) {
            error = e.message;
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        refresh();
    });

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text);
        // Simple visual feedback could be added here
    }
</script>

<div class="av-explorer-panel fn__flex-column fn__flex-1" style="padding: 20px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); font-family: var(--b3-font-family); height: 100%; overflow: hidden;">
    <div class="fn__flex" style="align-items: center; margin-bottom: 20px; flex-shrink: 0;">
        <h1 style="font-size: 20px; margin: 0; flex: 1; font-weight: 600;">Attribute View (AV) Explorer</h1>
        <button class="b3-button b3-button--outline" on:click={refresh} disabled={loading} style="padding: 4px 12px;">
            {loading ? "Scanning..." : "Refetch Blocks"}
        </button>
    </div>

    {#if loading}
        <div class="loading-state fn__flex-column fn__flex-1" style="align-items: center; justify-content: center;">
            <div class="fn__loading" style="width: 40px; height: 40px; border-width: 3px;"></div>
            <p style="margin-top: 12px; opacity: 0.6;">Scanning workspace for AV blocks...</p>
        </div>
    {:else if error}
        <div class="error-state b3-card" style="padding: 20px; color: var(--b3-theme-error);">
            <p>Error: {error}</p>
        </div>
    {:else}
        <div class="table-container fn__flex-1" style="overflow-y: auto; border: 1px solid var(--b3-border-color); border-radius: 8px; background: var(--b3-theme-surface);">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead style="position: sticky; top: 0; background: var(--b3-border-color); color: var(--b3-theme-on-surface); z-index: 10;">
                    <tr>
                        <th style="padding: 10px; text-align: left; width: 40%;">Block ID (Physical)</th>
                        <th style="padding: 10px; text-align: left; width: 40%;">AV ID (Logical)</th>
                        <th style="padding: 10px; text-align: center; width: 20%;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {#each avBlocks as block}
                        <tr style="border-bottom: 1px solid var(--b3-border-color); hover: background: rgba(0,0,0,0.02);">
                            <td style="padding: 10px; font-family: monospace;">
                                {block.blockId}
                            </td>
                            <td style="padding: 10px;">
                                <span style="font-family: monospace; color: {block.avId === 'Not Found' ? 'var(--b3-theme-error)' : 'inherit'}">
                                    {block.avId}
                                </span>
                            </td>
                            <td style="padding: 10px; text-align: center;">
                                <button class="b3-button b3-button--text" style="font-size: 11px;" on:click={() => copyToClipboard(block.avId)}>Copy AV</button>
                            </td>
                        </tr>
                    {/each}
                    {#if avBlocks.length === 0}
                        <tr>
                            <td colspan="3" style="padding: 40px; text-align: center; opacity: 0.5;">No Attribute View blocks found in current notebook.</td>
                        </tr>
                    {/if}
                </tbody>
            </table>
        </div>
    {/if}

    <div style="margin-top: 16px; font-size: 12px; opacity: 0.5; flex-shrink: 0;">
        Tip: Physical Block ID is the node container, Logical AV ID is the actual configuration ID used for AV APIs.
    </div>
</div>

<style>
    tr:hover {
        background-color: var(--b3-theme-background-hover);
    }
    th {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
</style>
