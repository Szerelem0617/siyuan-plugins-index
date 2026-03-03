<script lang="ts">
    import { SettingsProperty } from "../../../core/settings";
    import { i18n } from "../../../shared/utils";
    import SettingItem from "../setting-item.svelte";

    export let tabbarfocus: any;
    export let settingsStrings: SettingsProperty;

    // Hotfix: Forcefully inject the 'tree' option if the global SiYuan API translation cache hasn't loaded it.
    if (
        i18n &&
        i18n.settingsTab &&
        i18n.settingsTab.items &&
        i18n.settingsTab.items.outlineType
    ) {
        if (
            !i18n.settingsTab.items.outlineType.options.tree ||
            i18n.settingsTab.items.outlineType.options.tree === "静态树"
        ) {
            i18n.settingsTab.items.outlineType.options.tree = "标题行树";
        }
    }
</script>

<div
    data-name="outline"
    class={tabbarfocus === "outline"
        ? "config__tab-container"
        : "config__tab-container fn__none"}
>
    <SettingItem
        type="select"
        content={i18n.settingsTab.items.listTypeOutline}
        settingKey="listTypeOutline"
        settingValue={settingsStrings.listTypeOutline}
    />
    <SettingItem
        type="select"
        content={i18n.settingsTab.items.outlineType}
        settingKey="outlineType"
        settingValue={settingsStrings.outlineType}
    />
    <SettingItem
        type="switch"
        content={i18n.settingsTab.items.iconOutline}
        settingKey="iconOutline"
        settingValue={settingsStrings.iconOutline}
    />
    <SettingItem
        type="switch"
        content={i18n.settingsTab.items.outlineAutoUpdate}
        settingKey="outlineAutoUpdate"
        settingValue={settingsStrings.outlineAutoUpdate}
    />
</div>
