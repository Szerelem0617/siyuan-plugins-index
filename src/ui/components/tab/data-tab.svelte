<script lang="ts">
    import SettingItem from "../setting-item.svelte";
    import { i18n } from "../../../shared/utils";

    export let tabbarfocus: string;
    export let settingsStrings: any;

    const addTemplateContent = {
        title: "添加模板列",
        content: "是否自动添加 title-img、template 列",
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
</div>
