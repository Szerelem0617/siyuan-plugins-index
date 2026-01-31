import { autoUpdateIndex } from "../features/index/action";
import { autoUpdateOutline } from "../features/outline/action";
import { autoUpdateBuilder } from "../features/builder/auto-update";
import { isMobile } from "../shared/utils";
import { client } from "../shared/api-client";
// import { settings } from "./settings";

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
        if(
            //为搜索界面
            detail.protyle.element.className.indexOf("search") != -1 ||
            // 为浮窗
            // detail.model == undefined || 
            detail.protyle.block.showAll){
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
    
    // Single query for Index, Outline, and Builder
    let rs = await client.sql({
        stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND (ial like '%custom-index-create%' OR ial like '%custom-outline-create%' OR ial like '%custom-tree-create%') order by updated desc limit 10`
    });

    console.log(`[IndexPlugin] AutoUpdate Check for ${parentId}. Found ${rs.data?.length || 0} candidate blocks.`);

    let indexBlock = null;
    let outlineBlock = null;
    let builderBlock = null;

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
                console.log(`[IndexPlugin] Found Builder Block: ${block.id}`);
            }
        }
    }

    // 自动插入
    if (indexBlock) {
        autoUpdateIndex(notebookId, path, parentId, indexBlock);
    }
    if (outlineBlock) {
        autoUpdateOutline(parentId, outlineBlock);
    }
    if (builderBlock) {
        console.log(`[IndexPlugin] Triggering Builder Auto-Update...`);
        autoUpdateBuilder(parentId, builderBlock);
    }
}