<script lang="ts">
    import { onMount } from "svelte";
    import { openDbConfigDialog } from "../../av/av-setting/db-config";
    import { i18n, plugin, confirmDialog } from "../../../shared/utils";
    import { supertagBinder } from "../core/supertag-binder";
    import { showMessage, openTab, Dialog } from "siyuan";
    import { getUnifiedSupertagList, type UnifiedSupertagDefinition } from "../core/supertag-entity";
    import { post } from "../../../shared/api-client/request";
    import { openSupertagUnifiedConfigByTag } from "../../command/av-interaction/type-db-handler";

    export let dialog: any;

    let loading = true;
    let searchQuery = "";
    let supertagList: UnifiedSupertagDefinition[] = [];

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
            stmt: `SELECT id FROM blocks WHERE id = '${targetId}' OR (type = 'av' AND (markdown LIKE '%${targetId}%' OR ial LIKE '%${targetId}%')) LIMIT 1`
        }).then((res) => {
            const targetBlockId = (res && res.length > 0) ? res[0].id : targetId;
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
            openTab({
                app: plugin.app,
                doc: {
                    id: targetId,
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

    import { NOTEBOOK_NAME, DATA_DBS_CONFIG } from "../../command/indexos/seed-data";
    import { getOrCreateDataDbsParentDoc } from "../../command/data-db-management";
    import { supertagAVProjector } from "../projection/supertag-av-projector";

    async function handleCreateDatabase(group: UnifiedSupertagDefinition) {
        try {
            const tagName = group.typeName;
            showMessage(`正在为 #${tagName} 在 data-dbs 中创建同名数据库...`, 3000, "info");
            
            // 1. 获取目标笔记本 (优先 IndexOS 笔记本，否则首个打开的笔记本)
            const nbRes = await post("/api/notebook/lsNotebooks", {});
            const notebooks = nbRes?.notebooks || [];
            const targetNotebook = notebooks.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed) || notebooks.find((n: any) => !n.closed) || notebooks[0];
            if (!targetNotebook) {
                showMessage("未找到可用笔记本", 4000, "error");
                return;
            }

            // 2. 确保 /data-dbs 父文档存在
            await getOrCreateDataDbsParentDoc(targetNotebook.id);

            // 3. 在 /data-dbs 下创建名为 tagName 的子文档，并在文档内放置同名 AV 块
            const docPath = `/${DATA_DBS_CONFIG.title}/${tagName}.sy`;
            const mdContent = `# ${tagName}\n\n<div data-type="NodeAttributeView" data-av-type="table" name="${tagName}" custom-av-name="${tagName}"></div>\n`;
            
            const createRes = await post("/api/filetree/createDocWithMd", {
                notebook: targetNotebook.id,
                path: docPath,
                markdown: mdContent
            });
            const docId = createRes;

            // 4. 等待索引建立并获取生成的 AV 块 ID
            await new Promise(r => setTimeout(r, 600));

            let avId = "";
            let avBlockId = "";
            const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
            const avRes = await post("/api/query/sql", { stmt: avSql });

            if (avRes && avRes.length > 0) {
                avBlockId = avRes[0].id;
                try {
                    const domRes = await post("/api/block/getBlockDOM", { id: avBlockId });
                    const html = domRes?.data?.dom || domRes?.dom || "";
                    const match = html.match(/data-av-id="([^"]+)"/);
                    avId = match ? match[1] : avBlockId;
                } catch (_) {
                    avId = avBlockId;
                }
            }

            if (!avId) {
                avId = docId;
            }

            // 5. 唤醒并设置 AV 块自定义属性与 supertag-db 关联
            if (avId) {
                try {
                    await post("/api/av/renderAttributeView", { id: avId });
                } catch (_) {}
                if (avBlockId) {
                    try {
                        await post("/api/attr/setBlockAttrs", {
                            id: avBlockId,
                            attrs: {
                                "custom-supertag-tag": tagName,
                                "custom-supertag-id": tagName,
                                name: tagName,
                                "custom-av-name": tagName
                            }
                        });
                    } catch (_) {}
                }

                // 同步更新 supertag-db 系统表
                try {
                    const { db } = await getSqliteEngine();
                    const check = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='supertag-db';`);
                    if (check.length > 0 && check[0].values.length > 0) {
                        db.run(`UPDATE "supertag-db" SET "related_av" = ?, _updated = ? WHERE LOWER("主键") = ?;`, [avId, Date.now(), tagName.toLowerCase()]);
                    }
                } catch (_) {}
                
                // 自动双向绑定 Supertag
                await supertagBinder.setPref(tagName, avId);
                supertagAVProjector.bindTagToAV(tagName, avId);
            }

            await loadData();
            showMessage(`✓ 成功为 #${tagName} 在 data-dbs 中创建并关联同名数据库！`, 3000);
        } catch (e: any) {
            console.error("Failed to create database for supertag:", e);
            showMessage(`创建数据库失败: ${e.message || e}`, 5000, "error");
        }
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
            <!-- 搜索框：图标右置，输入体验更佳 -->
            <div style="position: relative; display: flex; align-items: center; width: 200px;">
                <input
                    class="b3-text-field b3-text-field--small fn__flex-1"
                    style="width: 100%; box-sizing: border-box; padding-left: 10px; padding-right: 28px; height: 28px; font-size: 12px; border-radius: var(--indexos-radius-sm, 6px);"
                    placeholder="搜索超级标签..."
                    bind:value={searchQuery}
                />
                <svg style="position: absolute; right: 8px; width: 13px; height: 13px; color: var(--indexos-text-muted); pointer-events: none;"><use xlink:href="#iconSearch"></use></svg>
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
