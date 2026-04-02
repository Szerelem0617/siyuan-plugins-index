<script lang="ts">
    import { SettingsProperty } from "../../../core/settings";
    import { i18n } from "../../../shared/utils";
    import SettingItem from "../setting-item.svelte";

    export let tabbarfocus: any;
    export let settingsStrings: SettingsProperty;
</script>

<div
    data-name="index"
    class={tabbarfocus === "index"
        ? "config__tab-container"
        : "config__tab-container fn__none"}
>
    <SettingItem
        type="select"
        content={i18n.settingsTab.items.listType}
        settingKey="listType"
        settingValue={settingsStrings.listType}
    />
    <SettingItem
        type="select"
        content={i18n.settingsTab.items.linkType}
        settingKey="linkType"
        settingValue={settingsStrings.linkType}
    />
    <SettingItem
        type="switch"
        content={i18n.settingsTab.items.icon}
        settingKey="icon"
        settingValue={settingsStrings.icon}
    />
    <SettingItem
        type="range"
        content={i18n.settingsTab.items.depth}
        settingKey="depth"
        settingValue={settingsStrings.depth}
    />
    <SettingItem
        type="range"
        content={i18n.settingsTab.items.fold}
        settingKey="fold"
        settingValue={settingsStrings.fold}
    />
    <SettingItem
        type="range"
        content={i18n.settingsTab.items.col}
        settingKey="col"
        settingValue={settingsStrings.col}
    />

    <SettingItem
        type="switch"
        content={i18n.settingsTab.items.autoUpdate}
        settingKey="autoUpdate"
        settingValue={settingsStrings.autoUpdate}
    />
</div>
