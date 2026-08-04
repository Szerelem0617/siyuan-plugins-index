<script lang="ts">
    import { showMessage } from "siyuan";
    import { commandRegistry } from "../../registry/command-registry";
    import { runQuery } from "../../../sqlite/sqlite-manager";

    export let dialog: any;
    export let onCreated: (newCmdId: string) => void;

    let rawId = "";
    let name = "";
    let description = "";
    let codeContent = `// 自定义脚本代码体\nawait dispatch("siyuan.ui.toast");`;

    $: fullId = rawId.trim() ? (rawId.trim().startsWith("user.") ? rawId.trim() : `user.${rawId.trim()}`) : "user.";

    const AI_PROMPT_TEMPLATE = `你是一个思源笔记 IndexOS 插件的自动化脚本高级专家。
请帮我编写一段符合 IndexOS 规范的 JavaScript/TypeScript 执行代码。

【需求】：[在此输入你的具体需求，例如：把当前文档的内容格式化，或弹窗提示字数统计]

【规范与限制】：
1. 代码必须是异步 JavaScript (支持 await/async)；
2. 调用系统命令请统一使用: await dispatch("命令ID", { 参数对象 });
3. 严禁编写无休止的 while(true) 死循环，避免卡死思源主界面；
4. 如果使用思源 API，请通过 post("/api/...", { ... }) 进行异步调用；
5. 只需输出标准的 JS 代码体，无需包装层。`;

    function copyAiPromptTemplate() {
        navigator.clipboard.writeText(AI_PROMPT_TEMPLATE);
        showMessage("✓ 已将标准 AI Prompt 提示词模板复制到剪贴板！可直接粘贴发送给 AI。");
    }

    async function handleCreate() {
        if (!rawId.trim()) {
            showMessage("请输入命令 ID（以 user. 开头）", 3000, "error");
            return;
        }
        if (!name.trim()) {
            showMessage("请输入自定义命令名称", 3000, "error");
            return;
        }

        try {
            // 1. 优先注册到 Layer 1 Registry (符合 Layer 1 规范)
            commandRegistry.registerUserCommand({
                id: fullId,
                name: name.trim(),
                description: description.trim(),
                prompt: codeContent.trim()
            });

            // 2. 使用插件 SQL 引擎 (guide-sqlite.md) 插入 "command-db"
            const insertSql = `INSERT INTO "command-db" ("主键", "Command ID", "UI 入口") VALUES ('${name.trim()}', '${fullId}', '快捷命令') ON CONFLICT("主键") DO UPDATE SET "Command ID" = EXCLUDED."Command ID"`;
            await runQuery(insertSql);

            showMessage(`✓ 成功注册自定义 user. 命令: ${name.trim()} (${fullId})`);
            onCreated(fullId);
            if (dialog) dialog.destroy();
        } catch (e: any) {
            console.error("[UserCommand-Debug] Failed to register user command:", e);
            showMessage(`注册命令失败: ${e.message}`, 3000, "error");
        }
    }
</script>

<div class="b3-dialog__content" style="display: flex; flex-direction: column; gap: 10px; padding: 16px; min-width: 420px;">
    <div style="font-size: 13px; font-weight: bold; color: var(--b3-theme-on-background); display: flex; align-items: center; justify-content: space-between;">
        <span>🤖 新建自定义 user. 命令 (Layer 1 Registry 规范)</span>
        <button
            class="b3-button b3-button--outline"
            style="font-size: 11px; padding: 3px 8px;"
            on:click={copyAiPromptTemplate}
        >📋 复制 AI Prompt 提示词模板</button>
    </div>

    <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); opacity: 0.9; line-height: 1.4; background: var(--b3-theme-surface); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--b3-border-color);">
        💡 提示：点击右上角复制 Prompt 模板问 AI，将拿到的零报错 JS 代码粘贴到下方代码框中即可。
    </div>

    <div style="display: flex; gap: 10px;">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light);">命令 ID (必须以 user. 开头)</label>
            <input type="text" class="b3-text-field" style="font-family: monospace; font-size: 12px;" bind:value={rawId} placeholder="如 my_custom_action" />
            <div style="font-size: 10px; color: var(--indexos-accent-primary); font-family: monospace;">预览: {fullId}</div>
        </div>

        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light);">命令名称</label>
            <input type="text" class="b3-text-field" style="font-size: 12px;" bind:value={name} placeholder="例如: 🤖 AI 智能摘要提炼" />
        </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 4px;">
        <label style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light);">逻辑代码 (JavaScript / TS 执行脚本)</label>
        <textarea
            class="b3-text-field"
            style="height: 100px; font-family: var(--b3-font-family-code, monospace); font-size: 11px; padding: 8px; white-space: pre;"
            bind:value={codeContent}
            placeholder="// 在此粘贴从 AI 获取的零报错执行代码"
        ></textarea>
    </div>

    <div style="display: flex; flex-direction: column; gap: 4px;">
        <label style="font-size: 11px; font-weight: bold; color: var(--b3-theme-on-surface-light);">描述/备注 (可选)</label>
        <input type="text" class="b3-text-field" style="font-size: 11px;" bind:value={description} placeholder="描述该命令的作用" />
    </div>

    <div style="margin-top: 6px; display: flex; justify-content: flex-end; gap: 8px;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>取消</button>
        <button class="b3-button b3-button--primary" on:click={handleCreate}>注册并添加入 Command-DB</button>
    </div>
</div>
