<script lang="ts">
    import { showMessage } from "siyuan";
    import { runQuery } from "../../../sqlite/sqlite-manager";

    export let dialog: any;
    export let onImported: () => void;

    interface PresetSupertag {
        title: string;
        icon: string;
        tag: string;
        desc: string;
        defaultCommands?: string;
        defaultConditional?: string;
    }

    const PRESET_SUPERTAGS: PresetSupertag[] = [
        {
            title: "📚 阅读笔记 (Reading Note)",
            icon: "📖",
            tag: "read_note",
            desc: "用于书籍、论文与知识卡片管理，预置关系图与摘要指示。",
            defaultCommands: "index.duplicateBlock",
            defaultConditional: "// [打上标签时] -> 复制当前块"
        },
        {
            title: "📅 每日复盘 (Daily Review)",
            icon: "🗓️",
            tag: "daily_review",
            desc: "用于每日日记、时间追踪与心流总结。",
            defaultCommands: "index.openInbox",
            defaultConditional: "// [打上标签时] -> 打开收集箱"
        },
        {
            title: "💡 创意点子 (Idea Spark)",
            icon: "💡",
            tag: "idea_spark",
            desc: "闪念胶囊与灵感卡片记录。",
            defaultCommands: "index.insertContentBelow",
            defaultConditional: "// [打上标签时] -> 在下方新建内容"
        },
        {
            title: "📌 待办卡片 (Task Card)",
            icon: "📌",
            tag: "task_card",
            desc: "GTD 任务与项目看板卡片。",
            defaultCommands: "index.setBlockAttribute-1",
            defaultConditional: "// [打上标签时] -> 转换为任务"
        }
    ];

    async function importPreset(preset: PresetSupertag) {
        try {
            const cleanTag = preset.tag.replace(/^#/, "");
            const iconMenuCmd = preset.defaultCommands || "";
            const conditionalScript = preset.defaultConditional || "";

            const sql = `INSERT INTO "supertag-db" ("主键", "Manual", "Auto") VALUES ('${cleanTag}', '${iconMenuCmd}', '${conditionalScript}') ON CONFLICT("主键") DO UPDATE SET "Manual" = EXCLUDED."Manual", "Auto" = EXCLUDED."Auto"`;
            await runQuery(sql);

            showMessage(`✓ 成功导入超级标签: #${cleanTag}`);
            onImported();
            if (dialog) dialog.destroy();
        } catch (e: any) {
            console.error("[PresetSupertag] Failed to import preset via Plugin SQL DML:", e);
            showMessage(`导入预设 Supertag 失败: ${e.message}`, 3000, "error");
        }
    }
</script>

<div class="b3-dialog__content" style="display: flex; flex-direction: column; gap: 12px; padding: 16px; min-width: 400px;">
    <div style="font-size: 13px; font-weight: bold; color: var(--b3-theme-on-background); display: flex; align-items: center; justify-content: space-between;">
        <span>✨ 快捷导入预定义 Supertag (Plugin SQL DML)</span>
    </div>
    <div style="font-size: 11px; color: var(--b3-theme-on-surface-light);">
        选择要导入的特色超级标签预设模板，将通过插件原生 SQL DML 写入 "supertag-db"：
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">
        {#each PRESET_SUPERTAGS as item}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="b3-list-item"
                style="padding: 10px 12px; border-radius: 6px; border: 1px solid var(--b3-border-color); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.15s ease;"
                on:click={() => importPreset(item)}
            >
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <div style="font-size: 13px; font-weight: bold; color: var(--b3-theme-on-background); display: flex; align-items: center; gap: 6px;">
                        <span>{item.icon}</span>
                        <span>{item.title}</span>
                        <code style="font-size: 10px; padding: 2px 4px; background: var(--b3-theme-surface); border-radius: 3px; color: var(--b3-theme-primary);">#{item.tag}</code>
                    </div>
                    <div style="font-size: 11px; color: var(--b3-theme-on-surface-light); opacity: 0.8;">
                        {item.desc}
                    </div>
                </div>

                <button class="b3-button b3-button--outline" style="font-size: 11px; padding: 4px 8px; flex-shrink: 0;">一键导入</button>
            </div>
        {/each}
    </div>

    <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
        <button class="b3-button b3-button--cancel" on:click={() => dialog.destroy()}>关闭</button>
    </div>
</div>
