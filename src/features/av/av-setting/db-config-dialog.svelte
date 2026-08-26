<script lang="ts">
    import { onMount } from "svelte";
    import {
        saveDbConfig,
        syncInheritanceToDb,
    } from "./db-config";
    import type { DbConfig, IDBTypeMapping } from "./types";
    import { showMessage, Dialog } from "siyuan";
    import { i18n } from "../../../shared/utils";
    import { openIndexDropdown } from "../../../ui/components/index-dropdown";
    import { executeWritableSql, runQuery } from "../../sqlite/sqlite-manager";
    import { post } from "../../../shared/api-client/request";
    import FieldsConfigDialog from "./FieldsConfigDialog.svelte";

    export let avId: string;
    export let blockId: string;
    export let currentConfig: DbConfig;
    export let columns: any[];
    export let dialog: any;
    export let dbName = "";
    export let hasLinkedList = false;

    let activeTab = "type"; // type | inheritance
    let typeFieldId = currentConfig.typeFieldId || "";
    let typeMappings: IDBTypeMapping[] = currentConfig.typeMappings || [];
    let inheritanceRules = currentConfig.inheritanceRules || [];

    // List of columns to exclude from Inheritance settings
    const inheritanceDenyList = new Set([
        "level",
        "father",
        "parent_id",
        "path",
        "created",
        "updated",
        "id",
    ]);

    // Filter list for Inheritance: Remove System, Primary, and DenyList items
    let inheritanceList = columns
        .filter(
            (c) =>
                !c.isSystem &&
                !c.isPrimary &&
                !inheritanceDenyList.has(c.name.toLowerCase()),
        )
        .map((col) => {
            const existing = inheritanceRules.find((r) => r.colId === col.id);
            return {
                col,
                mode: existing?.mode || "none",
            };
        });

    onMount(() => {
        if (typeFieldId) {
            console.log("[DbConfig] Initial Field:", typeFieldId);
            onTypeFieldChange();
        }
    });

    $: selectedColumn = columns.find((c) => c.id === typeFieldId);

    // React to Type Field Change
    async function onTypeFieldChange() {
        if (!typeFieldId) return;
        console.log("[DbConfig] Field Selected:", typeFieldId);

        const selectedCol = columns.find((c) => c.id === typeFieldId);
        if (!selectedCol) {
            console.warn("[DbConfig] Column not found in list");
            return;
        }

        let potentialValues: string[] = [];

        if (selectedCol.values && selectedCol.values.length > 0) {
            const uniqueVals = new Set<string>();
            selectedCol.values?.forEach((v: any) => {
                let text = "";
                const type = v.type;

                if (type === "text") text = v.text?.content || "";
                else if (type === "number")
                    text =
                        v.number?.content !== undefined
                            ? String(v.number.content)
                            : "";
                else if (type === "select")
                    text = v.mOption?.[0]?.content || "";
                else if (type === "mSelect")
                    text =
                        v.mOption?.map((o: any) => o.content).join(",") || "";
                else if (type === "url") text = v.url?.content || "";
                else if (type === "email") text = v.email?.content || "";
                else if (type === "phone") text = v.phone?.content || "";
                else if (type === "date")
                    text =
                        v.date && v.date.content ? String(v.date.content) : "";
                else if (type === "checkbox")
                    text = v.checkbox?.checked ? "true" : "false";

                text = text.trim();
                if (text) uniqueVals.add(text);
            });
            potentialValues = Array.from(uniqueVals).filter((v) => v !== "");
        }

        // Merge with existing mappings
        const newMappings: IDBTypeMapping[] = [];
        potentialValues.forEach((val) => {
            const existing = typeMappings.find((m) => m.value === val);
            newMappings.push({
                value: val,
                name: existing?.name || "",
                viewId: existing?.viewId,
            });
        });

        // Keep explicit existing mappings
        typeMappings.forEach((m) => {
            if (!newMappings.find((nm) => nm.value === m.value)) {
                newMappings.push(m);
            }
        });

        // Sort
        newMappings.sort((a, b) => {
            if (a.value === "") return -1;
            if (b.value === "") return 1;
            const numA = parseFloat(a.value);
            const numB = parseFloat(b.value);
            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
            }
            return a.value.localeCompare(b.value);
        });

        typeMappings = newMappings;
    }

    const save = async () => {
        const activeMappings = typeMappings.filter((m) => m.name.trim() !== "");

        const finalInheritanceRules = inheritanceList
            .filter((i) => i.mode !== "none")
            .map((i) => ({ colId: i.col.id, mode: i.mode }));

        const config: DbConfig = {
            avId,
            typeFieldId: typeFieldId,
            typeMappings: activeMappings,
            inheritanceRules: finalInheritanceRules as any,
        };

        await saveDbConfig(blockId, config);

        // Trigger Supertag Manager UI & Monitor Refresh Immediately
        window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));

        // Trigger Materialized Sync
        try {
            showMessage(i18n.dbConfig.savingRules, 2000);
            const updatedCount = await syncInheritanceToDb(
                avId,
                config,
                blockId,
            );
            if (updatedCount > 0) {
                showMessage(
                    `${i18n.dbConfig.saveSyncSuccess} ${updatedCount} ${i18n.dbConfig.saveSyncSuccessCells}`,
                );
            } else {
                showMessage(i18n.dbConfig.saveNoChange);
            }
        } catch (e) {
            showMessage(i18n.dbConfig.saveError, 3000, "error");
        }

        dialog.destroy();
    };

    let customValue = "";
    let customSubtag = "";

    function handleAddCustomMapping() {
        const val = customValue.trim();
        const tag = customSubtag.trim();
        if (!val) {
            showMessage("请输入要绑定的属性值", 3000, "info");
            return;
        }
        if (!tag) {
            showMessage("请输入对应的 Sub-tag 名称", 3000, "info");
            return;
        }

        const existingIdx = typeMappings.findIndex(m => m.value === val);
        if (existingIdx >= 0) {
            typeMappings[existingIdx].name = tag;
        } else {
            typeMappings = [...typeMappings, { value: val, name: tag }];
        }
        customValue = "";
        customSubtag = "";
        showMessage(`✓ 已添加映射: ${val} ➔ #${dbName.toLowerCase()}.${tag}`);
    }

    $: pinnedColumns = columns.filter((c) => c.isPinned);
    $: normalColumns = columns.filter((c) => {
        if (c.isPinned) return false;
        if (c.isPrimary) return false;
        if (c.isSystem) return false;
        return true;
    });

    $: typeFieldOptions = [
        { value: "", label: "-- 选择sub-tag的相关列 --" },
        ...pinnedColumns.map(col => ({ value: col.id, label: `📍 ${col.name} (${i18n.dbConfig.systemProps || "系统属性"})` })),
        ...normalColumns.map(col => ({ value: col.id, label: `${col.name} (${i18n.dbConfig.columns || "自定义属性"})` }))
    ];
    $: typeFieldLabel = typeFieldOptions.find(o => o.value === typeFieldId)?.label || "-- 选择sub-tag的相关列 --";

    let creatingViews = new Set();

    async function handleCreateSubtagView(map: any) {
        if (!map.name) {
            showMessage("请输入子标签名后再创建视图", 3000, "info");
            return;
        }

        if (creatingViews.has(map.value)) {
            console.log("[DbConfig] View creation for this value is already in progress, ignoring click.");
            return;
        }
        creatingViews.add(map.value);
        creatingViews = creatingViews;

        try {
            // 1. Fetch live AV views to check if map.viewId still exists using SQL
            let viewExists = false;
            try {
                const sqlQuery = `SELECT id, name FROM _av_views WHERE av_id = '${avId}'`;
                console.log("[DbConfig-Debug] Querying views list with SQL:", sqlQuery);
                const queryRes = await runQuery(sqlQuery);
                console.log("[DbConfig-Debug] Query result:", queryRes);
                
                const idIdx = queryRes.columns.indexOf("id");
                const viewsList = queryRes.values.map(row => ({
                    id: row[idIdx]
                }));
                console.log("[DbConfig-Debug] Extracted views list:", viewsList);
                console.log("[DbConfig-Debug] Target map.viewId:", map.viewId);
                if (map.viewId && viewsList.some((v: any) => v.id === map.viewId)) {
                    viewExists = true;
                }
                console.log("[DbConfig-Debug] viewExists result:", viewExists);
            } catch (err) {
                console.warn("[DbConfig] Failed to fetch live AV views via SQL:", err);
            }

            if (viewExists) {
                // If it already exists, just switch to it
                showMessage("⏳ 视图已存在，正在为您切换...", 2000);
                await post("/api/transactions", {
                    reqId: Date.now(),
                    app: "plugin-index",
                    transactions: [{
                        doOperations: [{
                            action: "setAttrViewBlockView",
                            avID: avId,
                            id: map.viewId,
                            blockID: blockId
                        }]
                    }]
                });
                showMessage(`✓ 已切换至现有视图: ${map.name}`);
                return;
            }

            const cleanAvId = avId.replace(/[^a-zA-Z0-9]/g, "_");
            const tableName = `av_${cleanAvId}`;
            const viewName = map.name;
            const columnName = selectedColumn?.name || "";
            const valueVal = map.value;

            // Execute SQL: CREATE TABLE VIEW [viewName] AS SELECT * FROM [tableName] WHERE [columnName] = '[valueVal]'
            const sql = `CREATE TABLE VIEW "${viewName}" AS SELECT * FROM "${tableName}" WHERE "${columnName}" = '${valueVal}'`;
            console.log("[DbConfig] Creating subtag view with SQL:", sql);
            
            showMessage("⏳ 正在创建过滤视图...", 2000);
            const res = await executeWritableSql(sql);
            if (res && res.success && res.viewId) {
                // Save view ID into mapping configuration
                map.viewId = res.viewId;
                
                // Immediately persist the config changes to Siyuan
                const activeMappings = typeMappings.filter((m) => m.name.trim() !== "");
                const finalInheritanceRules = inheritanceList
                    .filter((i) => i.mode !== "none")
                    .map((i) => ({ colId: i.col.id, mode: i.mode }));

                const config: DbConfig = {
                    avId,
                    typeFieldId,
                    typeMappings: activeMappings,
                    inheritanceRules: finalInheritanceRules as any,
                };
                await saveDbConfig(blockId, config);

                showMessage(`✓ 成功创建过滤视图: ${viewName}`);
            } else {
                showMessage(`创建视图失败: ${res?.message || "未知错误"}`);
            }
        } catch (e: any) {
            console.error("[DbConfig] Failed to create/switch subtag view:", e);
            showMessage(`操作失败: ${e.message || e}`, 5000, "error");
        } finally {
            creatingViews.delete(map.value);
            creatingViews = creatingViews;
        }
    }

    function handleConfigureFields(map: any) {
        if (!map.viewId) {
            showMessage("未创建视图，无法配置字段", 3000, "info");
            return;
        }

        const subDialog = new Dialog({
            title: `配置字段 - ${map.name}`,
            content: `<div class="b3-dialog__content" id="fields-config-container"></div>`,
            width: "400px",
            height: "500px"
        });
        subDialog.element.classList.add("indexos-dialog");

        new FieldsConfigDialog({
            target: document.getElementById("fields-config-container")!,
            props: {
                avId: avId,
                viewId: map.viewId,
                viewName: map.name,
                dialog: subDialog
            }
        });
    }

    $: modeOptions = [
        { value: "none", label: i18n.dbConfig.modeNone || "不继承" },
        { value: "weak", label: i18n.dbConfig.modeWeak || "弱继承" },
        { value: "strong", label: i18n.dbConfig.modeStrong || "强继承" }
    ];

    function getModeLabel(mode: string) {
        if (mode === "weak") return i18n.dbConfig.modeWeak || "弱继承";
        if (mode === "strong") return i18n.dbConfig.modeStrong || "强继承";
        return i18n.dbConfig.modeNone || "不继承";
    }

    function updateInheritanceMode(item: any, val: any) {
        item.mode = val as "strong" | "none" | "weak";
        inheritanceList = [...inheritanceList];
    }
</script>

<div
    class="fn__flex-column"
    style="height: 100%; padding: 16px; box-sizing: border-box; background: var(--indexos-bg-base); color: var(--indexos-text-main);"
>
    <!-- 顶部标题 -->
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <span>⚙️ {i18n.dbConfig.dialogTitle || "数据库设置"}</span>
        {#if dbName}
            <span style="font-size: 11px; font-weight: normal; opacity: 0.6; font-family: monospace;">#{dbName}</span>
        {/if}
    </div>

    <!-- Tabs (只有绑定了 index-linked-list 时才渲染 Tabs 选择栏) -->
    {#if hasLinkedList}
        <div
            class="fn__flex"
            style="margin-bottom: 16px; border-bottom: 1px solid var(--indexos-border-divider); flex-shrink: 0;"
        >
            <button
                class="b3-button b3-button--text {activeTab === 'type'
                    ? 'b3-button--primary'
                    : ''}"
                on:click={() => (activeTab = "type")}
            >
                {i18n.dbConfig.tabType}
            </button>
            <button
                class="b3-button b3-button--text {activeTab === 'inheritance'
                    ? 'b3-button--primary'
                    : ''}"
                on:click={() => (activeTab = "inheritance")}
            >
                {i18n.dbConfig.tabInheritance}
            </button>
        </div>
    {/if}

    <div style="flex: 1; overflow-y: auto; overflow-x: hidden;">
        {#if activeTab === "type"}
            <div class="config-section" style="padding: 4px;">
                <div style="background: var(--indexos-bg-card); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--indexos-border-subtle); margin-bottom: 12px; color: var(--indexos-text-main);">
                    <div class="b3-label__text" style="font-size: 12px; color: var(--indexos-text-main); line-height: 1.5;">
                        <div>当启用该 Supertag后，向任意块添加该Supertag将会自动把该块作为行录入到本数据库中。</div>
                        <div style="margin-top: 4px; color: var(--indexos-text-muted);">如果配置了sub-tag，向任意块添加该sub-tag还会对一个属性进行赋值。</div>
                    </div>
                </div>

                <!-- Column selection for sub-type mappings -->
                <label class="b3-label" style="font-weight: bold; margin-bottom: 8px; display: block;">
                    配置sub-tag
                    <div class="b3-form__icon" style="margin-top: 6px;">
                        <button
                            class="b3-select fn__block fn__flex"
                            style="align-items: center; justify-content: space-between; width: 100%; height: 28px; padding: 4px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer; transition: all 0.15s ease;"
                            on:click={(e) => openIndexDropdown({
                                event: e,
                                options: typeFieldOptions,
                                selectedValue: typeFieldId,
                                onSelect: (val) => {
                                    typeFieldId = val;
                                    typeMappings = [];
                                    onTypeFieldChange();
                                }
                            })}
                        >
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                {typeFieldLabel}
                            </span>
                            <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.5; flex-shrink: 0; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
                        </button>
                    </div>
                </label>

                {#if typeFieldId}
                    <div style="margin-top: 16px;">
                        {#each typeMappings as map}
                            <div
                                class="fn__flex"
                                style="margin-bottom: 8px; align-items: center; gap: 8px;"
                            >
                                <div
                                    style="width: 180px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-shrink: 0;"
                                    title="{selectedColumn?.name}-{map.value}"
                                >
                                    <span class="b3-chip b3-chip--secondary">
                                        {selectedColumn?.name} = {map.value || "(空/未设置)"}
                                    </span>
                                </div>
                                <span style="opacity: 0.5;">➔</span>
                                
                                <div class="fn__flex-1" style="display: flex; align-items: center; gap: 4px;">
                                    <span style="opacity: 0.7; font-family: monospace; font-size: 12px;">#{dbName.toLowerCase()}.</span>
                                    <input
                                        class="b3-input fn__flex-1"
                                        style="font-family: monospace;"
                                        placeholder="自定义子标签名 (如 male)"
                                        bind:value={map.name}
                                    />
                                </div>
                                <button
                                    class="b3-button b3-button--outline"
                                    style="font-size: 10px; padding: 4px 8px; flex-shrink: 0;"
                                    on:click={() => handleCreateSubtagView(map)}
                                    disabled={!map.name || creatingViews.has(map.value)}
                                >
                                    📊 创建视图
                                </button>
                                {#if map.viewId}
                                    <button
                                        class="b3-button b3-button--outline"
                                        style="font-size: 10px; padding: 4px 8px; flex-shrink: 0;"
                                        on:click={() => handleConfigureFields(map)}
                                    >
                                        ⚙️ 筛选字段
                                    </button>
                                {/if}
                            </div>
                        {/each}

                        <!-- 自定义填值与命名行 -->
                        <div style="margin-top: 12px; padding: 10px; background: var(--indexos-bg-surface); border: 1px dashed var(--indexos-border-subtle); border-radius: 6px;">
                            <div style="font-size: 11px; font-weight: bold; margin-bottom: 6px; color: var(--indexos-text-muted);">
                                ➕ 手动自定义填值与命名新的 Sub-tag 映射
                            </div>
                            <div class="fn__flex" style="align-items: center; gap: 8px;">
                                <input
                                    class="b3-input fn__flex-1"
                                    style="font-size: 11px;"
                                    placeholder="输入要绑定的属性值 (如 高级)"
                                    bind:value={customValue}
                                />
                                <span style="opacity: 0.5;">➔</span>
                                <div class="fn__flex-1" style="display: flex; align-items: center; gap: 4px;">
                                    <span style="opacity: 0.7; font-family: monospace; font-size: 11px;">#{dbName.toLowerCase()}.</span>
                                    <input
                                        class="b3-input fn__flex-1"
                                        style="font-family: monospace; font-size: 11px;"
                                        placeholder="子标签名 (如 high)"
                                        bind:value={customSubtag}
                                    />
                                </div>
                                <button
                                    class="indexos-btn-bordered"
                                    style="font-size: 11px; padding: 4px 10px; flex-shrink: 0;"
                                    on:click={handleAddCustomMapping}
                                >
                                    添加
                                </button>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}

        {#if activeTab === "inheritance" && hasLinkedList}
            <div class="config-section" style="padding: 4px;">
                {#each inheritanceList as item}
                    <div
                        class="fn__flex"
                        style="margin-bottom: 8px; align-items: center; border-bottom: 1px dashed var(--b3-theme-surface-lighter); padding-bottom: 4px;"
                    >
                        <div class="fn__flex-1">
                            <div
                                style="font-weight: bold; display: flex; align-items: center;"
                            >
                                {item.col.col?.name || item.col.name}
                            </div>
                            <div
                                class="b3-label__text"
                                style="font-size: 12px;"
                            >
                                {item.col.type}
                            </div>
                        </div>
                        <button
                            class="b3-select fn__flex"
                            style="align-items: center; justify-content: space-between; width: 140px; height: 26px; padding: 2px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer; transition: all 0.15s ease;"
                            on:click={(e) => {
                                openIndexDropdown({
                                    event: e,
                                    options: modeOptions,
                                    selectedValue: item.mode,
                                    onSelect: (val) => updateInheritanceMode(item, val)
                                });
                            }}
                        >
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                {getModeLabel(item.mode)}
                            </span>
                            <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.5; flex-shrink: 0; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <div
        class="fn__flex"
        style="margin-top: 16px; justify-content: flex-end; gap: 8px; flex-shrink: 0;"
    >
        <button
            class="b3-button b3-button--cancel"
            on:click={() => dialog.destroy()}>{i18n.dbConfig.cancel}</button
        >
        <button class="b3-button" on:click={save}
            >{i18n.dbConfig.save}</button
        >
    </div>
</div>

<style>
    .config-section {
        padding: 4px;
    }
</style>
