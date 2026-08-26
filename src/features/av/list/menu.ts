import { focusDatabaseView } from "./focus-db";
import { createDatabaseWithBlocks } from "./create-db";
import { ATTR_LINKED_AV } from "../../../shared/constants";
import { getOutermostList, getBlockAttribute } from "../../../shared/utils/dom-utils";
import { openDbConfigDialog, getGlobalTypeConfigs } from "../av-setting/db-config";
import { i18n } from "../../../shared/utils";
import { addPluginMenuItem } from "../../../shared/utils/menu-utils";
import { showMessage, Dialog } from "siyuan";
import { supertagAVProjector } from "../../unified-attributes/projection/supertag-av-projector";
import { supertagBinder } from "../../unified-attributes/core/supertag-binder";

async function openProjectSupertagPrompt(avId: string, blockId?: string) {
    let suggestedTag = "";
    const allKnownTags = new Set<string>();

    try {
        const configs = await getGlobalTypeConfigs();
        const matchedConfig = configs.find(c => c.avId === avId);
        if (matchedConfig) {
            suggestedTag = (matchedConfig.typeName || matchedConfig.avName || "").replace(/^#/, "").trim();
        }
        configs.forEach(c => {
            if (c.typeName) allKnownTags.add(c.typeName.replace(/^#/, "").trim());
        });
    } catch (_) {}

    // 检查 SupertagBinder 偏好
    if (!suggestedTag) {
        try {
            const prefs = (supertagBinder as any).prefs || {};
            for (const [tag, boundAvId] of Object.entries(prefs)) {
                if (boundAvId === avId) {
                    suggestedTag = tag.replace(/^#/, "").trim();
                    break;
                }
            }
        } catch (_) {}
    }

    if (!suggestedTag) {
        suggestedTag = "task";
    }

    allKnownTags.add(suggestedTag);
    allKnownTags.add("task");
    allKnownTags.add("project");

    const datalistOptions = Array.from(allKnownTags).map(t => `<option value="${t}"></option>`).join("");

    const dialog = new Dialog({
        title: "🏷️ 投影 Supertag 到此数据库",
        content: `
        <div class="b3-dialog__content" style="padding: 16px;">
            <div style="font-size: 13px; color: var(--b3-theme-on-surface); margin-bottom: 12px; line-height: 1.6;">
                输入或选择要提取并投影到当前数据库的 Supertag 标签名（已自动匹配当前数据库对应的标签）：
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <input id="indexos-proj-tag-input" list="indexos-proj-tag-list" class="b3-text-field fn__flex-1" placeholder="例如: ${suggestedTag}" value="${suggestedTag}" autofocus />
                <datalist id="indexos-proj-tag-list">
                    ${datalistOptions}
                </datalist>
            </div>
            <div class="b3-dialog__action" style="display: flex; justify-content: flex-end; gap: 8px;">
                <button class="b3-button b3-button--cancel" id="indexos-proj-cancel">取消</button>
                <button class="b3-button b3-button--text" id="indexos-proj-confirm" style="background: var(--b3-theme-primary); color: #fff;">开始投影</button>
            </div>
        </div>
        `,
        width: "440px"
    });

    const input = dialog.element.querySelector("#indexos-proj-tag-input") as HTMLInputElement;
    const confirmBtn = dialog.element.querySelector("#indexos-proj-confirm") as HTMLButtonElement;
    const cancelBtn = dialog.element.querySelector("#indexos-proj-cancel") as HTMLButtonElement;

    cancelBtn?.addEventListener("click", () => dialog.destroy());
    confirmBtn?.addEventListener("click", async () => {
        const tagName = (input?.value || suggestedTag || "task").trim();
        dialog.destroy();
        showMessage(`⏳ 正在将 #${tagName} 块属性投影到数据库...`, 3000);
        const res = await supertagAVProjector.projectSupertagToAV(tagName, avId);
        if (res.success) {
            showMessage(`✅ 成功将 ${res.rowCount} 个 #${tagName} 块数据投影到此数据库！`, 4000);
        } else {
            showMessage(`❌ 投影失败: ${res.message || "未知错误"}`, 5000, "error");
        }
    });
}

/**
 * Data 功能的块菜单回调 (针对列表块)
 */
export function addDataMenuItems({ detail }: any) {
    const { menu, blockElements, protyle } = detail;
    if (!blockElements || blockElements.length === 0) return;

    const blockElement = blockElements[0];
    const blockType = blockElement.getAttribute("data-type");
    const blockId = blockElement.getAttribute("data-node-id");

    // 针对数据库块 (NodeAttributeView)
    if (blockType === "NodeAttributeView") {
        const avId = blockElement.getAttribute("data-av-id") || blockElement.querySelector(".av")?.getAttribute("data-av-id");
        if (avId) {
            addPluginMenuItem(menu, {
                id: "indexos-db-config",
                icon: "iconSettings",
                label: i18n.dbConfig.dialogTitle,
                click: () => openDbConfigDialog(avId, blockId)
            });

            const isProjected = supertagAVProjector.isVirtualProjection(avId);
            if (isProjected) {
                const boundTag = supertagAVProjector.getBoundTag(avId) || "";
                addPluginMenuItem(menu, {
                    id: "indexos-close-projection",
                    icon: "iconClose",
                    label: `🛑 IndexOS: 关闭虚拟投影 (#${boundTag})`,
                    click: () => {
                        supertagAVProjector.unbindTagFromAV(avId);
                        showMessage("✓ 已关闭虚拟投影，恢复为普通数据库");
                    }
                });
            } else {
                addPluginMenuItem(menu, {
                    id: "indexos-project-supertag",
                    icon: "iconTags",
                    label: "🏷️ IndexOS: 投影 Supertag 到此数据库",
                    click: () => openProjectSupertagPrompt(avId, blockId)
                });
            }
        }
        return;
    }

    // 只有列表或列表项才继续
    if (blockType !== "NodeList" && blockType !== "NodeListItem") return;

    const outermostList = getOutermostList(blockElement);
    const outermostId = outermostList?.getAttribute("data-node-id");

    if (!outermostList || !outermostId) return;

    // 1. 创建数据库 (仅当点击的就是最外层列表块时显示)
    if (blockType === "NodeList" && blockId === outermostId) {
        addPluginMenuItem(menu, {
            id: "indexos-create-db",
            icon: "iconDatabase",
            label: i18n.dataMenu.createDatabase,
            click: () => createDatabaseWithBlocks([blockId])
        });
    }

    // 2. 聚焦层级 (只要最外层列表绑定了数据库，则在所有子项/子列表上显示)
    // 注意：必须同步检查 DOM 属性，异步 await 会导致菜单已打开而无法添加项
    const linkedAv = getBlockAttribute(outermostList, ATTR_LINKED_AV);

    // 调试：打印最外层块的所有属性
    const attrNames = outermostList.getAttributeNames();
    const attrMap: any = {};
    attrNames.forEach(name => attrMap[name] = outermostList.getAttribute(name));

    if (linkedAv) {
        addPluginMenuItem(menu, {
            id: "indexos-db-focus",
            icon: "iconFilter",
            label: i18n.dataMenu.dbFocus,
            submenu: [
                {
                    icon: "iconSort",
                    label: i18n.dataMenu.level,
                    click: () => focusDatabaseView(blockId, protyle, "level")
                },
                {
                    icon: "iconLink",
                    label: i18n.dataMenu.siblings,
                    click: () => focusDatabaseView(blockId, protyle, "siblings")
                },
                {
                    icon: "iconDown",
                    label: i18n.dataMenu.descendants,
                    click: () => focusDatabaseView(blockId, protyle, "descendants")
                }
            ]
        });
    }
}
