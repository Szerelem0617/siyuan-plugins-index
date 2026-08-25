<script lang="ts">
    import { onMount } from "svelte";
    import { openDbConfigDialog } from "../../av/av-setting/db-config";
    import { i18n, plugin, confirmDialog } from "../../../shared/utils";
    import { supertagBinder } from "../core/supertag-binder";
    import { showMessage, openTab, Dialog } from "siyuan";
    import { getUnifiedSupertagList, type UnifiedSupertagDefinition } from "../core/supertag-entity";
    import { post } from "../../../shared/api-client/request";
    import ConditionalTriggerDialog from "../../command/av-interaction/dialogs/ConditionalTriggerDialog.svelte";
    import { getSqliteEngine } from "../../sqlite/sqlite-manager";
    import { getTypeAvId } from "../../command/registration";
    import { refreshSupertagRegistry } from "../../command/utils/sync-service";

    export let dialog: any;
    export let supertagManager: any = null;

    let loading = true;
    let searchQuery = "";
    let supertagList: UnifiedSupertagDefinition[] = [];

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

    import { Menu } from "siyuan";

    async function openSelectDbDialog(group: UnifiedSupertagDefinition, event?: MouseEvent) {
        try {
            const sqlRes = await post("/api/query/sql", {
                stmt: `SELECT id, content FROM blocks WHERE type = 'av' ORDER BY updated DESC LIMIT 100;`
            });
            const rows: any[] = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
            if (rows.length === 0) {
                showMessage("当前工作区暂无可用数据库，请先在思源中创建数据库", 4000, "info");
                return;
            }

            const menu = new Menu();
            for (const row of rows) {
                const dbName = row.content?.trim() || `未命名库 (${row.id.slice(0, 6)})`;
                menu.addItem({
                    icon: "iconDatabase",
                    label: dbName,
                    click: async () => {
                        await supertagBinder.setPref(group.typeName, row.id);
                        await loadData();
                        showMessage(`✓ 已将 #${group.typeName} 关联至数据库 "${dbName}"`);
                    }
                });
            }

            const x = event?.clientX || (window.innerWidth / 2 - 100);
            const y = event?.clientY || (window.innerHeight / 3);
            menu.open({ x, y });
        } catch (e: any) {
            showMessage(`获取数据库列表失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function handleUnbindDb(group: UnifiedSupertagDefinition) {
        try {
            await supertagBinder.setPref(group.typeName, "enabled");
            await loadData();
            showMessage(`✓ 已解除 #${group.typeName} 的数据库关联`);
        } catch (e: any) {
            showMessage(`解除关联失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function openTriggerConfig(group: UnifiedSupertagDefinition) {
        try {
            const supertagLabel = group.typeName;
            const currentScript = group.conditionalScript || "";

            const triggerDialog = new Dialog({
                title: `⚡ Supertag #${supertagLabel} 命令配置`,
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
                            showMessage(`✓ 已更新 Supertag #${supertagLabel} 的命令配置 ⚡`);
                        } catch (err: any) {
                            console.error("Save command config failed:", err);
                            showMessage(`保存命令失败: ${err.message || err}`, 3000, "error");
                        }
                    }
                }
            });
        } catch (e: any) {
            console.error("Open Command Dialog error:", e);
            showMessage(`打开命令设置失败: ${e.message || e}`, 3000, "error");
        }
    }

    $: filteredList = supertagList.filter(item => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return item.typeName.toLowerCase().includes(q);
    });

    $: totalDataCount = supertagList.filter(s => s.hasDataSchema).length;
    $: totalCommandCount = supertagList.filter(s => s.hasBehavior).length;
</script>

<div
    class="fn__flex-1 fn__flex-column indexos-management-panel"
    style="height: 100%; display: flex; flex-direction: column;"
>
    <!-- 统一顶栏：超级标签管理 -->
    <div
        class="indexos-tab-bar layout-tab-bar fn__flex"
        style="flex-shrink: 0; padding: 10px 16px; border-bottom: 1px solid var(--indexos-border-subtle); align-items: center; justify-content: space-between; background: var(--indexos-bg-base) !important; gap: 12px;"
    >
        <div class="fn__flex" style="align-items: center; gap: 10px;">
            <div class="fn__flex" style="align-items: center; gap: 6px;">
                <svg style="width: 16px; height: 16px; color: var(--indexos-accent-primary);"><use xlink:href="#iconTags"></use></svg>
                <span style="font-weight: 600; font-size: 14px; color: var(--indexos-text-main);">超级标签管理</span>
            </div>
            <div class="fn__flex" style="align-items: center; gap: 6px;">
                <span class="b3-chip b3-chip--small" style="font-size: 11px; opacity: 0.8;" title="系统中登记的 Supertag 总数">
                    共 {supertagList.length} 个
                </span>
                <span class="b3-chip b3-chip--small" style="font-size: 11px; opacity: 0.8;" title="已绑定/拥有数据库的标签数">
                    📊 {totalDataCount} 数据库
                </span>
                <span class="b3-chip b3-chip--small" style="font-size: 11px; opacity: 0.8;" title="已配置自动化规则或按钮的标签数">
                    ⚡ {totalCommandCount} 命令
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
                <!-- Header row (4 列极简结构) -->
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
                        <span>数据库 (Database)</span>
                    </div>
                    <div
                        class="b3-list-item__text fn__flex"
                        style="font-weight: bold; opacity: 0.7; flex: 2.6; align-items: center;"
                    >
                        <span>命令 (Commands)</span>
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
                        <!-- 1. Tag Column (2.2 flex) -->
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
                                    title="纯属性状态（打标时将只挂载 custom-* 属性）"
                                >
                                    纯属性
                                </span>
                            {/if}
                        </div>

                        <!-- 2. Database Column (4.2 flex) - 二选一去重与专属库生成 -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 4.2; align-items: center; gap: 8px; overflow: hidden; padding-right: 8px;"
                        >
                            {#if group.hasDataSchema}
                                <div
                                    class="fn__flex"
                                    style="align-items: center; gap: 6px; width: 100%;"
                                >
                                    <svg
                                        style="width: 12px; height: 12px; opacity: 0.8; color: #059669; flex-shrink: 0;"
                                        ><use xlink:href="#iconDatabase"></use></svg
                                    >
                                    
                                    {#if group.isDuplicateName}
                                        <span
                                            class="dup-danger-badge"
                                            style="font-size: 11px; color: #DC2626; background: rgba(239, 68, 68, 0.12); padding: 2px 6px; border-radius: 3px; font-weight: 600; white-space: nowrap;"
                                            title="全局存在同名数据库，请在思源中先重命名以消除歧义"
                                        >
                                            ⚠️ 重名库: {group.selectedAvName}
                                        </span>
                                    {:else}
                                        <span
                                            style="font-size: 12px; font-weight: 600; font-family: ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; color: var(--indexos-text-main);"
                                            title={group.selectedAvName}
                                        >
                                            {group.selectedAvName}
                                        </span>
                                    {/if}

                                    {#if group.isDedicatedDb}
                                        <span class="indexos-tag-badge" style="flex-shrink: 0; font-size: 9px; color: #059669; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.08);">
                                            专属库
                                        </span>
                                    {/if}

                                    <!-- 定位按钮 -->
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 6px; flex-shrink: 0;"
                                        title="在编辑器中定位打开该数据库"
                                        on:click={() => locateAv(group.selectedAvId)}
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
                                            if (group.selectedAvId) {
                                                openDbConfigDialog(group.selectedAvId, group.selectedAvId);
                                            }
                                        }}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconSettings"></use></svg>
                                        <span>设置</span>
                                    </button>

                                    <!-- 解除关联按钮 ✕ -->
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 6px; flex-shrink: 0; color: var(--indexos-text-muted);"
                                        title="解除该 Supertag 与该数据库的关联"
                                        on:click={() => handleUnbindDb(group)}
                                    >
                                        <span>✕</span>
                                    </button>
                                </div>
                            {:else}
                                <div class="fn__flex" style="align-items: center; gap: 6px;">
                                    <button
                                        class="indexos-btn-bordered"
                                        style="font-size: 11px; padding: 2px 8px; color: var(--indexos-accent-primary); border-color: rgba(59, 130, 246, 0.3);"
                                        title="选择并关联已有数据库"
                                        on:click={(e) => openSelectDbDialog(group, e)}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconDatabase"></use></svg>
                                        <span>+ 关联已有数据库</span>
                                    </button>
                                </div>
                            {/if}
                        </div>

                        <!-- 3. Commands Column (2.6 flex) -->
                        <div
                            class="b3-list-item__text fn__flex"
                            style="flex: 2.6; align-items: center; gap: 6px; overflow: hidden; padding-right: 8px;"
                        >
                            {#if group.hasBehavior}
                                <div class="fn__flex" style="align-items: center; gap: 6px; flex-wrap: wrap;">
                                    {#if group.rulesCount > 0}
                                        <span class="b3-chip b3-chip--small" style="font-size: 10px; background: var(--indexos-accent-badge-bg); color: var(--indexos-accent-badge-text); border: 1px solid var(--indexos-border-light);">
                                            ⚡ {group.rulesCount} 规则
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
                                        title="配置该标签的自动化触发规则与交互命令"
                                        on:click={() => openTriggerConfig(group)}
                                    >
                                        <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconZap"></use></svg>
                                        <span>命令配置</span>
                                    </button>
                                </div>
                            {:else}
                                <button
                                    class="indexos-btn-bordered"
                                    style="font-size: 11px; padding: 2px 8px; opacity: 0.8;"
                                    title="为该标签配置自动化规则或交互命令"
                                    on:click={() => openTriggerConfig(group)}
                                >
                                    <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconAdd"></use></svg>
                                    <span>+ 配置命令</span>
                                </button>
                            {/if}
                        </div>

                        <!-- 4. Switch Column (1.0 flex) -->
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
