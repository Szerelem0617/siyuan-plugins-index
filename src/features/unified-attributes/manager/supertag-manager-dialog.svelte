<script lang="ts">
    import { onMount } from "svelte";
    import { openDbConfigDialog } from "../../av/av-setting/db-config";
    import { i18n, plugin, confirmDialog } from "../../../shared/utils";
    import { supertagBinder } from "../core/supertag-binder";
    import { showMessage, openTab, Dialog } from "siyuan";
    import { getUnifiedSupertagList, type UnifiedSupertagDefinition } from "../core/supertag-entity";
    import { openIndexDropdown } from "../../../ui/components/index-dropdown";
    import { post } from "../../../shared/api-client/request";
    import { constructCommandStorage } from "../../command/instantiate-storage";
    import { isDataDbsInstantiated, createSupertagProjectionDatabase } from "../../command/data-db-management";
    import ConditionalTriggerDialog from "../../command/av-interaction/dialogs/ConditionalTriggerDialog.svelte";
    import { getSqliteEngine } from "../../sqlite/sqlite-manager";
    import { getTypeAvId, getTypeDocId } from "../../command/registration";
    import { refreshSupertagRegistry } from "../../command/utils/sync-service";

    export let dialog: any;
    export let supertagManager: any = null;

    let loading = true;
    let searchQuery = "";
    let supertagList: UnifiedSupertagDefinition[] = [];
    let allTemplateOptions: Array<{ avId: string; name: string }> = [];

    function locateAv(avId: string) {
        if (!avId) return;
        
        post("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${avId}%' OR ial LIKE '%${avId}%') LIMIT 1`
        }).then((res) => {
            let targetBlockId = (res && res.length > 0) ? res[0].id : avId;
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
        supertagList = await getUnifiedSupertagList();

        const uniqueDbs = new Map<string, string>();
        for (const item of supertagList) {
            for (const d of item.dataConfigs) {
                if (d.avId && !uniqueDbs.has(d.avId)) {
                    uniqueDbs.set(d.avId, d.displayName || d.avName || d.typeName || ("DB: " + d.avId.substring(0, 6)));
                }
            }
        }
        allTemplateOptions = Array.from(uniqueDbs.entries()).map(([avId, name]) => ({ avId, name }));
        loading = false;
    }

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

    async function handlePrefChange(typeName: string, avId: string) {
        if (avId && avId !== "enabled" && avId !== "disabled") {
            await supertagBinder.setPref(typeName, avId);
            await loadData();
        }
    }

    async function handleToggleEnable(group: UnifiedSupertagDefinition, checked: boolean) {
        try {
            await supertagBinder.setPref(group.typeName, checked ? "enabled" : "disabled");
            group.enabled = checked;
            supertagList = [...supertagList];

            showMessage(checked ? `✓ 超级标签 #${group.typeName} 推荐已启用` : `✗ 超级标签 #${group.typeName} 推荐已禁用`);
        } catch (e: any) {
            console.error("Failed to toggle supertag state:", e);
            showMessage(`保存配置失败: ${e.message || e}`, 5000, "error");
        }
    }

    /** 开启与关闭合一：一键开关 */
    async function handleToggleAllSmart() {
        try {
            const allEnabled = filteredList.every((group) => group.enabled);
            const targetState = !allEnabled;

            for (const group of filteredList) {
                await supertagBinder.setPref(group.typeName, targetState ? "enabled" : "disabled");
                group.enabled = targetState;
            }

            supertagList = [...supertagList];

            const msg = targetState
                ? (i18n.supertagManager?.allEnabledMsg || "✓ 已一键开启所有 Supertag 推荐")
                : (i18n.supertagManager?.allDisabledMsg || "✗ 已一键关闭所有 Supertag 推荐");
            showMessage(msg);
        } catch (e: any) {
            console.error("Failed to smart toggle all supertags:", e);
            showMessage(`一键开关切换失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function handleCreateDb(group: UnifiedSupertagDefinition, templateAvId?: string) {
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
                            showMessage("✓ 数据已存储到思源，正在为标签创建专属数据库...", 3000);
                            await executeCreateSupertagDb(group, templateAvId);
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

            await executeCreateSupertagDb(group, templateAvId);
        } catch (e: any) {
            console.error("Create DB failed:", e);
            showMessage(`创建数据库失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function executeCreateSupertagDb(group: UnifiedSupertagDefinition, templateAvId?: string) {
        const rootTag = group.typeName.split(/[\.\/]/)[0].toLowerCase();
        showMessage(`⏳ 正在为 #${group.typeName} 派生生成 supertag-${rootTag} 专属库...`, 4000);
        try {
            const res = await createSupertagProjectionDatabase(group.typeName, templateAvId);
            if (res && res.avId) {
                await loadData();
                showMessage(`✅ 成功创建并激活专属投影库: ${res.dbName}！`, 4000);
            }
        } catch (err: any) {
            console.error("Failed to create supertag projection DB:", err);
            showMessage(`生成专属库失败: ${err.message || err}`, 5000, "error");
        }
    }

    async function openTriggerConfig(group: UnifiedSupertagDefinition) {
        try {
            const supertagLabel = group.typeName;
            const currentScript = group.conditionalScript || "";

            const triggerDialog = new Dialog({
                title: `⚡ 配置 Supertag #${supertagLabel} 自动化触发与虚拟按钮`,
                content: `<div id="conditional-config-container" style="height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;"></div>`,
                width: "820px",
                height: "720px"
            });
            triggerDialog.element.classList.add("indexos-dialog");

            new ConditionalTriggerDialog({
                target: triggerDialog.element.querySelector("#conditional-config-container")!,
                props: {
                    dialog: triggerDialog,
                    supertag: supertagLabel,
                    currentValue: currentScript,
                    onSave: async (updatedVal: string) => {
                        try {
                            const { db } = await getSqliteEngine();
                            const typeAvId = getTypeAvId();
                            if (typeAvId) {
                                db.run(`UPDATE "supertag-db" SET "conditional_script" = ?, _updated = ? WHERE LOWER(type_tag) = ?;`, [updatedVal, Date.now(), supertagLabel.toLowerCase()]);
                            }
                            await refreshSupertagRegistry();
                            await loadData();
                            showMessage(`✓ 已更新 Supertag #${supertagLabel} 的自动化触发配置 ⚡`);
                        } catch (err: any) {
                            console.error("Save trigger config failed:", err);
                            showMessage(`保存规则失败: ${err.message || err}`, 3000, "error");
                        }
                    }
                }
            });
        } catch (e: any) {
            console.error("Open Trigger Dialog error:", e);
            showMessage(`打开触发器设置失败: ${e.message || e}`, 3000, "error");
        }
    }

    $: filteredList = supertagList.filter(item => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return item.typeName.toLowerCase().includes(q);
    });

    $: totalDataCount = supertagList.filter(s => s.hasDataSchema).length;
    $: totalBehaviorCount = supertagList.filter(s => s.hasBehavior).length;
</script>

<div
    class="fn__flex-1 fn__flex-column indexos-management-panel"
    style="height: 100%; display: flex; flex-direction: column;"
>
    <!-- Unified Header Bar -->
    <div
        class="indexos-tab-bar layout-tab-bar fn__flex"
        style="flex-shrink: 0; padding: 10px 16px; border-bottom: 1px solid var(--indexos-border-subtle); align-items: center; justify-content: space-between; background: var(--indexos-bg-base) !important; gap: 12px;"
    >
        <div class="fn__flex" style="align-items: center; gap: 10px;">
            <div class="fn__flex" style="align-items: center; gap: 6px;">
                <svg style="width: 16px; height: 16px; color: var(--indexos-accent-primary);"><use xlink:href="#iconTags"></use></svg>
                <span style="font-weight: 600; font-size: 14px; color: var(--indexos-text-main);">超级标签工作台</span>
            </div>
            <div class="fn__flex" style="align-items: center; gap: 6px;">
                <span class="b3-chip b3-chip--small" style="font-size: 11px; opacity: 0.8;" title="系统中登记的 Supertag 总数">
                    共 {supertagList.length} 个
                </span>
                <span class="b3-chip b3-chip--small" style="font-size: 11px; opacity: 0.8;" title="已绑定数据库的标签数">
                    📊 {totalDataCount} 数据库
                </span>
                <span class="b3-chip b3-chip--small" style="font-size: 11px; opacity: 0.8;" title="已配置自动化/虚拟按钮的标签数">
                    ⚡ {totalBehaviorCount} 自动化
                </span>
            </div>
        </div>

        <div class="fn__flex" style="align-items: center; gap: 8px;">
            <!-- 搜索框 -->
            <div class="b3-form__icon" style="width: 200px;">
                <input
                    class="b3-text-field b3-text-field--small fn__flex-1"
                    style="padding-left: 26px; height: 26px; font-size: 12px;"
                    placeholder="搜索超级标签..."
                    bind:value={searchQuery}
                />
                <svg class="b3-form__icon-icon" style="width: 12px; height: 12px; left: 8px;"><use xlink:href="#iconSearch"></use></svg>
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
        {:else if filteredList.length === 0}
            <div
                class="fn__flex-column fn__flex-center"
                style="height: 200px; color: var(--b3-theme-on-surface-light);"
            >
                <svg
                    style="width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5;"
                    ><use xlink:href="#iconTags"></use></svg
                >
                <p>未找到匹配的超级标签</p>
                <p style="font-size: 0.9em; opacity: 0.6;">可通过在思源块中输入 @标签名 实时创建并绑定</p>
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
                        style="font-weight: bold; opacity: 0.7; flex: 2.2; align-items: center;"
                    >
                        <span>超级标签 (Tag)</span>
                    </div>
                    <div
                        class="b3-list-item__text fn__flex"
                        style="font-weight: bold; opacity: 0.7; flex: 4.2; align-items: center;"
                    >
                        <span>数据能力 (Data Schema)</span>
                    </div>
                    <div
                        class="b3-list-item__text fn__flex"
                        style="font-weight: bold; opacity: 0.7; flex: 2.6; align-items: center;"
                    >
                        <span>自动化行为 (Actions & Triggers)</span>
                    </div>
                    <div
                        class="b3-list-item__text fn__flex"
                        style="font-weight: bold; opacity: 0.8; flex: 1.0; justify-content: flex-end; align-items: center; gap: 6px;"
                    >
                        <button
                            class="indexos-btn-bordered"
                            title="一键切换所有 Supertag 的推荐状态"
                            on:click={handleToggleAllSmart}
                        >
                            <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconRefresh"></use></svg>
                            <span>一键开关</span>
                        </button>
                    </div>
                </div>

                {#each filteredList as group}
                    <div
                        class="b3-list-item {group.hasDataSchema || group.hasBehavior ? 'supertag-row--ready' : 'supertag-row--pending'}"
                        style="display: flex; align-items: center; padding: 10px 16px; min-height: 52px; box-sizing: border-box; flex-shrink: 0; {group.hasDataSchema || group.hasBehavior ? '' : 'opacity: 0.72;'}"
                    >
                        <!-- Tag Column (2.2 flex) -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 2.2; align-items: center; gap: 8px; overflow: hidden; padding-right: 8px;"
                        >
                            <svg
                                class="b3-list-item__graphic"
                                style="color: {group.hasDataSchema || group.hasBehavior ? 'var(--indexos-accent-primary)' : 'var(--indexos-text-muted)'}; width: 14px; height: 14px; flex-shrink: 0; margin: 0;"
                                ><use xlink:href="#iconTags"></use></svg
                            >
                            <span style="font-weight: 600; font-family: ui-monospace, monospace; line-height: 1.2; word-break: break-all; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: var(--indexos-text-main); font-size: 13px;">#{group.typeName}</span>
                            
                            {#if group.isBuiltin}
                                <span
                                    class="indexos-tag-badge indexos-tag-badge--builtin"
                                    style="flex-shrink: 0; color: var(--indexos-text-muted) !important;"
                                    title="系统内置 Supertag 原型"
                                >
                                    <span class="badge-dot" style="background-color: var(--indexos-index-blue) !important;"></span>内置
                                </span>
                            {:else if !group.hasDataSchema && !group.hasBehavior}
                                <span
                                    class="indexos-tag-badge"
                                    style="flex-shrink: 0; font-size: 10px; opacity: 0.7; background: var(--indexos-bg-container); border: 1px dashed var(--indexos-border-light);"
                                    title="尚未创建专属数据库 (打标时将自动创建)"
                                >
                                    未建库
                                </span>
                            {/if}
                        </div>

                        <!-- Data Schema Column (4.2 flex) -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 4.2; align-items: center; gap: 8px; overflow: hidden; padding-right: 8px;"
                        >
                            {#if group.dataConfigs.length > 0}
                                <div
                                    class="fn__flex"
                                    style="align-items: center; gap: 6px; width: 100%;"
                                >
                                    <svg
                                        style="width: 12px; height: 12px; opacity: 0.6; color: var(--indexos-accent-primary); flex-shrink: 0;"
                                        ><use xlink:href="#iconDatabase"></use></svg
                                    >
                                    {#if group.dataConfigs.length > 1}
                                        <button
                                            class="b3-select fn__flex"
                                            style="align-items: center; justify-content: space-between; min-width: 120px; max-width: 180px; height: 26px; font-size: 11px; padding: 2px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer;"
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
                                                }
                                            })}
                                        >
                                            <span style="font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                {group.dataConfigs.find(c => c.avId === group.selectedAvId)?.displayName || group.dataConfigs.find(c => c.avId === group.selectedAvId)?.avName || ("DB: " + group.selectedAvId.substring(0, 6))}
                                            </span>
                                            <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.6; flex-shrink: 0; margin-left: 4px; fill: currentColor;"><use xlink:href="#iconDown"></use></svg>
                                        </button>
                                        <span class="indexos-tag-badge indexos-tag-badge--duplicate" style="flex-shrink: 0; font-size: 10px;">
                                            多库
                                        </span>
                                    {:else}
                                        <span
                                            style="font-size: 12px; opacity: 0.9; font-family: ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;"
                                            >{group.dataConfigs[0].displayName || group.dataConfigs[0].avName || ("DB: " + group.dataConfigs[0].avId.substring(0, 8))}</span
                                        >
                                    {/if}

                                    <!-- 定位按钮 -->
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 6px; flex-shrink: 0;"
                                        title="在编辑器中定位打开该数据库"
                                        on:click={() => locateAv(group.selectedAvId || group.dataConfigs[0]?.avId)}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconFocus"></use></svg>
                                        <span>定位</span>
                                    </button>

                                    <!-- 数据库设置按钮 ⚙️ -->
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 6px; flex-shrink: 0;"
                                        title="配置字段列映射与继承规则"
                                        on:click={() => {
                                            const curConfig = group.dataConfigs.find(c => c.avId === (group.selectedAvId || group.dataConfigs[0]?.avId)) || group.dataConfigs[0];
                                            if (curConfig) {
                                                const targetAvId = curConfig.avId || curConfig.blockId;
                                                const targetBlockId = curConfig.blockId || curConfig.avId;
                                                openDbConfigDialog(targetAvId, targetBlockId);
                                            }
                                        }}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconSettings"></use></svg>
                                        <span>设置</span>
                                    </button>
                                </div>
                            {:else}
                                {@const rootTag = group.typeName.split(/[\.\/]/)[0].toLowerCase()}
                                <div class="fn__flex" style="align-items: center; gap: 6px; flex-wrap: wrap;">
                                    {#if allTemplateOptions.length > 0}
                                        <button
                                            class="b3-select fn__flex"
                                            style="align-items: center; justify-content: space-between; min-width: 100px; max-width: 140px; height: 26px; font-size: 11px; padding: 2px 6px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer;"
                                            title="选择模板数据库克隆字段结构 (打标时将自动克隆)"
                                            on:click={(e) => openIndexDropdown({
                                                event: e,
                                                options: [
                                                    { value: "", label: "-- 纯净空白表 --" },
                                                    ...allTemplateOptions.map(t => ({ value: t.avId, label: "模板: " + t.name }))
                                                ],
                                                selectedValue: group.selectedTemplateAvId || "",
                                                onSelect: async (val) => {
                                                    group.selectedTemplateAvId = val;
                                                    await supertagBinder.setTemplatePref(group.typeName, val);
                                                    supertagList = [...supertagList];
                                                    showMessage(val ? `✓ 已预设克隆模板，打标 #${group.typeName} 时将自动按模板建库` : `已重置为默认空白表`);
                                                }
                                            })}
                                        >
                                            <span style="font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                {group.selectedTemplateAvId ? ("模板: " + (allTemplateOptions.find(t => t.avId === group.selectedTemplateAvId)?.name || group.selectedTemplateAvId.substring(0, 6))) : "-- 预设模板库 --"}
                                            </span>
                                            <svg class="dropdown-arrow" style="width: 9px; height: 9px; opacity: 0.6; flex-shrink: 0; margin-left: 4px; fill: currentColor;"><use xlink:href="#iconDown"></use></svg>
                                        </button>
                                    {/if}

                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 8px; color: var(--indexos-accent-primary);"
                                        title={`在 /data-dbs 页面立即生成 supertag-${rootTag} 专属纯净投影库`}
                                        on:click={() => handleCreateDb(group, group.selectedTemplateAvId)}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconAdd"></use></svg>
                                        <span>生成专属库</span>
                                    </button>
                                </div>
                            {/if}
                        </div>

                        <!-- Behavior & Triggers Column (2.6 flex) -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 2.6; align-items: center; gap: 6px; overflow: hidden; padding-right: 8px;"
                        >
                            {#if group.hasBehavior}
                                <div class="fn__flex" style="align-items: center; gap: 6px; flex-wrap: wrap;">
                                    {#if group.rulesCount > 0}
                                        <span class="b3-chip b3-chip--small" style="font-size: 10px; background: var(--indexos-accent-badge-bg); color: var(--indexos-accent-badge-text); border: 1px solid var(--indexos-border-light);">
                                            ⚡ {group.rulesCount} 条规则
                                        </span>
                                    {/if}
                                    {#if group.hasVirtualButton}
                                        <span class="b3-chip b3-chip--small" style="font-size: 10px; background: var(--indexos-bg-container); border: 1px solid var(--indexos-border-light);">
                                            🔘 悬浮按钮
                                        </span>
                                    {/if}
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 6px; flex-shrink: 0;"
                                        title="编辑自动化触发规则与虚拟按钮"
                                        on:click={() => openTriggerConfig(group)}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconZap"></use></svg>
                                        <span>规则</span>
                                    </button>
                                </div>
                            {:else}
                                <button
                                    class="indexos-btn-bordered"
                                    style="font-size: 11px; padding: 2px 8px; opacity: 0.8;"
                                    title="为该标签配置生命周期触发器或虚拟按钮"
                                    on:click={() => openTriggerConfig(group)}
                                >
                                    <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconAdd"></use></svg>
                                    <span>添加自动化规则</span>
                                </button>
                            {/if}
                        </div>

                        <!-- Status Column (1.0 flex) -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 1.0; justify-content: flex-end; align-items: center;"
                        >
                            <input
                                class="b3-switch"
                                type="checkbox"
                                checked={group.enabled}
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
    .b3-dialog__action {
        padding: 8px 16px;
        border-top: 1px solid var(--indexos-border-subtle);
        background: var(--indexos-bg-base);
        display: flex;
        justify-content: flex-end;
    }
</style>
