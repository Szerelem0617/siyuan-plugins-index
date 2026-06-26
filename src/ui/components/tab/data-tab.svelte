<script lang="ts">
    import SettingItem from "../setting-item.svelte";
    import { i18n } from "../../../shared/utils";
    import { DEV_ENABLE_INIT_SYS } from "../../../features/command/registration";

    export let tabbarfocus: string;
    export let settingsStrings: any;

    const addTemplateContent = {
        title: i18n.settingsTab.items.dbAddTemplateCols.title,
        content: i18n.settingsTab.items.dbAddTemplateCols.content,
    };

    const devModeContent = {
        title: i18n.settingsTab.items.devMode.title,
        content: i18n.settingsTab.items.devMode.content,
    };
</script>

<div class={tabbarfocus === "data" ? "" : "fn__none"}>
    <div
        style="padding: 12px; border-radius: 4px; background-color: var(--b3-theme-surface-lighter); color: var(--b3-theme-on-surface-light); line-height: 1.6; margin-bottom: 24px; border: 1px solid var(--b3-border-color); white-space: pre-wrap;"
    >
        {i18n.dataMenu.warning}
    </div>

    <SettingItem
        content={addTemplateContent}
        type="switch"
        settingKey="dbAddTemplateCols"
        bind:settingValue={settingsStrings.dbAddTemplateCols}
    />

    {#if DEV_ENABLE_INIT_SYS}
        <SettingItem
            content={devModeContent}
            type="switch"
            settingKey="devMode"
            bind:settingValue={settingsStrings.devMode}
        />
    {/if}
</div>
