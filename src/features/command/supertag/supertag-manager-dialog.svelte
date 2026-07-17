<script lang="ts">
    import { onMount } from "svelte";
    import { getGlobalTypeConfigs, loadDbConfig, saveDbConfig } from "../../data/av-setting/db-config";
    import { type TypeConfig } from "../../data/av-setting/types";
    import { i18n } from "../../../shared/utils";
    import { supertagMonitor } from "./supertag";
    import { showMessage } from "siyuan";
    import {
        SUPERTAG_REGISTRY,
        type SupertagCommand,
    } from "../registration";

    export let dialog: any;
    export let supertagManager: any;

    let loading = true;
    let activeTab: "data" | "tool" | "class" = "class";

    interface TagGroup {
        typeName: string;
        dataConfigs: TypeConfig[];
        logicConfigs: SupertagCommand[];
        selectedAvId: string;
    }

    let dataComponents: TagGroup[] = [];
    let toolComponents: TagGroup[] = [];
    let classes: TagGroup[] = [];

    onMount(async () => {
        // 1. Fetch Data from Layer 4 (Scanning)
        const scannedData = await getGlobalTypeConfigs();

        // 2. Fetch Logic from Layer 3 (Registry)
        const logicData = SUPERTAG_REGISTRY;

        // Grouping logic
        const allTagNames = new Set([
            ...scannedData.map((d) => d.typeName.toLowerCase()),
            ...logicData.map((l) => l.typeTag.toLowerCase()),
        ]);

        const dataMap = new Map<string, TypeConfig[]>();
        scannedData.forEach((d) => {
            const name = d.typeName.toLowerCase();
            if (!dataMap.has(name)) dataMap.set(name, []);
            dataMap.get(name)!.push(d);
        });

        const logicMap = new Map<string, SupertagCommand[]>();
        logicData.forEach((l) => {
            const name = l.typeTag.toLowerCase();
            if (!logicMap.has(name)) logicMap.set(name, []);
            logicMap.get(name)!.push(l);
        });

        const tempClasses: TagGroup[] = [];
        const tempDataComp: TagGroup[] = [];
        const tempToolComp: TagGroup[] = [];

        allTagNames.forEach((name) => {
            const hasData = dataMap.has(name);
            const hasLogic = logicMap.has(name);
            const pref = supertagMonitor.getPreferredConfig(name);

            const group: TagGroup = {
                typeName: name,
                dataConfigs: dataMap.get(name) || [],
                logicConfigs: logicMap.get(name) || [],
                selectedAvId: pref || dataMap.get(name)?.[0]?.avId || "",
            };

            if (hasData && hasLogic) {
                tempClasses.push(group);
            } else if (hasData) {
                tempDataComp.push(group);
            } else if (hasLogic) {
                tempToolComp.push(group);
            }
        });

        const sorter = (a: TagGroup, b: TagGroup) =>
            a.typeName.localeCompare(b.typeName);
        classes = tempClasses.sort(sorter);
        dataComponents = tempDataComp.sort(sorter);
        toolComponents = tempToolComp.sort(sorter);

        loading = false;
    });

    async function handlePrefChange(typeName: string, avId: string) {
        await supertagMonitor.setPreferredConfig(typeName, avId);
    }

    async function handleToggleEnable(group: TagGroup, checked: boolean) {
        const activeConfig = group.dataConfigs.find(c => c.avId === group.selectedAvId) || group.dataConfigs[0];
        if (!activeConfig) return;

        try {
            // 1. Load existing DbConfig
            const config = await loadDbConfig(activeConfig.blockId);
            
            // 2. Set the new value
            config.enableSupertag = checked;
            
            // 3. Save it back to block IAL
            await saveDbConfig(activeConfig.blockId, config);

            // 4. Update Svelte local state so UI updates
            activeConfig.enableSupertag = checked;
            
            // Trigger Svelte arrays updates
            classes = [...classes];
            dataComponents = [...dataComponents];
            toolComponents = [...toolComponents];

            // 5. Refresh Monitor Registry in memory
            await supertagMonitor.refreshRegistry();

            showMessage(checked ? `✓ 超级标签 #${group.typeName} 已启用` : `✗ 超级标签 #${group.typeName} 已禁用`);
        } catch (e: any) {
            console.error("Failed to toggle supertag state:", e);
            showMessage(`保存配置失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function handleConfigureTemplate(group: TagGroup) {
        const config =
            group.dataConfigs.find((c) => c.avId === group.selectedAvId) ||
            group.dataConfigs[0];
        if (config) {
            console.log("Configuring template for:", config);
            await supertagManager.configureTemplate(config);
            dialog.destroy();
        }
    }

    $: currentList =
        activeTab === "class"
            ? classes
            : activeTab === "data"
              ? dataComponents
              : toolComponents;
</script>

<div
    class="fn__flex-1 fn__flex-column"
    style="height: 100%; display: flex; flex-direction: column;"
>
    <!-- Tabs Header -->
    <div
        class="layout-tab-bar fn__flex"
        style="flex-shrink: 0; padding: 0 16px; border-bottom: 1px solid var(--b3-border-color); align-items: center; justify-content: space-between;"
    >
        <div class="fn__flex">
            <div
                class="item {activeTab === 'data' ? 'item--focus' : ''}"
                role="tab"
                tabindex="0"
                on:click={() => (activeTab = "data")}
                on:keydown={(e) => e.key === 'Enter' && (activeTab = "data")}
            >
                <span class="item__text">数据组件</span>
                <span
                    class="b3-chip b3-chip--small"
                    style="margin-left: 4px; opacity: 0.6;"
                    >{dataComponents.length}</span
                >
            </div>
            <div
                class="item {activeTab === 'tool' ? 'item--focus' : ''}"
                role="tab"
                tabindex="0"
                on:click={() => (activeTab = "tool")}
                on:keydown={(e) => e.key === 'Enter' && (activeTab = "tool")}
            >
                <span class="item__text">工具组件</span>
                <span
                    class="b3-chip b3-chip--small"
                    style="margin-left: 4px; opacity: 0.6;"
                    >{toolComponents.length}</span
                >
            </div>
            <div
                class="item {activeTab === 'class' ? 'item--focus' : ''}"
                role="tab"
                tabindex="0"
                on:click={() => (activeTab = "class")}
                on:keydown={(e) => e.key === 'Enter' && (activeTab = "class")}
            >
                <span class="item__text">类 (Class)</span>
                <span
                    class="b3-chip b3-chip--small"
                    style="margin-left: 4px; opacity: 0.6;">{classes.length}</span
                >
            </div>
        </div>
    </div>

    <div
        class="b3-dialog__content fn__flex-1"
        style="padding: 16px; overflow-y: auto;"
    >
        {#if loading}
            <div class="fn__flex-center" style="height: 100px;">
                <span class="loading fn__flex-center">
                    <svg class="fn__rotate" style="width: 24px; height: 24px;"
                        ><use xlink:href="#iconRefresh"></use></svg
                    >
                </span>
            </div>
        {:else if currentList.length === 0}
            <div
                class="fn__flex-column fn__flex-center"
                style="height: 200px; color: var(--b3-theme-on-surface-light);"
            >
                <svg
                    style="width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5;"
                    ><use xlink:href="#iconTags"></use></svg
                >
                <p>该分类下暂无内容</p>
                <p style="font-size: 0.9em; opacity: 0.6;">
                    {#if activeTab === "data"}
                        在属性视图右上角配置“数据组件”即可在此显示
                    {:else if activeTab === "tool"}
                        在 Type-DB 中手动添加逻辑条目即可在此显示
                    {:else}
                        当“数据组件”与“工具组件”具有相同标签名时，将自动升级为“类”
                    {/if}
                </p>
            </div>
        {:else}
            <div class="b3-list b3-list--background">
                <!-- Header row -->
                <div
                    class="b3-list-item b3-list-item--hide-action"
                    style="cursor: default; pointer-events: none; background: transparent; padding: 4px 12px;"
                >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6; flex: 1.2;"
                        >标签 (Type)</span
                    >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6; flex: 3.5;"
                        >绑定详情 (Storage / Logic)</span
                    >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6; flex: 1.0; text-align: right;"
                        >启用状态</span
                    >
                </div>

                {#each currentList as group}
                    {@const activeConfig = group.dataConfigs.find(c => c.avId === group.selectedAvId) || group.dataConfigs[0]}
                    {@const isEnabled = group.dataConfigs.length === 0 || (activeConfig ? activeConfig.enableSupertag !== false : true)}
                    <div class="b3-list-item">
                        <svg
                            class="b3-list-item__graphic"
                            style="color: var(--b3-theme-primary);"
                            ><use xlink:href="#iconTags"></use></svg
                        >

                        <!-- Tag Name Column -->
                        <span
                            class="b3-list-item__text"
                            style="font-weight: bold; flex: 1.2;"
                        >
                            {group.typeName}
                        </span>

                        <!-- Details Column -->
                        <div
                            class="b3-list-item__text fn__flex-column"
                            style="flex: 3.5; gap: 4px;"
                        >
                            {#if group.dataConfigs.length > 0}
                                <div
                                    class="fn__flex"
                                    style="align-items: center;"
                                >
                                    <svg
                                        style="width: 12px; height: 12px; margin-right: 4px; opacity: 0.5;"
                                        ><use xlink:href="#iconDatabase"
                                        ></use></svg
                                    >
                                    {#if group.dataConfigs.length > 1}
                                        <select
                                            class="b3-select"
                                            style="max-width: 180px; height: 22px; padding: 0 4px; font-size: 11px;"
                                            bind:value={group.selectedAvId}
                                            on:change={() =>
                                                handlePrefChange(
                                                    group.typeName,
                                                    group.selectedAvId,
                                                )}
                                        >
                                            {#each group.dataConfigs as cfg}
                                                <option value={cfg.avId}
                                                    >{cfg.avName ||
                                                        "DB: " +
                                                            cfg.avId.substring(
                                                                0,
                                                                6,
                                                            )}</option
                                                >
                                            {/each}
                                        </select>
                                        <span
                                            class="b3-chip b3-chip--warning b3-chip--small"
                                            style="margin-left:4px;">重名</span
                                        >
                                    {:else}
                                        <span
                                            style="font-size: 12px; opacity: 0.8;"
                                            >{group.dataConfigs[0].avName ||
                                                "DB: " +
                                                    group.dataConfigs[0].avId.substring(
                                                        0,
                                                        8,
                                                    )}</span
                                        >
                                    {/if}
                                </div>
                            {/if}

                            {#if group.logicConfigs.length > 0}
                                <div
                                    class="fn__flex"
                                    style="align-items: center; flex-wrap: wrap; gap: 4px;"
                                >
                                    <svg
                                        style="width: 12px; height: 12px; margin-right: 4px; opacity: 0.5;"
                                        ><use xlink:href="#iconPlay"></use></svg
                                    >
                                    {#each group.logicConfigs as logic}
                                        <span
                                            class="b3-chip b3-chip--small"
                                            style="font-size: 10px; background-color: var(--b3-theme-surface-lighter);"
                                        >
                                            {logic.methodName ||
                                                logic.commandRef}
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                        </div>

                        <!-- Status Column -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 1.0; justify-content: flex-end; align-items: center;"
                        >
                            {#if group.dataConfigs.length > 0}
                                <label class="fn__flex" style="align-items: center; cursor: pointer;">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        checked={isEnabled}
                                        on:change={(e) => handleToggleEnable(group, e.target.checked)}
                                    />
                                </label>
                            {:else}
                                <span style="font-size: 11px; opacity: 0.5; margin-right: 4px;">内置逻辑</span>
                                <label class="fn__flex" style="align-items: center; cursor: not-allowed; opacity: 0.6;">
                                    <input
                                        type="checkbox"
                                        class="b3-switch"
                                        checked={true}
                                        disabled
                                    />
                                </label>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <div class="b3-dialog__action">
        <button
            class="b3-button b3-button--cancel"
            on:click={() => dialog.destroy()}>{i18n.confirm}</button
        >
    </div>
</div>

<style>
    .b3-list-item {
        padding: 8px 12px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--b3-border-color);
        min-height: 48px;
    }
    .b3-list-item:last-child {
        border-bottom: none;
    }
    .layout-tab-bar .item {
        cursor: pointer;
        padding: 8px 16px;
        position: relative;
    }
    .layout-tab-bar .item--focus::after {
        content: "";
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 2px;
        background-color: var(--b3-theme-primary);
    }
</style>
