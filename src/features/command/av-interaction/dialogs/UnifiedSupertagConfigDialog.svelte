<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import ManualConfigPanel from "./ManualConfigPanel.svelte";
    import ConditionalTriggerPanel from "./ConditionalTriggerPanel.svelte";
    import { parseManualConfig, type ManualConfig } from "../../utils/manual-config";
    import { parseMultiEventRuleScript } from "../../composite/script-dsl";
    import { refreshSupertagRegistry } from "../../utils/sync-service";

    export let dialog: Dialog;
    export let supertag: string = "";
    export let initialTab: "manual" | "auto" = "manual";
    export let currentManualVal: string = "";
    export let currentAutoVal: string = "";
    export let availableCommands: { id: string; name: string; description?: string; params?: any[] }[] = [];
    export let onSave: (payload: { manual: string; auto: string }) => Promise<void>;

    let activeTab: "manual" | "auto" = initialTab;
    let saving = false;
    let error = "";

    let manualPanel: ManualConfigPanel;
    let autoPanel: ConditionalTriggerPanel;

    // 绑定子面板数据用于徽标展示与同步
    let manualEntries: ManualConfig = parseManualConfig(currentManualVal || "");
    const parsedAuto = parseMultiEventRuleScript(currentAutoVal || "");
    let autoSelectedEvents: string[] = (parsedAuto && parsedAuto.events && parsedAuto.events.length > 0) ? parsedAuto.events : ["tag_created"];

    async function handleSave() {
        error = "";
        const manualJsonStr = manualPanel ? manualPanel.getSerializedConfig() : (currentManualVal || "[]");
        const autoScriptStr = autoPanel ? autoPanel.getSerializedScript() : (currentAutoVal || "");

        // 检查是否有任何实际修改
        const normalize = (val: string) => (val || "").trim();
        const manualUnchanged = normalize(manualJsonStr) === normalize(currentManualVal) || (normalize(manualJsonStr) === "[]" && !normalize(currentManualVal));
        const autoUnchanged = normalize(autoScriptStr) === normalize(currentAutoVal);

        if (manualUnchanged && autoUnchanged) {
            showMessage("无任何更新", 2000, "info");
            dialog.destroy();
            return;
        }

        saving = true;
        try {
            await onSave({
                manual: manualJsonStr,
                auto: autoScriptStr
            });

            await refreshSupertagRegistry();
            window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));
            showMessage(`✓ 已成功保存 Supertag #${supertag} 配置 ⚡`);
            dialog.destroy();
        } catch (e: any) {
            error = `保存失败: ${e.message || e}`;
            showMessage(`保存失败: ${e.message || e}`, 5000, "error");
        } finally {
            saving = false;
        }
    }

    async function handleSaveAsCommand() {
        if (autoPanel) {
            await autoPanel.saveAsCompositeCommand();
        }
    }
</script>

<div class="fn__flex-column indexos-unified-config" style="height: 100%; min-height: 0; box-sizing: border-box; padding: 16px; gap: 12px; overflow: hidden; display: flex; flex-direction: column;">
    <!-- 头部信息 -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); display: flex; align-items: center; gap: 6px;">
            <span>🏷️</span>
            <span>配置超级标签：<span style="color: var(--indexos-accent-primary);">#{supertag}</span></span>
        </div>
    </div>

    <!-- 顶部 Tab 导航 (Segmented TabBar) -->
    <div class="indexos-tabbar" style="flex-shrink: 0;">
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'manual'}
            on:click={() => activeTab = "manual"}
        >
            <span>🔘 手动命令 (Manual)</span>
            {#if manualEntries.length > 0}
                <span class="indexos-tab-badge">{manualEntries.length}</span>
            {/if}
        </button>
        <button 
            type="button"
            class="indexos-tab-item" 
            class:active={activeTab === 'auto'}
            on:click={() => activeTab = "auto"}
        >
            <span>⚡ 自动触发 (Auto)</span>
            {#if autoSelectedEvents.length > 0}
                <span class="indexos-tab-badge">{autoSelectedEvents.length}</span>
            {/if}
        </button>
    </div>

    <!-- 内容区域：模块化子组件路由 (保留各自在独立组件中的状态与逻辑) -->
    <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
        <div style="height: 100%; display: {activeTab === 'manual' ? 'flex' : 'none'}; flex-direction: column; min-height: 0; overflow: hidden;">
            <ManualConfigPanel
                bind:this={manualPanel}
                bind:entries={manualEntries}
                {supertag}
                currentVal={currentManualVal}
                {availableCommands}
            />
        </div>

        <div style="height: 100%; display: {activeTab === 'auto' ? 'flex' : 'none'}; flex-direction: column; min-height: 0; overflow: hidden;">
            <ConditionalTriggerPanel
                bind:this={autoPanel}
                bind:selectedEvents={autoSelectedEvents}
                {supertag}
                currentVal={currentAutoVal}
            />
        </div>
    </div>

    <!-- 底部操作栏 -->
    {#if error}
        <div style="font-size: 11px; color: var(--indexos-status-error); background: rgba(220, 38, 38, 0.08); padding: 6px 10px; border-radius: 4px; word-break: break-all; flex-shrink: 0;">
            {error}
        </div>
    {/if}

    <div class="fn__flex" style="justify-content: flex-end; align-items: center; gap: 8px; flex-shrink: 0; padding-top: 6px; border-top: 1px solid var(--indexos-border-divider);">
        {#if activeTab === "auto"}
            <button class="b3-button b3-button--outline" on:click={handleSaveAsCommand} disabled={saving}>
                另存为复合命令
            </button>
        {/if}
        <div style="flex: 1;"></div>
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存配置"}
        </button>
    </div>
</div>
