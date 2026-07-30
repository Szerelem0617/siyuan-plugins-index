<script lang="ts">
    import { onMount } from "svelte";
    import { client } from "../../../shared/api-client";
    import { i18n } from "../../../shared/utils";
    import SettingItem from "../setting-item.svelte";
    import { settings } from "../../../core/settings";
    import { openIndexDropdown } from "../index-dropdown";

    export let onSave = function () {};

    let notebooks = [];
    let toNotebookId: any;
    // let toNotebookName: any;

    // 用户指南不应该作为可以写入的笔记本
    const hiddenNotebook: Set<string> = new Set([
        "思源笔记用户指南",
        "SiYuan User Guide",
    ]);

    // const notebookChange = async function () {
    //     // 显示当前选择的名称
    //     const currentNotebook = notebooks.find((n) => n.id === toNotebookId);
    //     toNotebookName = currentNotebook.name;

    //     importerConfig = await loadImporterConfig(pluginInstance);
    //     importerConfig.notebook = toNotebookId;

    //     await saveImporterConfig(pluginInstance, importerConfig);
    //     pluginInstance.logger.info(
    //         `${pluginInstance.i18n.notebookConfigUpdated}=>`,
    //         toNotebookId,
    //     );
    // };

    $: dropdownOptions = notebooks.map(n => ({ value: n.id, label: n.name }));
    $: selectedLabel = dropdownOptions.find(o => o.value === toNotebookId)?.label || (notebooks.length > 0 ? "" : i18n.loading + "...");

    onMount(async () => {
        const res = await client.lsNotebooks();
        console.log(res);
        const data = res.data as any;
        notebooks = data.notebooks ?? [];
        // 没有必要把所有笔记本都列出来
        notebooks = notebooks.filter(
            (notebook) =>
                !notebook.closed && !hiddenNotebook.has(notebook.name),
        );
        toNotebookId = notebooks[0].id;
        // 选中，若是没保存，获取第一个
        // toNotebookId = importerConfig?.notebook ?? notebooks[0].id;
        // const currentNotebook = notebooks.find((n) => n.id === toNotebookId);
        // toNotebookName = currentNotebook.name;
    });
</script>

<label class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        <label class="fn__flex b3-label config__item">
            <div class="fn__flex-1">
                {@html i18n.settingsTab.items.notebookDialog.title}
                <div class="b3-label__text">
                    {@html i18n.settingsTab.items.notebookDialog.content}
                </div>
            </div>
            <span class="fn__space" />
            <button
                id="notebook-get"
                class="b3-select fn__flex-center fn__size200 fn__flex"
                style="align-items: center; justify-content: space-between; height: 28px; padding: 4px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer; transition: all 0.15s ease;"
                on:click={(e) => openIndexDropdown({
                    event: e,
                    options: dropdownOptions,
                    selectedValue: toNotebookId,
                    onSelect: (val) => {
                        toNotebookId = val;
                    }
                })}
            >
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    {selectedLabel}
                </span>
                <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.5; flex-shrink: 0; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
            </button>
        </label>
        <SettingItem
            type="range"
            content={i18n.settingsTab.items.depth}
            settingKey="depthNotebook"
            settingValue={settings.get("depthNotebook")}
        />
        <SettingItem
            type="select"
            content={i18n.settingsTab.items.listType}
            settingKey="listTypeNotebook"
            settingValue={settings.get("listTypeNotebook")}
        />
        <SettingItem
            type="select"
            content={i18n.settingsTab.items.linkType}
            settingKey="linkTypeNotebook"
            settingValue={settings.get("linkTypeNotebook")}
        />
        <SettingItem
            type="switch"
            content={i18n.settingsTab.items.icon}
            settingKey="iconNotebook"
            settingValue={settings.get("iconNotebook")}
        />
    </div>
</label>

<div class="button-group" style="float: right;margin: 20px 0 10px;">
    <button id="saveDraw" class="b3-button" on:click={onSave}>
        {i18n.settingsTab.items.notebookDialog.insert}
    </button>
</div>
