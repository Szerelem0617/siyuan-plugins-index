<script lang="ts">
    import SettingItem from "../setting-item.svelte";
    import { i18n } from "../../../shared/utils";
    import { openSelfTestDialog } from "../../../features/self-test";

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

    <SettingItem
        content={devModeContent}
        type="switch"
        settingKey="devMode"
        bind:settingValue={settingsStrings.devMode}
    />

    {#if settingsStrings.devMode}
        <div style="margin-top: 16px; padding: 12px; border-radius: 6px; background: var(--b3-theme-surface); border: 1px dashed var(--b3-border-color);">
            <div style="font-size: 12px; font-weight: 700; margin-bottom: 4px; color: var(--b3-theme-on-surface);">🧪 核心功能自检诊断</div>
            <div style="font-size: 11px; opacity: 0.7; margin-bottom: 10px; line-height: 1.5;">一键自动化运行 Supertag Base32 编解码、标签 Diff、条件表达式求值与运行时 API 沙箱落盘测试。</div>
            <button
                class="b3-button b3-button--outline"
                style="width: 100%; font-size: 12px; padding: 6px;"
                on:click={() => openSelfTestDialog()}
            >
                🚀 运行核心自检诊断
            </button>
        </div>
    {/if}
</div>
