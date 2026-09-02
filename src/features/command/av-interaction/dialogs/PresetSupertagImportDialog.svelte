<script lang="ts">
    import { showMessage } from "siyuan";

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
            defaultCommands: "index.duplicateContent",
            defaultConditional: "// [打上标签时] -> 克隆内容"
        },
        {
            title: "📅 每日复盘 (Daily Review)",
            icon: "🗓️",
            tag: "daily_review",
            desc: "用于每日日记、时间追踪与心流总结。",
            defaultCommands: "index.openTarget",
            defaultConditional: "// [打上标签时] -> 打开目标"
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
            const cleanTag = preset.tag.replace(/^#/, "").trim().toLowerCase();
            const iconMenuCmd = preset.defaultCommands || "";
            const conditionalScript = preset.defaultConditional || "";

            // 1. 启用并自动在 data-dbs 创建同名数据库
            const { supertagBinder } = await import("../../../unified-attributes/core/supertag-binder");
            const { supertagAVProjector } = await import("../../../unified-attributes/projection/supertag-av-projector");
            const { ensureSupertagDatabase } = await import("../../../unified-attributes/core/supertag-schema");

            await supertagBinder.setPref(cleanTag, "enabled");
            const subAvId = await ensureSupertagDatabase(cleanTag);
            if (subAvId) {
                await supertagBinder.setPref(cleanTag, subAvId);
                supertagAVProjector.bindTagToAV(cleanTag, subAvId);
            }

            // 2. 原生 AV 属性写入 supertag-db 系统库 (绝不走 SQL DML)
            const { insertOrUpdateSupertagDbRecord } = await import("../type-db-handler");
            await insertOrUpdateSupertagDbRecord(cleanTag, {
                manual: iconMenuCmd,
                auto: conditionalScript,
                relatedAv: subAvId || ""
            });

    // 3. 刷新注册表
            const { refreshSupertagRegistry } = await import("../../utils/sync-service");
            await refreshSupertagRegistry();

            showMessage(`✓ 成功导入超级标签: #${cleanTag}`);
            onImported();
            if (dialog) dialog.destroy();
        } catch (e: any) {
            console.error("[PresetSupertag] Failed to import preset:", e);
            showMessage(`导入预设 Supertag 失败: ${e.message || e}`, 3000, "error");
        }
    }
</script>

<div class="b3-dialog__content" style="display: flex; flex-direction: column; gap: 12px; padding: 16px; min-width: 400px;">
    <div style="font-size: 13px; font-weight: bold; color: var(--b3-theme-on-background); display: flex; align-items: center; justify-content: space-between;">
        <span>✨ 快捷导入预定义 Supertag</span>
    </div>
    <div style="font-size: 11px; color: var(--b3-theme-on-surface-light);">
        选择要导入的特色超级标签预设模板，将自动在 data-dbs 创建同名数据库并注册到 supertag-db：
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
