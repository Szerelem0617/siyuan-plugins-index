<script lang="ts">
    import { SettingsProperty } from "../../../core/settings";
    import { i18n } from "../../../shared/utils";
    import SettingItem from "../setting-item.svelte";

    export let tabbarfocus : any;
    export let settingsStrings : SettingsProperty;
</script>

<div
data-name="builder"
class={tabbarfocus === "builder"
    ? "config__tab-container"
    : "config__tab-container fn__none"}
>
    <SettingItem
        type="switch"
        content={i18n.settingsTab.items.builderAutoUpdate}
        settingKey="builderAutoUpdate"
        settingValue={settingsStrings.builderAutoUpdate}
    />
</div>