<script lang="ts">
    import { Dialog, showMessage } from "siyuan";
    import { commandRegistry } from "../registry/command-registry";
    import CommandSequenceEditor from "../composite/CommandSequenceEditor.svelte";
    import { encodeBtnHref } from "./inline-button";
    import { parseDispatchCallsFromText, generateRuleScript } from "../composite/script-dsl";
    import { createCompositeRow, registerCompositeCommand, compositeCommandId, generateUniqueCompositeName } from "../composite/manager";
    import { refreshSupertagRegistry } from "../utils/sync-service";

    export let dialog: Dialog;
    export let targetRange: Range | null = null;
    export let initialCommandId: string = "";
    export let initialLabel: string = "";
    export let initialParams: Record<string, string> = {};

    let customLabel = initialLabel || "";
    let buttonScript = initialCommandId
        ? generateRuleScript("", [{ commandRef: initialCommandId, params: initialParams }])
        : "";
    let saving = false;

    async function handleConfirm() {
        const cmds = parseDispatchCallsFromText(buttonScript);
        if (!cmds || cmds.length === 0) {
            showMessage("请至少勾选一个要执行的命令", 3000, "info");
            return;
        }

        saving = true;
        try {
            if (cmds.length === 1) {
                // 单命令绑定模式：直接写入标准按钮链接
                const singleCmd = cmds[0];
                const def = commandRegistry.getCommand(singleCmd.commandRef);
                const finalLabel = customLabel.trim() || def?.name || singleCmd.commandRef;
                const hasParams = singleCmd.params && Object.keys(singleCmd.params).length > 0;
                const paramPayload = hasParams ? JSON.stringify(singleCmd.params) : undefined;

                const href = encodeBtnHref({ command: singleCmd.commandRef, param: paramPayload });
                insertButtonHtml(href, finalLabel);
                showMessage(`✓ 已插入命令按钮：${finalLabel}`);
                dialog.destroy();
            } else {
                // 多命令复合执行模式：自动注册为复合命令并写入按钮链接
                const autoName = customLabel.trim() || generateUniqueCompositeName();
                const rowId = await createCompositeRow(autoName, buttonScript, "", "");
                const commandId = compositeCommandId(rowId);
                registerCompositeCommand(commandId, autoName, buttonScript, "{}");
                await refreshSupertagRegistry();

                const finalLabel = customLabel.trim() || autoName;
                const href = encodeBtnHref({ command: commandId });
                insertButtonHtml(href, finalLabel);
                showMessage(`✓ 已创建复合命令按钮：${finalLabel}`);
                dialog.destroy();
            }
        } catch (err: any) {
            showMessage(`绑定命令按钮失败: ${err?.message || err}`, 3000, "error");
        } finally {
            saving = false;
        }
    }

    function insertButtonHtml(href: string, label: string) {
        const inlineDOM = `<span data-type="a" data-href="${href}">${label}</span>&#8203;`;
        if (targetRange) {
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(targetRange);
                document.execCommand("insertHTML", false, inlineDOM);
            }
        }
    }
</script>

<div class="fn__flex-column" style="height: 100%; padding: 16px; box-sizing: border-box; gap: 10px;">
    <!-- 头部标题 -->
    <div style="font-size: 14px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;">
        <span>🔘 配置命令按钮 (Inline Button)</span>
    </div>

    <!-- 主体：100% 共享统一步骤与命令编排器 -->
    <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
        <CommandSequenceEditor
            initialScript={buttonScript}
            showName={false}
            allowedCommands={null}
            onScriptChange={s => { buttonScript = s; }}
        />
    </div>

    <!-- 定制按钮显示名称 -->
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--indexos-border-divider); flex-shrink: 0;">
        <span style="font-size: 12px; font-weight: 600; color: var(--indexos-text-main); flex-shrink: 0;">
            定制按钮显示名称（选填）:
        </span>
        <input
            type="text"
            class="b3-text-field fn__flex-1"
            style="font-size: 12px; padding: 4px 8px;"
            placeholder="默认使用命令名"
            bind:value={customLabel}
        />
    </div>

    <!-- 底部操作按钮 -->
    <div class="fn__flex" style="justify-content: flex-end; gap: 8px; flex-shrink: 0; padding-top: 4px;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--text" on:click={handleConfirm} disabled={saving}>
            {saving ? "处理中..." : "确认绑定并插入"}
        </button>
    </div>
</div>
