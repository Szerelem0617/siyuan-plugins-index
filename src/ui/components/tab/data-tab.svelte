<script lang="ts">
    import SettingItem from "../setting-item.svelte";

    export let tabbarfocus: string;
    export let settingsStrings: any;

    const focusLevelContent = {
        title: "自动聚焦层级",
        content: "创建数据库后默认显示的层级深度",
        options: {
            "0": "不自动聚焦 (0)",
            "1": "层级 1",
            "2": "层级 2",
            "3": "层级 3",
            "4": "层级 4",
            "5": "层级 5",
            "6": "层级 6",
            "7": "层级 7"
        }
    };

    const addTemplateContent = {
        title: "添加模板列",
        content: "是否自动添加 icon、title-img、template 列"
    };
</script>

<div class={tabbarfocus === "data" ? "" : "fn__none"}>
    <SettingItem 
        content={focusLevelContent}
        type="select"
        settingKey="dbFocusLevel"
        bind:settingValue={settingsStrings.dbFocusLevel}
    />

    <SettingItem 
        content={addTemplateContent}
        type="switch"
        settingKey="dbAddTemplateCols"
        bind:settingValue={settingsStrings.dbAddTemplateCols}
    />
</div>
