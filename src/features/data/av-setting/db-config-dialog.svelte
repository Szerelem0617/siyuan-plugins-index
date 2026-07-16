<script lang="ts">
    import {
        saveDbConfig,
        syncInheritanceToDb,
        resetDbConfig,
    } from "./db-config";
    import type { DbConfig, IDBTypeMapping } from "./types";
    import { showMessage } from "siyuan";
    import { i18n } from "../../../shared/utils";

    export let avId: string;
    export let blockId: string;
    export let currentConfig: DbConfig;
    export let columns: any[];
    export let dialog: any;
    export let dbName = "";

    let activeTab = "type"; // type | inheritance
    let enableSupertag = currentConfig.enableSupertag !== false;
    let typeFieldId = currentConfig.typeFieldId || "";
    let typeMappings: IDBTypeMapping[] = currentConfig.typeMappings || [];
    let inheritanceRules = currentConfig.inheritanceRules || [];

    const reset = async () => {
        if (window.confirm(i18n.dbConfig.resetPrompt)) {
            await resetDbConfig(blockId, avId);
            dialog.destroy();
        }
    };

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

    import { onMount } from "svelte";
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
            enableSupertag,
            typeFieldId: typeFieldId,
            typeMappings: activeMappings,
            inheritanceRules: finalInheritanceRules as any,
        };

        await saveDbConfig(blockId, config);

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

    $: pinnedColumns = columns.filter((c) => c.isPinned);
    $: normalColumns = columns.filter((c) => {
        if (c.isPinned) return false;
        if (c.isPrimary) return false;
        if (c.isSystem) return false;
        return true;
    });
    import { executeWritableSql, runQuery } from "../../sqlite/sqlite-manager";
    import { post } from "../../../shared/api-client/request";

    async function handleCreateSubtagView(map: any) {
        if (!map.name) {
            showMessage("请输入子标签名后再创建视图", 3000, "info");
            return;
        }

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
                    enableSupertag,
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
        }
    }
</script>

<div
    class="fn__flex-column"
    style="height: 100%; padding: 12px; box-sizing: border-box;"
>
    <!-- Tabs -->
    <div
        class="fn__flex"
        style="margin-bottom: 16px; border-bottom: 1px solid var(--b3-theme-surface-lighter); flex-shrink: 0;"
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

    <div style="flex: 1; overflow-y: auto; overflow-x: hidden;">
        {#if activeTab === "type"}
            <div class="config-section" style="padding: 4px;">
                <!-- Supertag Toggle Switch -->
                <div
                    class="fn__flex"
                    style="margin-bottom: 16px; align-items: center; justify-content: space-between;"
                >
                    <span
                        class="b3-label"
                        style="margin: 0; font-weight: bold; font-size: 14px;"
                    >
                        启用 Supertag 功能
                    </span>
                    <label class="fn__flex" style="align-items: center; cursor: pointer;">
                        <input
                            type="checkbox"
                            class="b3-switch"
                            bind:checked={enableSupertag}
                        />
                    </label>
                </div>

                {#if enableSupertag}
                    <div style="background: var(--b3-theme-surface); padding: 12px; border-radius: 6px; border: 1px solid var(--b3-border-color); margin-bottom: 16px;">
                        <div style="font-weight: bold; font-size: 13px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                            🏷️ 超级标签将注册为：
                            <span class="b3-chip b3-chip--primary" style="font-family: monospace;">#{dbName.toLowerCase() || '表名'}</span>
                        </div>
                        <div class="b3-label__text" style="font-size: 12px; opacity: 0.8; line-height: 1.4;">
                            开启后，向任意块添加标签 <code style="color: #4ec9b0;">#{dbName.toLowerCase() || '表名'}</code> 将会自动把该块作为行录入到本数据库中。
                        </div>
                    </div>

                    <div class="fn__hr" style="margin-bottom: 16px;"></div>

                    <!-- Column selection for sub-type mappings -->
                    <label class="b3-label" style="font-weight: bold; margin-bottom: 8px; display: block;">
                        配置细分类型映射 (可选)
                        <div class="b3-form__icon" style="margin-top: 6px;">
                            <select
                                class="b3-select fn__block"
                                bind:value={typeFieldId}
                                on:change={() => {
                                    typeMappings = [];
                                    onTypeFieldChange();
                                }}
                            >
                                <option value="">-- 选择用于细分类型的列 --</option>

                                <optgroup label={i18n.dbConfig.systemProps}>
                                    {#each pinnedColumns as col}
                                        <option value={col.id}>
                                            📍 {col.name}
                                        </option>
                                    {/each}
                                </optgroup>

                                <optgroup label={i18n.dbConfig.columns}>
                                    {#each normalColumns as col}
                                        <option value={col.id}>{col.name}</option>
                                    {/each}
                                </optgroup>
                            </select>
                        </div>
                    </label>

                    {#if typeFieldId}
                        <div style="margin-top: 16px;">
                            <div class="b3-label" style="font-weight: bold; margin-bottom: 8px;">
                                细分值与 Sub-tag 映射配置
                            </div>
                            <div class="fn__hr" style="margin-bottom: 12px;"></div>
                            
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
                                        disabled={!map.name}
                                    >
                                        📊 创建视图
                                    </button>
                                </div>
                            {/each}

                        </div>
                    {/if}
                {:else}
                    <div style="text-align: center; padding: 40px 20px; opacity: 0.5; font-size: 13px;">
                        ⚠️ Supertag 功能已关闭。该数据库不会自动对超级标签的块进行自动录入。
                    </div>
                {/if}
            </div>
        {/if}

        {#if activeTab === "inheritance"}
            <div class="config-section">
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
                        <select
                            class="b3-select"
                            style="width: 140px;"
                            bind:value={item.mode}
                        >
                            <option value="none"
                                >{i18n.dbConfig.modeNone}</option
                            >
                            <option value="weak"
                                >{i18n.dbConfig.modeWeak}</option
                            >
                            <option value="strong"
                                >{i18n.dbConfig.modeStrong}</option
                            >
                        </select>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <div
        class="fn__flex"
        style="margin-top: 16px; justify-content: space-between; flex-shrink: 0;"
    >
        <div class="fn__flex">
            <button class="b3-button b3-button--cancel" on:click={reset}>
                <svg
                    class="b3-list-item__graphic"
                    style="height: 14px; width: 14px; margin-right: 4px;"
                    ><use xlink:href="#iconTrashcan"></use></svg
                >
                {i18n.dbConfig.reset}
            </button>
        </div>
        <div class="fn__flex">
            <button
                class="b3-button b3-button--cancel"
                on:click={() => dialog.destroy()}>{i18n.dbConfig.cancel}</button
            >
            <button class="b3-button" style="margin-left: 8px;" on:click={save}
                >{i18n.dbConfig.save}</button
            >
        </div>
    </div>
</div>

<style>
    .config-section {
        padding: 4px;
    }
</style>
