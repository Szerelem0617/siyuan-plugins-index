import { Client } from "@siyuan-community/siyuan-sdk";
import { sleep } from "../utils";

export const client = new Client();

// 判定是否属于列表/导图类容器块（标准列表、思维导图、页签等）
const isListContainerType = (type?: string) => {
    return type === 'l' || type === 'mindmap' || type === 'tabs';
};

export class BlockService {
    /**
     * 通用插入/更新数据逻辑，支持属性绑定和自动修复大纲结构
     * @param rootId 文档 ID
     * @param data Markdown 数据
     * @param attrName 识别用的属性名 (e.g. "custom-outline-create")
     * @param attrValue 属性值
     * @param type 类型 "index" | "outline" (用于特殊逻辑判断)
     * @param targetBlockId 可选：Slash 命令触发时的目标块 ID (用于替换)
     */
    static async insertOrUpdate(
        rootId: string,
        data: string,
        attrName: string,
        attrValue: any,
        type: "index" | "outline",
        targetBlockId?: string,
        existingBlockInfo?: { id: string, type: string, parent_id: string }
    ) {
        const attrs = { [attrName]: JSON.stringify(attrValue) };

        try {
            // 1. Check for existing block
            let currentId: string;
            let currentType: string;
            let parentId: string;

            if (existingBlockInfo) {
                currentId = existingBlockInfo.id;
                currentType = existingBlockInfo.type;
                parentId = existingBlockInfo.parent_id;
            } else {
                let rs = await client.sql({
                    stmt: `SELECT id, type, parent_id FROM blocks WHERE root_id = '${rootId}' AND ial like '%${attrName}%' order by updated desc limit 1`
                });
                if (rs.data[0]?.id != undefined) {
                    currentId = rs.data[0].id;
                    currentType = rs.data[0].type;
                    parentId = rs.data[0].parent_id;
                }
            }

            if (currentId == undefined) {
                // === Case: Insert New ===

                // Check for empty document (single empty P block)
                let emptyBlockId: string | undefined;
                if (!targetBlockId) {
                    let checkRs = await client.sql({
                        stmt: `SELECT id, type, content FROM blocks WHERE root_id = '${rootId}' AND parent_id = '${rootId}' ORDER BY sort ASC`
                    });
                    if (checkRs.data && checkRs.data.length === 1) {
                        const b = checkRs.data[0];
                        if (b.type === 'p' && (!b.content || b.content.trim() === '')) {
                            emptyBlockId = b.id;
                        }
                    }
                }

                let result;
                if (targetBlockId) {
                    result = await client.updateBlock({
                        data: data,
                        dataType: 'markdown',
                        id: targetBlockId
                    });
                } else {
                    result = await client.prependBlock({
                        data: data,
                        dataType: 'markdown',
                        parentID: rootId
                    });
                }

                let opId = result.data[0].doOperations[0].id;
                let attrTargetId = opId;

                // If the returned block is a wrapper (Blockquote for outline, Super Block for index with col>1),
                // find the inner List block to bind the attribute to
                if (attrName !== "custom-tree-create") {
                    let needsSearch = false;
                    if (type == "outline") {
                        needsSearch = true;
                    } else {
                        let typeRs = await client.sql({
                            stmt: `SELECT type FROM blocks WHERE id = '${opId}' LIMIT 1`
                        });
                        if (typeRs.data?.[0]?.type === 'sb') {
                            needsSearch = true;
                        }
                    }
                    if (needsSearch) {
                        for (let i = 0; i < 15; i++) {
                            await sleep(500);
                            let childRs = await client.sql({
                                stmt: `SELECT id FROM blocks WHERE parent_id = '${opId}' AND type IN ('l', 'mindmap', 'tabs') LIMIT 1`
                            });
                            if (childRs.data && childRs.data[0]) {
                                attrTargetId = childRs.data[0].id;
                                break;
                            }
                        }
                    }
                }

                await client.setBlockAttrs({
                    attrs: attrs,
                    id: attrTargetId
                });

                if (emptyBlockId) {
                    await client.deleteBlock({ id: emptyBlockId });
                }

                return { success: true, id: attrTargetId, msg: "insert_success" };

            } else {
                // === Case: Update Existing ===
                let updateTargetId = currentId;

                // 1. 抓取现有块的所有属性快照，妥善保留思维导图/标签页等视图选择与用户自定义属性
                const preservedAttrs: Record<string, string> = {};
                try {
                    const attrRes = await client.getBlockAttrs({ id: currentId });
                    if (attrRes?.data) {
                        for (const [k, v] of Object.entries(attrRes.data as Record<string, string>)) {
                            // 排除思源底层自动维护的只读/索引字段
                            if (k === "id" || k === "updated" || k === "created" || k === "hash") {
                                continue;
                            }
                            if (v !== undefined && v !== null && v !== "") {
                                preservedAttrs[k] = v;
                            }
                        }
                    }
                } catch (e) {
                    console.warn("[BlockService] Failed to fetch existing block attrs:", e);
                }

                // 2. 如果当前块是嵌套在 Blockquote ('b') 或 Super Block ('sb') 内部的列表/导图块，则更新外层容器
                if (isListContainerType(currentType)) {
                    let parentRs = await client.sql({ stmt: `SELECT id, type FROM blocks WHERE id = '${parentId}'` });
                    const parentType = parentRs.data?.[0]?.type;
                    if (parentType === 'b' || parentType === 'sb') {
                        updateTargetId = parentRs.data[0].id;
                    }
                }

                // 3. 执行块内容更新
                await client.updateBlock({
                    data: data,
                    dataType: 'markdown',
                    id: updateTargetId
                });

                // 4. 定位内部列表/导图块，将属性重新绑定
                let attrTargetId = updateTargetId;
                if (updateTargetId !== currentId && attrName !== "custom-tree-create") {
                    let foundNew = false;
                    for (let i = 0; i < 15; i++) {
                        await sleep(500);
                        let stmt = `SELECT id FROM blocks WHERE parent_id = '${updateTargetId}' AND type IN ('l', 'mindmap', 'tabs') AND id != '${currentId}' LIMIT 1`;
                        let childRs = await client.sql({ stmt });
                        if (childRs.data && childRs.data[0]) {
                            attrTargetId = childRs.data[0].id;
                            foundNew = true;
                            break;
                        }
                    }
                    if (!foundNew) {
                        let childRs = await client.sql({
                            stmt: `SELECT id FROM blocks WHERE parent_id = '${updateTargetId}' AND type IN ('l', 'mindmap', 'tabs') LIMIT 1`
                        });
                        if (childRs.data && childRs.data[0]) {
                            attrTargetId = childRs.data[0].id;
                        }
                    }
                }

                // 5. 将插件的新配置合并到保留属性快照中，全量写回
                preservedAttrs[attrName] = JSON.stringify(attrValue);
                await client.setBlockAttrs({
                    attrs: preservedAttrs,
                    id: attrTargetId
                });

                if (targetBlockId && targetBlockId !== updateTargetId) {
                    await client.deleteBlock({ id: targetBlockId });
                }

                return { success: true, id: attrTargetId, msg: "update_success" };
            }
        } catch (error) {
            console.error("[BlockService] insertOrUpdate error:", error);
            throw error;
        }
    }
}
