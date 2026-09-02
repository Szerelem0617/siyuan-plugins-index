<script lang="ts">
    import { onMount } from "svelte";
    import { openDbConfigDialog } from "../../av/av-setting/db-config";
    import { i18n, plugin } from "../../../shared/utils";
    import { supertagBinder } from "../core/supertag-binder";
    import { supertagAVProjector } from "../projection/supertag-av-projector";
    import { getSqliteEngine } from "../../sqlite/sqlite-manager";
    import { showMessage, openTab } from "siyuan";
    import { getUnifiedSupertagList, type UnifiedSupertagDefinition } from "../core/supertag-entity";
    import { post } from "../../../shared/api-client/request";
    import { openSupertagUnifiedConfigByTag, openPresetSupertagImportDialog } from "../../command/av-interaction/type-db-handler";
    import { openGlobalAutomationDialog } from "../../command/av-interaction/command-db-handler";
    import { openEntryConfigDialog } from "../../command/entry-config-ui";
    import { constructCommandStorage } from "../../command/instantiate-storage";
    import { refreshSupertagRegistry } from "../../command/utils/sync-service";
    import { NOTEBOOK_NAME, DATA_DBS_CONFIG } from "../../command/indexos/seed-data";
    import { getOrCreateDataDbsParentDoc } from "../../command/data-db-management";
    import CommandsPanel from "../../sqlite/commands-db/CommandsPanel.svelte";

    export let dialog: any;
    export let activeTab: "supertags" | "commands" = "supertags";
    let loading = true;
    let searchQuery = "";
    let commandSearchQuery = "";
    let supertagList: UnifiedSupertagDefinition[] = [];

    let showCreateInput = false;
    let newTagName = "";

    async function handleInitSystem() {
        try {
            showMessage("正在从默认模板将数据存储到思源...", 3000, "info");
            await constructCommandStorage();
            await refreshSupertagRegistry();
            showMessage("✓ 数据已存储到思源，可自行修改配置！", 3000, "info");
            window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));
        } catch (e: any) {
            console.error("System init failed", e);
            showMessage(`存储失败: ${e.message}`, 5000, "error");
        }
    }

    let locateIndices: Record<string, number> = {};

    function locateAv(group: UnifiedSupertagDefinition) {
        if (!group) return;
        
        const rawBlocks = group.matchedAvBlocks || [];
        const blockList: string[] = [];

        for (const b of rawBlocks) {
            if (b.blockId) blockList.push(b.blockId);
            else if (b.id) blockList.push(b.id);
        }

        if (blockList.length === 0 && group.selectedAvId) {
            blockList.push(group.selectedAvId);
        }

        if (blockList.length === 0) {
            showMessage("未找到关联数据库块", 3000, "error");
            return;
        }

        const currentIdx = locateIndices[group.typeName] !== undefined ? locateIndices[group.typeName] : 0;
        const targetId = blockList[currentIdx % blockList.length];
        locateIndices[group.typeName] = (currentIdx + 1) % blockList.length;

        post("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE id = '${targetId}' OR (type = 'av' AND (markdown LIKE '%${targetId}%' OR ial LIKE '%${targetId}%' OR content LIKE '%${targetId}%')) LIMIT 1`
        }).then((res) => {
            const targetBlockId = (res && res.length > 0) ? res[0].id : "";
            if (!targetBlockId) {
                showMessage(`未在当前文档树中找到该数据库块，可能已被删除`, 4000, "error");
                return;
            }
            openTab({
                app: plugin.app,
                doc: {
                    id: targetBlockId,
                    action: ["cb-get-hl", "cb-get-focus"]
                }
            });
            if (blockList.length > 1) {
                showMessage(`📍 已定位重名数据库 (${(currentIdx % blockList.length) + 1}/${blockList.length})`);
            } else {
                showMessage("📍 已定位到数据库");
            }
        }).catch((e) => {
            console.error("Locate AV failed:", e);
            showMessage("定位数据库失败", 3000, "error");
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

    async function handleCreateDatabase(group: UnifiedSupertagDefinition) {
        try {
            const tagName = group.typeName;
            showMessage(`正在为 #${tagName} 在 data-dbs 中创建同名数据库...`, 3000, "info");
            
            const { ensureSupertagDatabase } = await import("../core/supertag-schema");
            const avId = await ensureSupertagDatabase(tagName);
            if (!avId) {
                showMessage("创建数据库失败", 4000, "error");
                return;
            }

            group.selectedAvId = avId;
            group.selectedAvName = tagName;
            group.hasDataSchema = true;
            group.isReady = true;
            supertagList = [...supertagList];

            await loadData();
            showMessage(`✓ 成功为 #${tagName} 在 data-dbs 中创建并关联同名数据库！`, 3000);
        } catch (e: any) {
            console.error("Failed to create database for supertag:", e);
            showMessage(`创建数据库失败: ${e.message || e}`, 5000, "error");
        }
    }

    async function handleCreateNewTag() {
        const clean = newTagName.replace(/^#+/, "").trim().toLowerCase();
        if (!clean) {
            showMessage("请输入有效的超级标签名称", 3000, "error");
            return;
        }
        const exists = supertagList.some(item => item.typeName.toLowerCase() === clean);
        if (exists) {
            showMessage(`超级标签 #${clean} 已存在`, 3000, "info");
            searchQuery = clean;
            showCreateInput = false;
            newTagName = "";
            return;
        }

        try {
            showMessage(`正在创建超级标签 #${clean}...`, 2000, "info");
            await supertagBinder.setPref(clean, "enabled");
            const { ensureSupertagDatabase } = await import("../core/supertag-schema");
            await ensureSupertagDatabase(clean);

            showMessage(`✓ 成功创建超级标签 #${clean} 及同名数据库！`, 3000);
            showCreateInput = false;
            newTagName = "";
            searchQuery = "";

            const { refreshSupertagManager } = await import("./supertag-manager");
            await refreshSupertagManager();
        } catch (e: any) {
            console.error("Failed to create supertag:", e);
            showMessage(`创建超级标签失败: ${e.message || e}`, 5000, "error");
        }
    }

    function handleOpenPresetImport() {
        openPresetSupertagImportDialog(async () => {
            await loadData();
        });
    }

    async function openTriggerConfig(group: UnifiedSupertagDefinition) {
        try {
            const initialTab = (group.rulesCount > 0 && !group.hasVirtualButton) ? "auto" : "manual";
            await openSupertagUnifiedConfigByTag(group.typeName, initialTab);
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
    <!-- 统一顶栏：Tab 导航 + 操作区 -->
    <div
        class="indexos-tab-bar layout-tab-bar fn__flex"
        style="flex-shrink: 0; padding: 8px 16px; border-bottom: 1px solid var(--indexos-border-subtle); align-items: center; justify-content: space-between; background: var(--indexos-bg-base) !important; gap: 12px;"
    >
        <!-- 左侧：双 Tab 切换 -->
        <div class="fn__flex" style="align-items: center; gap: 6px;">
            <button
                class="indexos-tab-btn {activeTab === 'supertags' ? 'active' : ''}"
                on:click={() => activeTab = 'supertags'}
            >
                <svg style="width: 14px; height: 14px;"><use xlink:href="#iconTags"></use></svg>
                <span>超级标签</span>
                <span class="tab-count-badge">{supertagList.length}</span>
            </button>

            <button
                class="indexos-tab-btn {activeTab === 'commands' ? 'active' : ''}"
                on:click={() => activeTab = 'commands'}
            >
                <svg style="width: 14px; height: 14px;"><use xlink:href="#iconCode"></use></svg>
                <span>命令管理</span>
            </button>
        </div>

        <!-- 右侧：Tab 对应操作按钮 -->
        {#if activeTab === 'supertags'}
            <div class="fn__flex" style="align-items: center; gap: 8px;">
                <!-- 预设导入 -->
                <button
                    class="indexos-btn-bordered"
                    style="font-size: 11px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 4px;"
                    title="从特色预设模板一键导入 Supertag"
                    on:click={handleOpenPresetImport}
                >
                    <svg style="width: 12px; height: 12px; fill: currentColor;"><use xlink:href="#iconInbox"></use></svg>
                    <span>导入预设</span>
                </button>

                <!-- 新建超级标签 -->
                <button
                    class="indexos-btn-bordered"
                    style="font-size: 11px; padding: 4px 10px; color: var(--indexos-accent-primary); border-color: rgba(59, 130, 246, 0.4); background: rgba(59, 130, 246, 0.06); font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"
                    title="新建自定义超级标签"
                    on:click={() => { showCreateInput = !showCreateInput; newTagName = ''; }}
                >
                    <svg style="width: 12px; height: 12px; fill: currentColor;"><use xlink:href="#iconAdd"></use></svg>
                    <span>新建标签</span>
                </button>

                <!-- 搜索框 -->
                <div style="position: relative; display: flex; align-items: center; width: 170px;">
                    <input
                        class="b3-text-field b3-text-field--small fn__flex-1"
                        style="width: 100%; box-sizing: border-box; padding-left: 10px; padding-right: 28px; height: 28px; font-size: 12px; border-radius: var(--indexos-radius-sm, 6px);"
                        placeholder="搜索超级标签..."
                        bind:value={searchQuery}
                    />
                    <svg style="position: absolute; right: 8px; width: 13px; height: 13px; color: var(--indexos-text-muted); pointer-events: none;"><use xlink:href="#iconSearch"></use></svg>
                </div>
            </div>
        {:else if activeTab === 'commands'}
            <div class="fn__flex" style="align-items: center; gap: 8px;">
                <button
                    class="indexos-btn-bordered"
                    style="font-size: 11px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 4px;"
                    title="配置顶栏、底栏、侧栏与右键快捷菜单入口"
                    on:click={openEntryConfigDialog}
                >
                    <span>🧭 UI 入口</span>
                </button>

                <button
                    class="indexos-btn-bordered"
                    style="font-size: 11px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 4px;"
                    title="后台自动化定时与事件触发引擎"
                    on:click={openGlobalAutomationDialog}
                >
                    <span>⏰ 后台执行</span>
                </button>

                <button
                    class="indexos-btn-bordered"
                    style="font-size: 11px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 4px;"
                    title={i18n.initSystemDBHint}
                    on:click={handleInitSystem}
                >
                    <svg style="width: 12px; height: 12px; fill: currentColor;"><use xlink:href="#iconDatabase"></use></svg>
                    <span>{i18n.initSystemDB}</span>
                </button>

                <!-- 搜索框 -->
                <div style="position: relative; display: flex; align-items: center; width: 170px;">
                    <input
                        class="b3-text-field b3-text-field--small fn__flex-1"
                        style="width: 100%; box-sizing: border-box; padding-left: 10px; padding-right: 28px; height: 28px; font-size: 12px; border-radius: var(--indexos-radius-sm, 6px);"
                        placeholder="搜索指令..."
                        bind:value={commandSearchQuery}
                    />
                    <svg style="position: absolute; right: 8px; width: 13px; height: 13px; color: var(--indexos-text-muted); pointer-events: none;"><use xlink:href="#iconSearch"></use></svg>
                </div>
            </div>
        {/if}
    </div>

    <!-- 新建标签输入行 (Inline Create) -->
    {#if activeTab === 'supertags' && showCreateInput}
        <div class="inline-create-box" style="padding: 8px 16px; background: var(--b3-theme-surface-lighter); border-bottom: 1px dashed var(--indexos-border-subtle); display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: bold; font-family: monospace; font-size: 14px; color: var(--indexos-accent-primary);">#</span>
            <!-- svelte-ignore a11y-autofocus -->
            <input
                class="b3-text-field b3-text-field--small fn__flex-1"
                style="height: 28px; font-size: 12px;"
                placeholder="输入标签名称 (如 book, review, todo...)"
                bind:value={newTagName}
                on:keydown={(e) => { if (e.key === 'Enter') handleCreateNewTag(); if (e.key === 'Escape') showCreateInput = false; }}
                autofocus
            />
            <button class="b3-button b3-button--small b3-button--primary" on:click={handleCreateNewTag}>
                创建并关联数据库
            </button>
            <button class="b3-button b3-button--small b3-button--cancel" on:click={() => { showCreateInput = false; newTagName = ''; }}>
                取消
            </button>
        </div>
    {/if}

    <!-- Tab 1: 超级标签管理主面板 -->
    {#if activeTab === 'supertags'}
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
                    <p style="font-size: 0.9em; opacity: 0.6;">可通过上方【新建标签】、【导入预设】或在正文中输入 @ 快速创建</p>
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
                            style="font-weight: bold; opacity: 0.7; flex: 2.8; min-width: 140px; align-items: center;"
                        >
                            <span>超级标签 (Tag)</span>
                        </div>
                        <div
                            class="b3-list-item__text fn__flex"
                            style="font-weight: bold; opacity: 0.7; flex: 3.0; min-width: 160px; align-items: center;"
                        >
                            <span>数据库 (Database)</span>
                        </div>
                        <div
                            class="b3-list-item__text fn__flex"
                            style="font-weight: bold; opacity: 0.7; flex: 2.2; min-width: 120px; align-items: center;"
                        >
                            <span>命令 (Commands)</span>
                        </div>
                        <div
                            class="b3-list-item__text fn__flex"
                            style="font-weight: bold; opacity: 0.8; flex: 1.0; justify-content: flex-end; align-items: center; gap: 6px;"
                        >
                            <button
                                class="indexos-btn-bordered"
                                title="批量切换所有 Supertag 的推荐状态"
                                on:click={handleToggleAllSmart}
                            >
                                <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconRefresh"></use></svg>
                                <span>开关</span>
                            </button>
                        </div>
                    </div>

                    {#each filteredList as group}
                        <div
                            class="b3-list-item {group.hasDataSchema || group.hasBehavior ? 'supertag-row--ready' : 'supertag-row--pending'}"
                            style="display: flex; align-items: center; padding: 10px 16px; min-height: 52px; box-sizing: border-box; flex-shrink: 0; {group.hasDataSchema || group.hasBehavior ? '' : 'opacity: 0.72;'}"
                        >
                            <!-- 1. Tag Column (2.8 flex) -->
                            <div
                                class="b3-list-item__text fn__flex"
                                style="flex: 2.8; min-width: 140px; align-items: center; gap: 6px; overflow: hidden; padding-right: 8px;"
                            >
                                <svg
                                    class="b3-list-item__graphic"
                                    style="color: {group.hasDataSchema || group.hasBehavior ? 'var(--indexos-accent-primary)' : 'var(--indexos-text-muted)'}; width: 14px; height: 14px; flex-shrink: 0; margin: 0;"
                                    ><use xlink:href="#iconTags"></use></svg
                                >
                                <span
                                    style="font-weight: 600; font-family: ui-monospace, monospace; line-height: 1.2; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: var(--indexos-text-main); font-size: 13px; max-width: 170px; flex-shrink: 1;"
                                    title="#{group.typeName}"
                                >
                                    #{group.typeName}
                                </span>
                                
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

                            <!-- 2. Database Column (3.0 flex) - 严格同名匹配与 data-dbs 快速创建 -->
                            <div
                                class="b3-list-item__text fn__flex"
                                style="flex: 3.0; min-width: 160px; align-items: center; gap: 8px; overflow: hidden; padding-right: 8px;"
                            >
                                {#if group.isDuplicateName}
                                    <div class="fn__flex" style="align-items: center; gap: 8px;">
                                        <span
                                            class="indexos-tag-badge"
                                            style="color: var(--indexos-danger, #EF4444) !important; font-size: 11px; flex-shrink: 0;"
                                            title="工作区内存在多个同名数据库，请在思源中重命名以消除歧义"
                                        >
                                            <span class="badge-dot" style="background-color: var(--indexos-danger, #EF4444) !important;"></span>重名 ({group.matchedCount})
                                        </span>
                                        {#if group.selectedAvId || (group.matchedAvBlocks && group.matchedAvBlocks.length > 0)}
                                            <button
                                                class="indexos-btn-bordered"
                                                style="font-size: 11px; padding: 2px 7px; flex-shrink: 0;"
                                                title="在编辑器中循环定位打开同名数据库"
                                                on:click={() => locateAv(group)}
                                            >
                                                <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconFocus"></use></svg>
                                                <span>定位</span>
                                            </button>
                                        {/if}
                                    </div>
                                {:else if group.hasDataSchema}
                                    <div
                                        class="fn__flex"
                                        style="align-items: center; gap: 8px;"
                                    >
                                        <!-- 已关联数据库标注 (无框小圆点风格 + 数据库图标) -->
                                        <span
                                            class="indexos-tag-badge"
                                            style="color: #059669 !important; font-size: 11px; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;"
                                            title="已关联同名数据库"
                                        >
                                            <span class="badge-dot" style="background-color: #10B981 !important;"></span>
                                            <span>已关联</span>
                                            <svg style="width: 12px; height: 12px; fill: currentColor; opacity: 0.85; flex-shrink: 0;"><use xlink:href="#iconDatabase"></use></svg>
                                        </span>

                                        <!-- 定位按钮 -->
                                        <button
                                            class="indexos-btn-bordered"
                                            style="font-size: 11px; padding: 2px 7px; flex-shrink: 0;"
                                            title="在编辑器中定位打开该数据库"
                                            on:click={() => locateAv(group)}
                                        >
                                            <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconFocus"></use></svg>
                                            <span>定位</span>
                                        </button>

                                        <!-- 数据库设置按钮 ⚙️ -->
                                        <button
                                            class="indexos-btn-bordered"
                                            style="font-size: 11px; padding: 2px 7px; flex-shrink: 0;"
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
                                    </div>
                                {:else}
                                    <div class="fn__flex" style="align-items: center; gap: 6px;">
                                        <button
                                            class="indexos-btn-bordered"
                                            style="font-size: 11px; padding: 3px 10px; color: var(--indexos-accent-primary); border-color: rgba(59, 130, 246, 0.4); background: rgba(59, 130, 246, 0.06); font-weight: 500;"
                                            title="在 data-dbs 页面创建同名数据库"
                                            on:click={() => handleCreateDatabase(group)}
                                        >
                                            <svg style="width: 12px; height: 12px; fill: currentColor;"><use xlink:href="#iconDatabase"></use></svg>
                                            <span>+ 创建数据库</span>
                                        </button>
                                    </div>
                                {/if}
                            </div>

                            <!-- 3. Commands Column (2.2 flex) -->
                            <div
                                class="b3-list-item__text fn__flex"
                                style="flex: 2.2; min-width: 120px; align-items: center; gap: 6px; overflow: hidden; padding-right: 8px;"
                            >
                                <button
                                    class="indexos-btn-bordered"
                                    style="font-size: 11px; padding: 2px 8px; flex-shrink: 0; {group.hasBehavior ? 'color: var(--indexos-detached-gold, #D9A74A) !important; border: 1px solid var(--indexos-detached-gold, #D9A74A) !important; background: var(--indexos-detached-gold-bg, rgba(217, 167, 74, 0.08)) !important; font-weight: 600;' : 'color: var(--indexos-accent-primary); border: 1px solid var(--indexos-index-blue, #A1C4E6) !important;'}"
                                    title="配置该标签的手动命令与自动触发规则"
                                    on:click={() => openTriggerConfig(group)}
                                >
                                    <svg style="width: 11px; height: 11px; fill: currentColor;"><use xlink:href="#iconSettings"></use></svg>
                                    <span>命令设置</span>
                                </button>
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
    {:else}
        <!-- Tab 2: 命令管理主面板 -->
        <div
            class="b3-dialog__content fn__flex-1"
            style="padding: 16px; overflow-y: auto; min-height: 0; flex: 1 1 0%;"
        >
            <CommandsPanel bind:searchQuery={commandSearchQuery} />
        </div>
    {/if}

    <div class="b3-dialog__action">
        <button
            class="b3-button b3-button--primary btn-primary"
            on:click={() => dialog.destroy()}>{i18n.confirm}</button
        >
    </div>
</div>

<style>
    .indexos-tab-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        font-size: 13px;
        font-weight: 600;
        color: var(--indexos-text-muted, #5A6D82);
        background: transparent;
        border: none;
        border-radius: var(--indexos-radius-sm, 6px);
        cursor: pointer;
        transition: all 0.15s ease;
    }
    .indexos-tab-btn:hover {
        background: var(--indexos-bg-hover, rgba(0, 0, 0, 0.04));
        color: var(--indexos-text-main, #0F243B);
    }
    .indexos-tab-btn.active {
        background: var(--indexos-accent-light, rgba(59, 130, 246, 0.12));
        color: var(--indexos-accent-primary, #3B82F6);
    }
    .tab-count-badge {
        font-size: 11px;
        font-weight: 500;
        padding: 1px 6px;
        border-radius: 10px;
        background: var(--indexos-bg-container, rgba(0, 0, 0, 0.06));
        color: inherit;
    }
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
