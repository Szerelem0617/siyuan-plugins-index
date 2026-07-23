import { autoUpdateIndex } from "../features/insert-moc/index/action";
import { autoUpdateOutline } from "../features/insert-moc/outline/action";
import { autoUpdateBuilder } from "../features/builder/auto-update";
import { autoUpdateListAVs } from "../features/av/list/auto-update";
import { isMobile } from "../shared/utils";
import { client } from "../shared/api-client";
// import { settings } from "./settings";

export async function execAutoUpdate(parentId: string, notebookId: string, path: string) {
    // Single query for Index, Outline, Builder, and bound List AVs
    let rs = await client.sql({
        stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND (ial like '%custom-index-create%' OR ial like '%custom-outline-create%' OR ial like '%custom-tree-create%' OR ial like '%custom-index-linked-av%') order by updated desc limit 50`
    });


    let indexBlock = null;
    let outlineBlock = null;
    let builderBlock = null;
    let listBlocks = [];

    if (rs.data) {
        for (const block of rs.data) {
            // console.log(`[IndexPlugin] Checking block ${block.id}: ${block.ial}`);
            if (block.ial.includes("custom-index-create") && !indexBlock) {
                indexBlock = block;
            }
            if (block.ial.includes("custom-outline-create") && !outlineBlock) {
                outlineBlock = block;
            }
            if (block.ial.includes("custom-tree-create") && !builderBlock) {
                builderBlock = block;
            }
            if (block.ial.includes("custom-index-linked-av")) {
                listBlocks.push(block);
            }
        }
    }

    if (listBlocks.length > 0) {
        for (const listBlock of listBlocks) {
            await autoUpdateListAVs(listBlock);
        }
    }

    // 2. Others
    if (indexBlock) {
        await autoUpdateIndex(notebookId, path, parentId, indexBlock);
    }
    if (outlineBlock) {
        await autoUpdateOutline(parentId, outlineBlock);
    }
    if (builderBlock) {
        await autoUpdateBuilder(parentId, builderBlock);
    }
}

/**
 * 文档加载完成事件回调
 * @param param0 事件细节
 * @returns void
 */
export async function updateIndex({ detail }: any) {
    // console.log(detail);
    // console.log(detail.protyle.element.className);
    //如果不为手机端且为聚焦状态，就直接返回，否则查询更新
    if (!isMobile) {
        if (
            //为搜索界面
            detail.protyle.element.className.indexOf("search") != -1 ||
            // 为浮窗
            // detail.model == undefined || 
            detail.protyle.block.showAll) {
            // || !settings.get("autoUpdate")
            return;
        }
    }
    // console.log(detail);
    // 获取笔记本id
    let notebookId = detail.protyle.notebookId;
    // 获取文档块路径
    let path = detail.protyle.path;
    // 获取文档块id
    let parentId = detail.protyle.block.rootID;

    await execAutoUpdate(parentId, notebookId, path);
}