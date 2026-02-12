<script lang="ts">
    import { saveDbConfig, type DbConfig } from "./db-config";
    import { showMessage } from "siyuan";

    export let blockId: string;
    export let currentConfig: DbConfig;
    export let columns: any[];
    export let dialog: any;

    let activeTab = "type"; // type | inheritance

    let typeFieldId = currentConfig.typeFieldId || "";
    let typeMappings = currentConfig.typeMappings || [];
    let inheritanceRules = currentConfig.inheritanceRules || [];

    // List of columns to exclude from Inheritance settings
    const inheritanceDenyList = new Set([
        "level",
        "icon",
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

        console.log(
            `[DbConfig] 1. User selected column: ${selectedCol.name} (ID: ${selectedCol.id})`,
        );
        console.log("[DbConfig] Column Definition:", selectedCol);

        let potentialValues: string[] = [];

        console.log(
            `[DbConfig] 2. Searching database column '${selectedCol.name}' for values...`,
        );

        // 1. Try configuration values (Select/mSelect options)
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
            console.log(
                `[DbConfig] Found ${potentialValues.length} unique values from column data.`,
            );
        }

        // 2. Fallback Scan removed as per architectural clarification (AV data not in IAL)
        /*
        if (potentialValues.length === 0) {
            // ... (removed)
        }
        */

        console.log(
            `[DbConfig] 3. Found total potential values:`,
            potentialValues,
        );

        // Merge with existing mappings
        const newMappings: any[] = [];
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

        // Sort: Empty first, then alphabetical
        newMappings.sort((a, b) => {
            if (a.value === "") return -1;
            if (b.value === "") return 1;
            // Try numeric sort for values like "1", "2", "10"
            const numA = parseFloat(a.value);
            const numB = parseFloat(b.value);
            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
            }
            return a.value.localeCompare(b.value);
        });

        typeMappings = newMappings;
        console.log("[DbConfig] Final Mappings for UI:", typeMappings);
    }

    const save = async () => {
        const finalInheritanceRules = inheritanceList
            .filter((i) => i.mode !== "none")
            .map((i) => ({ colId: i.col.id, mode: i.mode }));

        const config: DbConfig = {
            typeFieldId,
            typeMappings: typeMappings.filter((m) => m.name.trim() !== ""),
            inheritanceRules: finalInheritanceRules as any,
        };

        await saveDbConfig(blockId, config);
        showMessage("设置已保存 / Settings Saved");
        dialog.destroy();
    };

    // Derived lists for Dropdown
    $: pinnedColumns = columns.filter((c) => c.isPinned);
    $: normalColumns = columns.filter((c) => {
        if (c.isPinned) return false;
        if (c.isPrimary) return false;
        if (c.isSystem) return false; // Filter out other system columns if any
        return true;
    });
</script>

<div
    class="fn__flex-column"
    style="height: 100%; padding: 12px; box-sizing: border-box;"
>
    <!-- ... Tabs ... -->
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
            Type Settings
        </button>
        <button
            class="b3-button b3-button--text {activeTab === 'inheritance'
                ? 'b3-button--primary'
                : ''}"
            on:click={() => (activeTab = "inheritance")}
        >
            Inheritance Settings
        </button>
    </div>

    <div style="flex: 1; overflow-y: auto; overflow-x: hidden;">
        {#if activeTab === "type"}
            <div class="config-section">
                <!-- Dropdown (unchanged) -->
                <label class="b3-label">
                    Type Determined By Check:
                    <div class="b3-form__icon">
                        <select
                            class="b3-select fn__block"
                            bind:value={typeFieldId}
                            on:change={() => {
                                // Clear existing mappings when switching column manually
                                typeMappings = [];
                                onTypeFieldChange();
                            }}
                        >
                            <option value="">-- Select Field --</option>

                            <optgroup label="System Properties">
                                {#each pinnedColumns as col}
                                    <option value={col.id}>
                                        📍 {col.name}
                                    </option>
                                {/each}
                            </optgroup>

                            <optgroup label="Columns">
                                {#each normalColumns as col}
                                    <option value={col.id}>{col.name}</option>
                                {/each}
                            </optgroup>
                        </select>
                    </div>
                </label>

                {#if typeFieldId}
                    <div style="margin-top: 12px;">
                        <div class="b3-label">Value Mappings:</div>
                        <div class="fn__hr"></div>
                        {#each typeMappings as map}
                            <div
                                class="fn__flex"
                                style="margin-bottom: 8px; align-items: center;"
                            >
                                <div
                                    style="width: 200px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-shrink: 0;"
                                    title="{selectedColumn?.name}-{map.value}"
                                >
                                    <span class="b3-chip b3-chip--secondary">
                                        {selectedColumn?.name}
                                        - {map.value || "(Empty/Null)"}
                                    </span>
                                </div>
                                <span style="margin: 0 8px;">→</span>
                                <input
                                    class="b3-input fn__flex-1"
                                    placeholder="Type Name"
                                    bind:value={map.name}
                                />
                            </div>
                        {/each}
                        <div class="b3-label__text" style="margin-top: 8px;">
                            Only values with mapped names will be saved.
                        </div>
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
                            <div style="font-weight: bold;">
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
                            <option value="none">None</option>
                            <option value="weak">Weak (Fill Empty)</option>
                            <option value="strong">Strong (Overwrite)</option>
                        </select>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <div
        class="fn__flex"
        style="margin-top: 16px; justify-content: flex-end; flex-shrink: 0;"
    >
        <button
            class="b3-button b3-button--cancel"
            on:click={() => dialog.destroy()}>Cancel</button
        >
        <button class="b3-button" style="margin-left: 8px;" on:click={save}
            >Save</button
        >
    </div>
</div>

<style>
    .config-section {
        padding: 4px;
    }
</style>
