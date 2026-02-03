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
    <div class="fn__hr"></div>
    <div style="padding: 10px; color: var(--b3-theme-on-surface-light); line-height: 1.6; font-size: 0.9em;">
        {i18n.settingsTab.items.builderDesc}
    </div>
</div>