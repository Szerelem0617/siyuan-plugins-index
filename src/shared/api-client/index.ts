import { Client } from "@siyuan-community/siyuan-sdk";
import { sleep } from "../utils";

export const client = new Client();

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
        console.log(`[BlockService] insertOrUpdate type=${type} data_length=${data.length} preview: ${data.slice(0, 200)}...`);

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
                console.log(`[BlockService] No existing ${type} found. Inserting new.`);

                // Check for empty document (single empty P block)
                let emptyBlockId: string | undefined;
                if (!targetBlockId) {
                    let checkRs = await client.sql({
                        stmt: `SELECT id, type, content FROM blocks WHERE root_id = '${rootId}' AND parent_id = '${rootId}' ORDER BY sort ASC`
                    });
                    if (checkRs.data && checkRs.data.length === 1) {
                        const b = checkRs.data[0];
                        // content can be empty string for empty P block
                        if (b.type === 'p' && (!b.content || b.content.trim() === '')) {
                            emptyBlockId = b.id;
                            console.log(`[BlockService] Found empty initial block: ${emptyBlockId}. Will remove after insertion.`);
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
                    // Check what type of block we got
                    let needsSearch = false;
                    if (type == "outline") {
                        needsSearch = true;
                    } else {
                        // For index: check if the block is a super block (col > 1 case)
                        let typeRs = await client.sql({
                            stmt: `SELECT type FROM blocks WHERE id = '${opId}' LIMIT 1`
                        });
                        if (typeRs.data?.[0]?.type === 'sb') {
                            needsSearch = true;
                            console.log(`[BlockService] Index wrapped in super block (col > 1). Searching for inner list...`);
                        }
                    }

                    if (needsSearch) {
                        console.log(`[BlockService] Block inserted (ID: ${opId}). Searching for inner list...`);
                        for (let i = 0; i < 15; i++) {
                            await sleep(500);
                            let childRs = await client.sql({
                                stmt: `SELECT id FROM blocks WHERE parent_id = '${opId}' AND type = 'l' LIMIT 1`
                            });
                            if (childRs.data && childRs.data[0]) {
                                attrTargetId = childRs.data[0].id;
                                console.log(`[BlockService] Found inner list for binding: ${attrTargetId}`);
                                break;
                            }
                        }
                    }
                }

                await client.setBlockAttrs({
                    attrs: attrs,
                    id: attrTargetId
                });

                // Remove empty block if identified
                if (emptyBlockId) {
                    await client.deleteBlock({ id: emptyBlockId });
                }

                console.log(`[BlockService] Attributes bound to ${attrTargetId}`);
                return { success: true, id: attrTargetId, msg: "insert_success" };

            } else {
                // === Case: Update Existing ===
                let updateTargetId = currentId;

                console.log(`[BlockService] Found existing ${type} at ${currentId} (Type: ${currentType})`);

                // Fix: If attr is on a List inside a wrapper, update the wrapper instead
                // Outline uses blockquote ('b'), Index with col>1 uses super block ('sb')
                if (currentType === 'l') {
                    let parentRs = await client.sql({ stmt: `SELECT id, type FROM blocks WHERE id = '${parentId}'` });
                    const parentType = parentRs.data?.[0]?.type;
                    if (parentType === 'b' || parentType === 'sb') {
                        updateTargetId = parentRs.data[0].id;
                        console.log(`[BlockService] Updating parent wrapper (${parentType}): ${updateTargetId}`);
                    }
                }

                await client.updateBlock({
                    data: data,
                    dataType: 'markdown',
                    id: updateTargetId
                });

                // Re-bind attributes to the inner list block after updating wrapper
                let attrTargetId = updateTargetId;
                if (updateTargetId !== currentId && attrName !== "custom-tree-create") {
                    // We updated a wrapper (blockquote/super block), need to find the new inner list
                    console.log(`[BlockService] Updated wrapper ${updateTargetId}. Re-searching for inner list...`);
                    let foundNew = false;
                    for (let i = 0; i < 15; i++) {
                        await sleep(500);
                        let stmt = `SELECT id FROM blocks WHERE parent_id = '${updateTargetId}' AND type = 'l' AND id != '${currentId}' LIMIT 1`;
                        let childRs = await client.sql({ stmt });
                        if (childRs.data && childRs.data[0]) {
                            attrTargetId = childRs.data[0].id;
                            console.log(`[BlockService] Found new inner list for re-binding: ${attrTargetId}`);
                            foundNew = true;
                            break;
                        }
                    }
                    if (!foundNew) {
                        let childRs = await client.sql({
                            stmt: `SELECT id FROM blocks WHERE parent_id = '${updateTargetId}' AND type = 'l' LIMIT 1`
                        });
                        if (childRs.data && childRs.data[0]) {
                            attrTargetId = childRs.data[0].id;
                            console.log(`[BlockService] Fallback: using list ID ${attrTargetId}`);
                        }
                    }
                }

                await client.setBlockAttrs({
                    attrs: attrs,
                    id: attrTargetId
                });

                if (targetBlockId && targetBlockId !== updateTargetId) {
                    await client.deleteBlock({ id: targetBlockId });
                }

                console.log(`[BlockService] Attributes re-bound to ${attrTargetId}`);
                return { success: true, id: attrTargetId, msg: "update_success" };
            }
        } catch (error) {
            console.error("[BlockService] insertOrUpdate error:", error);
            throw error;
        }
    }
}
