<script lang="ts">
    import { onMount } from "svelte";
    import { getGlobalTypeConfigs, loadDbConfig, saveDbConfig, openDbConfigDialog } from "../../../av/av-setting/db-config";
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
    import { openIndexDropdown } from "../../../../ui/components/index-dropdown";
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

    async function loadData() {
        loading = true;
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
            const validPref = (pref && pref !== "enabled" && pref !== "disabled") ? pref : "";

            const group: TagGroup = {
                typeName: name,
                dataConfigs: dataMap.get(name) || [],
                logicConfigs: logicMap.get(name) || [],
                selectedAvId: validPref || dataMap.get(name)?.[0]?.avId || "",
            };

            if (hasLogic) {
                tempCmdComp.push(group);
            } else if (hasData) {
                // 仅当非命令 tag 时，才展示在数据 tag 列表中，避免重复显示
                tempDataComp.push(group);
            }
        });

        const sorter = (a: TagGroup, b: TagGroup) => {
            const isBuiltinA = BUILTIN_SUPERTAGS.has(a.typeName.toLowerCase());
            const isBuiltinB = BUILTIN_SUPERTAGS.has(b.typeName.toLowerCase());
            if (isBuiltinA && !isBuiltinB) return -1;
            if (!isBuiltinA && isBuiltinB) return 1;
            return a.typeName.localeCompare(b.typeName);
        };
        commandComponents = tempCmdComp.sort(sorter);
        dataComponents = tempDataComp.sort(sorter);

        await enrichDuplicateDbNames([...dataComponents, ...commandComponents]);
        dataComponents = [...dataComponents];
        commandComponents = [...commandComponents];

        loading = false;
    }

    import { onDestroy } from "svelte";

    onMount(() => {
        loadData();
        const handleRefresh = () => {
            console.log("[SupertagManager] index-plugin-refresh-supertags event received! Reloading UI...");
            loadData();
        };
        window.addEventListener("index-plugin-refresh-supertags", handleRefresh);

        return () => {
            window.removeEventListener("index-plugin-refresh-supertags", handleRefresh);
        };
    });

    async function enrichDuplicateDbNames(groups: TagGroup[]) {
        for (const g of groups) {
            if (!g.dataConfigs || g.dataConfigs.length <= 1) continue;

            const blockIds = g.dataConfigs.map(c => c.blockId || c.avId).filter(Boolean);
            if (blockIds.length === 0) continue;

            try {
                const stmt = `SELECT b.id, d.content as doc_title, d.hpath, b.created, b.updated FROM blocks b LEFT JOIN blocks d ON b.root_id = d.id WHERE b.id IN ('${blockIds.join("','")}')`;
                const res = await post("/api/query/sql", { stmt });
                const rows = (res && Array.isArray(res)) ? res : (res?.data || []);

                const infoMap = new Map<string, { docTitle: string; created: string }>();
                if (Array.isArray(rows)) {
                    rows.forEach((r: any) => {
                        let title = r.doc_title || "";
                        if (!title && r.hpath) {
                            const parts = r.hpath.split("/").filter(Boolean);
                            title = parts[parts.length - 1] || "";
                        }
                        if (!title) title = "未命名页";
                        infoMap.set(r.id, { docTitle: title, created: r.created || "" });
                    });
                }

                // 1. 统计当前组内每个 docTitle 出现的频次
                const docCountMap = new Map<string, number>();
                g.dataConfigs.forEach(cfg => {
                    const info = infoMap.get(cfg.blockId || cfg.avId);
                    const docTitle = info ? info.docTitle : (cfg.avName || "未知页");
                    docCountMap.set(docTitle, (docCountMap.get(docTitle) || 0) + 1);
                });

                // 2. 按组内出现顺序生成 displayName
                const docIndexMap = new Map<string, number>();
                g.dataConfigs.forEach(cfg => {
                    const info = infoMap.get(cfg.blockId || cfg.avId);
                    const docTitle = info ? info.docTitle : (cfg.avName || "未知页");
                    const count = docCountMap.get(docTitle) || 1;

                    if (count > 1) {
                        // 同一页面有多个重名数据库：加上 .1, .2 后缀
                        const currentIndex = (docIndexMap.get(docTitle) || 0) + 1;
                        docIndexMap.set(docTitle, currentIndex);
                        (cfg as any).displayName = `${docTitle}.${currentIndex}`;
                    } else {
                        // 不同页面：直接显示页面名称
                        (cfg as any).displayName = docTitle;
                    }
                });
            } catch (e) {
                console.error("Failed to enrich duplicate db names:", e);
            }
        }
    }

    import { confirmDialog } from "../../../../shared/utils";
    import { constructCommandStorage } from "../../construct-dir";
    import { isDataDbsInstantiated, getOrStoreDataDbDoc } from "../../data-db-management";

    async function handlePrefChange(typeName: string, avId: string) {
        if (avId && avId !== "enabled" && avId !== "disabled") {
            supertagBinder.setPref(typeName, avId);
        }
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

    /** 开启与关闭合一：一键开关 */
    function handleToggleAllSmart() {
        try {
            const targetList = activeTab === "data" ? dataComponents : commandComponents;
            const allEnabled = targetList.every((group) => supertagBinder.getPref(group.typeName) !== "disabled");
            const targetState = !allEnabled;

            targetList.forEach((group) => {
                supertagBinder.setPref(group.typeName, targetState ? "enabled" : "disabled");
            });

            commandComponents = [...commandComponents];
            dataComponents = [...dataComponents];

            const msg = targetState
                ? (i18n.supertagManager?.allEnabledMsg || "✓ 已一键开启当前分类下所有 Tag 推荐")
                : (i18n.supertagManager?.allDisabledMsg || "✗ 已一键关闭当前分类下所有 Tag 推荐");
            showMessage(msg);
        } catch (e: any) {
            console.error("Failed to smart toggle all supertags:", e);
            showMessage(`一键开关切换失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function handleCreateDb(group: TagGroup) {
        try {
            const isInstantiated = await isDataDbsInstantiated();
            if (!isInstantiated) {
                confirmDialog(
                    i18n.initSystemDB || "实例化",
                    i18n.supertagManager?.notInstantiatedContent || "未实例化 IndexOS 命令管理系统，无法创建数据库。是否立即实例化？",
                    async () => {
                        try {
                            showMessage("⏳ 正在将数据存储到思源...", 5000);
                            await constructCommandStorage();
                            showMessage("✓ 数据已存储到思源，正在为标签创建数据库...", 3000);
                            await executeCreateDb(group);
                        } catch (err: any) {
                            console.error("Instantiation failed:", err);
                            showMessage(`存储到思源失败: ${err.message || err}`, 5000, "error");
                        }
                    },
                    undefined,
                    i18n.supertagManager?.instantiateNow || "立即实例化"
                );
                return;
            }

            await executeCreateDb(group);
        } catch (e: any) {
            console.error("Create DB failed:", e);
            showMessage(`创建数据库失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function executeCreateDb(group: TagGroup) {
        showMessage(`⏳ 正在为 #${group.typeName} 在 data-dbs 中创建数据库...`, 3000);
        const res = await getOrStoreDataDbDoc(group.typeName);
        if (res && res.avId) {
            const newConfig: TypeConfig = {
                typeName: group.typeName,
                avId: res.avId,
                blockId: res.docId,
                avName: group.typeName
            };
            group.dataConfigs.push(newConfig);
            group.selectedAvId = res.avId;

            // 仅当非命令 tag 时才加入数据 tag 列表，避免命令 tag 在数据 tag 界面重复显示
            if (group.logicConfigs.length === 0 && !dataComponents.some(d => d.typeName === group.typeName)) {
                dataComponents.push(group);
            }
            await enrichDuplicateDbNames([group]);
            dataComponents = [...dataComponents];
            commandComponents = [...commandComponents];

            showMessage(`✓ 成功为 #${group.typeName} 创建数据库！`);
        } else {
            showMessage(`创建数据库失败`, 5000, "error");
        }
    }

    $: currentList = activeTab === "data" ? dataComponents : commandComponents;
</script>

<div
    class="fn__flex-1 fn__flex-column indexos-management-panel"
    style="height: 100%; display: flex; flex-direction: column;"
>
    <!-- Tabs Header -->
    <div
        class="indexos-tab-bar layout-tab-bar fn__flex"
        style="flex-shrink: 0; padding: 0 16px; border-bottom: 1px solid var(--indexos-border-subtle); align-items: center; justify-content: space-between; background: var(--indexos-bg-base) !important;"
    >
        <div class="fn__flex">
            <div
                class="item {activeTab === 'data' ? 'item--focus' : ''}"
                role="tab"
                tabindex="0"
                on:click={() => (activeTab = "data")}
                on:keydown={(e) => e.key === 'Enter' && (activeTab = "data")}
            >
                <span class="item__text">{i18n.supertagManager.tabData}</span>
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
                <span class="item__text">{i18n.supertagManager.tabCommand}</span>
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
        style="padding: 16px; overflow-y: auto; min-height: 0; flex: 1 1 0%;"
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
                <p>{i18n.supertagManager.noContent}</p>
                <p style="font-size: 0.9em; opacity: 0.6;">
                    {#if activeTab === "data"}
                        {i18n.supertagManager.noContentData}
                    {:else}
                        {i18n.supertagManager.noContentCommand}
                    {/if}
                </p>
            </div>
        {:else}
            <div class="tag-list-container b3-list b3-list--background" style="display: flex; flex-direction: column; flex: 1 1 0%; min-height: 0;">
                <!-- Header row -->
                <div
                    class="b3-list-item b3-list-item--hide-action"
                    style="cursor: default; background: transparent; padding: 6px 16px; align-items: center; flex-shrink: 0;"
                >
                    <div
                        class="b3-list-item__text fn__flex"
                        style="font-weight: bold; opacity: 0.6; flex: 2; align-items: center;"
                    >
                        <span>{i18n.supertagManager.colTag}</span>
                    </div>
                    <div
                        class="b3-list-item__text fn__flex"
                        style="font-weight: bold; opacity: 0.6; flex: 4.5; align-items: center;"
                    >
                        <span>{i18n.supertagManager.colBinding}</span>
                    </div>
                    <div
                        class="b3-list-item__text fn__flex"
                        style="font-weight: bold; opacity: 0.8; flex: 1.5; justify-content: flex-end; align-items: center; gap: 6px;"
                    >
                        <span style="opacity: 0.6; font-size: 11px;">{i18n.supertagManager.colStatus || "启用"}</span>
                        <button
                            class="indexos-btn-bordered"
                            title="一键切换当前分类下所有 Tag 的推荐状态"
                            on:click={handleToggleAllSmart}
                        >
                            <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconRefresh"></use></svg>
                            <span>{i18n.supertagManager.toggleAll || "一键开关"}</span>
                        </button>
                    </div>
                </div>

                {#each currentList as group}
                    {@const isLogic = group.logicConfigs.length > 0}
                    {@const isEnabled = supertagBinder.getPref(group.typeName) !== "disabled"}
                    <div class="b3-list-item" style="display: flex; align-items: center; padding: 10px 16px; min-height: 48px; box-sizing: border-box; flex-shrink: 0;">
                        <!-- Tag Name Column -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 2; align-items: center; gap: 8px; overflow: hidden; padding-right: 8px;"
                        >
                            <svg
                                class="b3-list-item__graphic"
                                style="color: var(--indexos-accent-primary); width: 14px; height: 14px; flex-shrink: 0; margin: 0;"
                                ><use xlink:href="#iconTags"></use></svg
                            >
                            <span style="font-weight: 600; font-family: ui-monospace, monospace; line-height: 1.2; word-break: break-all; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: var(--indexos-text-main);">{group.typeName}</span>
                            
                            <!-- 不可操作的标签标志：品牌浅色 Dot 样式 -->
                            {#if BUILTIN_SUPERTAGS.has(group.typeName.toLowerCase())}
                                <span
                                    class="indexos-tag-badge indexos-tag-badge--builtin"
                                    style="flex-shrink: 0; color: var(--indexos-text-muted) !important;"
                                    title={i18n.supertagManager.builtinTooltip}
                                >
                                    <span class="badge-dot" style="background-color: var(--indexos-index-blue) !important;"></span>{i18n.supertagManager.builtinTag}
                                </span>
                            {/if}
                        </div>

                        <!-- Details Column -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 4.5; align-items: center; gap: 8px; overflow: hidden; padding-right: 8px;"
                        >
                            {#if group.dataConfigs.length > 0}
                                <div
                                    class="fn__flex"
                                    style="align-items: center; gap: 8px; width: 100%;"
                                >
                                    <svg
                                        style="width: 12px; height: 12px; opacity: 0.5; color: var(--indexos-accent-primary); flex-shrink: 0;"
                                        ><use xlink:href="#iconDatabase"
                                        ></use></svg
                                    >
                                    {#if group.dataConfigs.length > 1}
                                        <!-- 重名数据库显示所在页面和块序号，如 测试页面.12 -->
                                        <button
                                            class="b3-select fn__flex"
                                            style="align-items: center; justify-content: space-between; min-width: 130px; max-width: 220px; height: 26px; font-size: 11px; padding: 2px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer; transition: all 0.2s ease;"
                                            on:click={(e) => openIndexDropdown({
                                                event: e,
                                                options: group.dataConfigs.map(c => ({
                                                    value: c.avId,
                                                    label: c.displayName || c.avName || "DB: " + c.avId.substring(0, 6)
                                                })),
                                                selectedValue: group.selectedAvId,
                                                onSelect: (val) => {
                                                    group.selectedAvId = val;
                                                    handlePrefChange(group.typeName, val);
                                                    dataComponents = [...dataComponents];
                                                    commandComponents = [...commandComponents];
                                                }
                                            })}
                                        >
                                            <span style="font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                {group.dataConfigs.find(c => c.avId === group.selectedAvId)?.displayName || group.dataConfigs.find(c => c.avId === group.selectedAvId)?.avName || ("DB: " + group.selectedAvId.substring(0, 6))}
                                            </span>
                                            <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.6; flex-shrink: 0; margin-left: 6px; fill: currentColor;"><use xlink:href="#iconDown"></use></svg>
                                        </button>

                                        <!-- 不可操作的重名标记：品牌特质 Dot 样式 (非橘黄色) -->
                                        <span class="indexos-tag-badge indexos-tag-badge--duplicate" style="flex-shrink: 0; color: var(--indexos-text-muted) !important;">
                                            <span class="badge-dot" style="background-color: var(--indexos-index-blue) !important;"></span>{i18n.supertagManager.duplicateName}
                                        </span>
                                    {:else}
                                        <span
                                            style="font-size: 12px; opacity: 0.9; font-family: ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                                            >{group.dataConfigs[0].displayName || group.dataConfigs[0].avName ||
                                                "DB: " +
                                                    group.dataConfigs[0].avId.substring(
                                                        0,
                                                        8,
                                                    )}</span
                                        >
                                    {/if}

                                    <!-- 可点击框体按钮：定位 -->
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 6px; flex-shrink: 0;"
                                        title={i18n.supertagManager.locateTitle}
                                        on:click={() => locateAv(group.selectedAvId || group.dataConfigs[0]?.avId)}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconFocus"></use></svg>
                                        <span>{i18n.supertagManager.locate}</span>
                                    </button>

                                    <!-- 可点击框体按钮：数据库设置 ⚙️ -->
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 6px; flex-shrink: 0;"
                                        title="配置数据库设置"
                                        on:click={() => {
                                            const curConfig = group.dataConfigs.find(c => c.avId === (group.selectedAvId || group.dataConfigs[0]?.avId)) || group.dataConfigs[0];
                                            console.log("[IndexOS-Supertag-Debug] ⚙️ Clicked for tag group:", group.typeName, "curConfig:", curConfig);
                                            if (curConfig && curConfig.avId && curConfig.blockId) {
                                                openDbConfigDialog(curConfig.avId, curConfig.blockId);
                                            } else if (curConfig) {
                                                const targetAvId = curConfig.avId || curConfig.blockId;
                                                const targetBlockId = curConfig.blockId || curConfig.avId;
                                                openDbConfigDialog(targetAvId, targetBlockId);
                                            } else {
                                                console.error("[IndexOS-Supertag-Debug] Cannot open DB settings: curConfig is undefined");
                                            }
                                        }}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconSettings"></use></svg>
                                        <span>设置</span>
                                    </button>
                                </div>
                            {:else if activeTab === "command"}
                                <div class="fn__flex" style="align-items: center; gap: 6px;">
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 8px;"
                                        on:click={() => handleCreateDb(group)}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconAdd"></use></svg>
                                        <span>{i18n.supertagManager.createDatabase || "创建数据库"}</span>
                                    </button>
                                </div>
                            {/if}
                        </div>

                        <!-- Status Column -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 1.5; justify-content: flex-end; align-items: center;"
                        >
                            <input
                                class="b3-switch"
                                type="checkbox"
                                checked={isEnabled}
                                on:change={(e) => handleToggleEnable(group, e.currentTarget.checked)}
                            />
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <div class="b3-dialog__action">
        <button
            class="b3-button b3-button--primary btn-primary"
            on:click={() => dialog.destroy()}>{i18n.confirm}</button
        >
    </div>
</div>

<style>
    .b3-list-item {
        padding: 8px 12px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--indexos-border-subtle);
        min-height: 48px;
        color: var(--indexos-text-main);
        background: transparent;
    }
    .b3-list-item:last-child {
        border-bottom: none;
    }
    :global(.indexos-tab-bar) {
        background: var(--indexos-bg-base) !important;
        border-bottom: 1px solid var(--indexos-border-subtle) !important;
    }
    :global(.indexos-tab-bar .item) {
        cursor: pointer;
        padding: 8px 16px;
        position: relative;
        color: var(--indexos-text-muted) !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
    }
    :global(.indexos-tab-bar .item.item--focus) {
        color: var(--indexos-accent-primary) !important;
        font-weight: 600 !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
    }
    :global(.indexos-tab-bar .item--focus::after) {
        content: "";
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 2px;
        background-color: var(--indexos-accent-primary) !important;
        box-shadow: 0 0 8px var(--indexos-accent-glow) !important;
    }
    .b3-dialog__action {
        padding: 8px 16px;
        border-top: 1px solid var(--indexos-border-subtle);
        background: var(--indexos-bg-base);
        display: flex;
        justify-content: flex-end;
    }
</style>
