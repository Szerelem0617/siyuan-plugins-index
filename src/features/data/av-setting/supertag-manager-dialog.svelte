<script lang="ts">
    import { onMount } from "svelte";
    import { getGlobalTypeConfigs } from "./db-config";
    import { type TypeConfig } from "./types";
    import { i18n } from "../../../shared/utils";

    export let dialog: any;
    export let supertagManager: any;

    let supertags: TypeConfig[] = [];
    let loading = true;

    onMount(async () => {
        supertags = await getGlobalTypeConfigs();
        loading = false;
    });

    async function handleConfigureTemplate(tag: TypeConfig) {
        console.log("Configuring template for:", tag);
        await supertagManager.configureTemplate(tag);
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

                {#each supertags as tag}
                    <div class="b3-list-item">
                        <svg
                            class="b3-list-item__graphic"
                            style="color: var(--b3-theme-primary);"
                            ><use xlink:href="#iconTags"></use></svg
                        >
                        <span
                            class="b3-list-item__text"
                            style="font-weight: bold;"
                        >
                            #{tag.typeName}#
                        </span>

                        <span
                            class="b3-list-item__text"
                            style="opacity: 0.7; font-size: 0.9em; flex: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                        >
                            ID: {tag.avId.substring(0, 8)}...
                        </span>

                        <div class="fn__flex">
                            <button
                                class="b3-button b3-button--outline b3-button--small fn__flex-center"
                                on:click={() => handleConfigureTemplate(tag)}
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
