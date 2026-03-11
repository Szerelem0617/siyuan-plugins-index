<script lang="ts">
    import { onMount } from "svelte";
    import { getGlobalTypeConfigs } from "./db-config";
    import { type TypeConfig } from "./types";
    import { i18n } from "../../../shared/utils";
    import { supertagMonitor } from "./supertag";

    export let dialog: any;
    export let supertagManager: any;

    let supertags: TypeConfig[] = [];
    let loading = true;

    interface TagGroup {
        typeName: string;
        configs: TypeConfig[];
        selectedAvId: string;
    }
    let groupedTags: TagGroup[] = [];

    onMount(async () => {
        supertags = await getGlobalTypeConfigs();

        // Group them
        const map = new Map<string, TypeConfig[]>();
        for (const t of supertags) {
            if (!map.has(t.typeName)) map.set(t.typeName, []);
            map.get(t.typeName)!.push(t);
        }

        const groups: TagGroup[] = [];
        for (const [typeName, configs] of map.entries()) {
            const pref = supertagMonitor.getPreferredConfig(typeName);
            groups.push({
                typeName,
                configs,
                selectedAvId: pref || configs[0].avId,
            });
        }
        groups.sort((a, b) => a.typeName.localeCompare(b.typeName));
        groupedTags = groups;
        loading = false;
    });

    async function handlePrefChange(typeName: string, avId: string) {
        await supertagMonitor.setPreferredConfig(typeName, avId);
    }

    async function handleConfigureTemplate(group: TagGroup) {
        const config =
            group.configs.find((c) => c.avId === group.selectedAvId) ||
            group.configs[0];
        console.log("Configuring template for:", config);
        await supertagManager.configureTemplate(config);
        dialog.destroy();
    }
</script>

<div
    class="fn__flex-1 fn__flex-column"
    style="height: 100%; display: flex; flex-direction: column;"
>
    <div
        class="b3-dialog__content fn__flex-1"
        style="padding: 16px; overflow-y: auto;"
    >
        {#if loading}
            <div class="fn__flex-center" style="height: 100px;">
                <span class="loading fn__flex-center">
                    <svg class="fn__rotate" style="width: 24px; height: 24px;"
                        ><use xlink:href="#iconRefresh"></use></svg
                    >
                </span>
            </div>
        {:else if supertags.length === 0}
            <div
                class="fn__flex-column fn__flex-center"
                style="height: 200px; color: var(--b3-theme-on-surface-light);"
            >
                <svg
                    style="width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5;"
                    ><use xlink:href="#iconTags"></use></svg
                >
                <p>{i18n.supertagManager.noTags}</p>
                <p style="font-size: 0.9em; opacity: 0.8;">
                    {i18n.supertagManager.noTagsHint}
                </p>
            </div>
        {:else}
            <div class="b3-list b3-list--background">
                <div
                    class="b3-list-item b3-list-item--hide-action"
                    style="cursor: default; pointer-events: none; background: transparent;"
                >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6;"
                        >{i18n.supertagManager.tagName}</span
                    >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6; flex: 1.5;"
                        >{i18n.supertagManager.targetDB}</span
                    >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6; text-align: right;"
                        >{i18n.supertagManager.actions}</span
                    >
                </div>

                {#each groupedTags as group}
                    <div class="b3-list-item">
                        <svg
                            class="b3-list-item__graphic"
                            style="color: var(--b3-theme-primary);"
                            ><use xlink:href="#iconTags"></use></svg
                        >
                        <span
                            class="b3-list-item__text"
                            style="font-weight: bold; flex: 1; margin-right: 8px;"
                        >
                            #{group.typeName}#
                            {#if group.configs.length > 1}
                                <span
                                    class="b3-chip b3-chip--warning b3-chip--small"
                                    style="margin-left: 4px; border: 1px solid var(--b3-theme-warning);"
                                    >重名</span
                                >
                            {/if}
                        </span>

                        <div class="b3-list-item__text" style="flex: 1.5;">
                            {#if group.configs.length > 1}
                                <select
                                    class="b3-select fn__block"
                                    style="width: 100%; max-width: 200px; padding: 0 4px; height: 24px; line-height: 24px;"
                                    bind:value={group.selectedAvId}
                                    on:change={() =>
                                        handlePrefChange(
                                            group.typeName,
                                            group.selectedAvId,
                                        )}
                                >
                                    {#each group.configs as cfg}
                                        <option value={cfg.avId}
                                            >{cfg.avName ||
                                                "ID: " +
                                                    cfg.avId.substring(0, 8) +
                                                    "..."}</option
                                        >
                                    {/each}
                                </select>
                            {:else}
                                <span
                                    style="opacity: 0.7; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                                >
                                    {group.configs[0].avName ||
                                        "ID: " +
                                            group.configs[0].avId.substring(
                                                0,
                                                8,
                                            ) +
                                            "..."}
                                </span>
                            {/if}
                        </div>

                        <div class="fn__flex">
                            <button
                                class="b3-button b3-button--outline b3-button--small fn__flex-center"
                                on:click={() => handleConfigureTemplate(group)}
                                style="margin-left: 8px; white-space: nowrap;"
                            >
                                <svg
                                    style="width: 14px; height: 14px; margin-right: 4px;"
                                    ><use xlink:href="#iconLayout"></use></svg
                                >
                                {i18n.supertagManager.configTemplate}
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <div class="b3-dialog__action">
        <button
            class="b3-button b3-button--cancel"
            on:click={() => dialog.destroy()}
        >
            {i18n.confirm}
        </button>
    </div>
</div>

<style>
    .b3-list-item {
        padding: 8px 12px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--b3-border-color);
    }
    .b3-list-item:last-child {
        border-bottom: none;
    }
    .b3-list-item__text {
        flex: 1;
        margin-right: 12px;
    }
</style>
