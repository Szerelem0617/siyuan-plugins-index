<script lang="ts">
    import { onMount } from "svelte";
    import { getSqliteStatus } from "./sqlite-manager";

    let status: any = null;
    let loading = true;

    async function checkStatus() {
        loading = true;
        status = await getSqliteStatus();
        loading = false;
    }

    onMount(() => {
        checkStatus();
    });
</script>

<div class="sqlite-status-panel fn__flex-column fn__flex-1" style="padding: 24px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); font-family: var(--b3-font-family); min-height: 100%;">
    <div class="fn__flex" style="align-items: center; margin-bottom: 24px;">
        <h1 style="font-size: 24px; margin: 0; flex: 1; font-weight: 600;">SQLite WASM Status</h1>
        <button class="b3-button b3-button--text" on:click={checkStatus} disabled={loading}>
            {loading ? "Checking..." : "Refresh Status"}
        </button>
    </div>

    {#if loading}
        <div class="loading-state fn__flex-column" style="align-items: center; justify-content: center; min-height: 200px;">
            <div class="fn__loading" style="width: 48px; height: 48px; border-width: 4px;"></div>
            <p style="margin-top: 16px; opacity: 0.7;">Detecting SQLite engine...</p>
        </div>
    {:else if status}
        <div class="status-result b3-card" style="padding: 24px; border-radius: 12px; border: 1px solid var(--b3-border-color); background: var(--b3-theme-surface);">
            <div class="fn__flex" style="align-items: center; margin-bottom: 16px;">
                <div class="status-indicator" style="width: 12px; height: 12px; border-radius: 50%; background: {status.status === 'success' ? '#10b981' : '#ef4444'}; margin-right: 12px;"></div>
                <span style="font-size: 18px; font-weight: 600;">{status.status === 'success' ? 'Engine Ready' : 'Engine Error'}</span>
            </div>

            <div class="details-list" style="display: grid; grid-template-columns: auto 1fr; gap: 12px 24px;">
                <span style="opacity: 0.6;">Message:</span>
                <span>{status.message}</span>

                {#if status.status === 'success'}
                    <span style="opacity: 0.6;">Init Time:</span>
                    <span>{status.loadTime}</span>
                    
                    <span style="opacity: 0.6;">Version:</span>
                    <code>{status.version}</code>
                {/if}
            </div>

            {#if status.status !== 'success'}
                <div style="margin-top: 24px; padding: 16px; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171;">
                    <strong>Tip:</strong> Make sure you have installed the dependency via <code style="padding: 2px 4px; background: rgba(0,0,0,0.1); border-radius: 4px;">pnpm install</code>. If you are using dynamic loading from a CDN, ensure you have an active internet connection.
                </div>
            {/if}
        </div>
    {/if}

    <div style="margin-top: 40px; border-top: 1px solid var(--b3-border-color); padding-top: 24px;">
        <h2 style="font-size: 18px; margin-bottom: 12px; font-weight: 600;">Why SQLite?</h2>
        <p style="opacity: 0.8; line-height: 1.6;">
            We are introducing SQLite (WASM) to enable advanced querying capabilities for your command tree. 
            This allows us to process thousands of commands with sub-millisecond search latency, 
            directly in the browser environment without impacting SiYuan's native performance.
        </p>
    </div>
</div>

<style>
    .b3-card {
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        transition: transform 0.2s, box-shadow 0.2s;
    }
    .b3-card:hover {
        box-shadow: 0 6px 16px rgba(0,0,0,0.1);
    }
</style>
