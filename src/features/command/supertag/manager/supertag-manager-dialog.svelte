<script lang="ts">
    import { onMount } from "svelte";
    import { getGlobalTypeConfigs, loadDbConfig, saveDbConfig } from "../../../av/av-setting/db-config";
    import { type TypeConfig } from "../../../av/av-setting/types";
    import { i18n } from "../../../../shared/utils";
    import { supertagMonitor } from "../core/supertag-listener";
    import { supertagBinder } from "../core/supertag-binder";
    import { showMessage } from "siyuan";
    import {
        SUPERTAG_REGISTRY,
        type SupertagCommand,
    } from "../../registration";

    import { BUILTIN_SUPERTAGS } from "../../indexos/seed-data";
    import { openTab } from "siyuan";
    import { plugin } from "../../../../shared/utils";

    export let dialog: any;
    export let supertagManager: any;

    let loading = true;
    let activeTab: "data" | "command" = "data";

    interface TagGroup {
        typeName: string;
        dataConfigs: TypeConfig[];
        logicConfigs: SupertagCommand[];
        selectedAvId: string;
    }

    let dataComponents: TagGroup[] = [];
    let commandComponents: TagGroup[] = [];

    import { post } from "../../../../shared/api-client/request";

    function locateAv(avId: string) {
        if (!avId) return;
        
        post("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avId}%' OR ial LIKE '%${avId}%') LIMIT 1`
        }).then((res) => {
            let targetBlockId = (res && res.length > 0) ? res[0].id : (avIdToBlockIdMap.get(avId) || avId);
            openTab({
                app: plugin.app,
                doc: {
                    id: targetBlockId,
                    action: ["cb-get-hl", "cb-get-focus"]
                }
            });
        }).catch((e) => {
            console.error("Locate AV failed:", e);
            openTab({
                app: plugin.app,
                doc: {
                    id: avId,
                    action: ["cb-get-hl", "cb-get-focus"]
                }
            });
        });
    }

    onMount(async () => {
        const scannedData = await getGlobalTypeConfigs();
        const logicData = SUPERTAG_REGISTRY;

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

        const tempDataComp: TagGroup[] = [];
        const tempCmdComp: TagGroup[] = [];

        allTagNames.forEach((name) => {
            const hasData = dataMap.has(name);
            const hasLogic = logicMap.has(name);
            const pref = supertagBinder.getPref(name);

            const group: TagGroup = {
                typeName: name,
                dataConfigs: dataMap.get(name) || [],
                logicConfigs: logicMap.get(name) || [],
                selectedAvId: pref || dataMap.get(name)?.[0]?.avId || "",
            };

            if (hasLogic) {
                tempCmdComp.push(group);
            } else if (hasData) {
                tempDataComp.push(group);
            }
        });

        const sorter = (a: TagGroup, b: TagGroup) =>
            a.typeName.localeCompare(b.typeName);
        commandComponents = tempCmdComp.sort(sorter);
        dataComponents = tempDataComp.sort(sorter);

        loading = false;
    });

    async function handlePrefChange(typeName: string, avId: string) {
        supertagBinder.setPref(typeName, avId);
    }

    async function handleToggleEnable(group: TagGroup, checked: boolean) {
        try {
            supertagBinder.setPref(group.typeName, checked ? "enabled" : "disabled");
            
            commandComponents = [...commandComponents];
            dataComponents = [...dataComponents];

            showMessage(checked ? `✓ 超级标签 #${group.typeName} 推荐已启用` : `✗ 超级标签 #${group.typeName} 推荐已禁用`);
        } catch (e: any) {
            console.error("Failed to toggle supertag state:", e);
            showMessage(`保存配置失败: ${e.message || e}`, 5000, "error");
        }
    }

    $: currentList =
        activeTab === "data"
            ? dataComponents
            : commandComponents;
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
                <span class="item__text">数据tag</span>
                <span
                    class="b3-chip b3-chip--small"
                    style="margin-left: 4px; opacity: 0.6;"
                    >{dataComponents.length}</span
                >
            </div>
            <div
                class="item {activeTab === 'command' ? 'item--focus' : ''}"
                role="tab"
                tabindex="0"
                on:click={() => (activeTab = "command")}
                on:keydown={(e) => e.key === 'Enter' && (activeTab = "command")}
            >
                <span class="item__text">命令tag</span>
                <span
                    class="b3-chip b3-chip--small"
                    style="margin-left: 4px; opacity: 0.6;"
                    >{commandComponents.length}</span
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
                        工作区中的数据库将在此显示（默认未开启）
                    {:else}
                        触发器与命令绑定的标签将在此显示（默认未开启）
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
                        style="font-weight: bold; opacity: 0.6; flex: 1.8;"
                        >标签 (Type)</span
                    >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6; flex: 3.2;"
                        >绑定详情 (Storage / Logic)</span
                    >
                    <span
                        class="b3-list-item__text"
                        style="font-weight: bold; opacity: 0.6; flex: 1.0; text-align: right;"
                        >启用状态</span
                    >
                </div>

                {#each currentList as group}
                    {@const isLogic = group.logicConfigs.length > 0}
                    {@const isEnabled = supertagBinder.getPref(group.typeName) !== "disabled"}
                    <div class="b3-list-item">
                        <svg
                            class="b3-list-item__graphic"
                            style="color: var(--b3-theme-primary);"
                            ><use xlink:href="#iconTags"></use></svg
                        >

                        <!-- Tag Name Column -->
                        <div
                            class="b3-list-item__text fn__flex-column"
                            style="flex: 1.8; justify-content: center; gap: 2px;"
                        >
                            <span style="font-weight: bold; line-height: 1.2; word-break: break-all;">{group.typeName}</span>
                            {#if BUILTIN_SUPERTAGS.has(group.typeName.toLowerCase())}
                                <span
                                    class="b3-chip b3-chip--info b3-chip--small"
                                    style="font-size: 9px; font-weight: normal; opacity: 0.8; align-self: flex-start; margin-top: 2px;"
                                    title="系统预置的标准 Supertag"
                                >系统内置</span>
                            {/if}
                        </div>

                        <!-- Details Column -->
                        <div
                            class="b3-list-item__text fn__flex-column"
                            style="flex: 3.2; gap: 4px;"
                        >
                            {#if group.dataConfigs.length > 0}
                                <div
                                    class="fn__flex"
                                    style="align-items: center; gap: 6px;"
                                >
                                    <svg
                                        style="width: 12px; height: 12px; opacity: 0.5;"
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

                                    <!-- Locate Button for Data Tag -->
                                    <button
                                        class="b3-button b3-button--text"
                                        style="font-size: 11px; padding: 1px 6px; line-height: 1.2; display: inline-flex; align-items: center; gap: 2px;"
                                        title="定位到对应数据库"
                                        on:click={() => locateAv(group.selectedAvId || group.dataConfigs[0]?.avId)}
                                    >
                                        <svg style="width: 11px; height: 11px;"><use xlink:href="#iconFocus"></use></svg>
                                        <span>Locate</span>
                                    </button>
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
                            <label class="fn__flex" style="align-items: center; cursor: pointer;">
                                <input
                                    type="checkbox"
                                    class="b3-switch"
                                    checked={isEnabled}
                                    on:change={(e) => handleToggleEnable(group, e.target.checked)}
                                />
                            </label>
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
