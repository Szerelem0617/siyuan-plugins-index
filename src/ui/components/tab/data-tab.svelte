<script lang="ts">
    import SettingItem from "../setting-item.svelte";

    export let tabbarfocus: string;
    export let settingsStrings: any;

    const addTemplateContent = {
        title: "添加模板列",
        content: "是否自动添加 title-img、template 列"
    };
</script>

<div class={tabbarfocus === "data" ? "" : "fn__none"}>
    <SettingItem 
        content={addTemplateContent}
        type="switch"
        settingKey="dbAddTemplateCols"
        bind:settingValue={settingsStrings.dbAddTemplateCols}
    />
</div>
