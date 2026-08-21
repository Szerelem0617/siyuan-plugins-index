/**
 * move-content.ts
 * 将内容移动到命令 (index.moveContent) - 多态块/页面位置迁移执行器
 *
 * 遵循 SOP 规范：
 * 1. 严格使用调度器解析好的 resolvedParams，不写多层 || 兜底；
 * 2. 纯粹执行多态移动业务逻辑；
 * 3. 移动操作原地迁移，不产生冗余出参。
 */

import { post } from "../../../shared/api-client/request";
import type { CommandContext, DispatchResult } from "../command-dispatcher";

export async function triggerMoveContent(
    resolvedParams: Record<string, unknown>,
    _context?: CommandContext
): Promise<DispatchResult> {
    const sourceId = String(resolvedParams?.id || "").trim();
    const targetId = String(resolvedParams?.target || "").trim();
    const position = String(resolvedParams?.position || "bottom").toLowerCase().trim();

    console.group(`⚡ [MoveContent Execution] source=${sourceId} -> target=${targetId} (pos=${position})`);

    if (!sourceId) {
        console.groupEnd();
        throw new Error("[MoveContent] 缺失必要的源实体 ID (id)");
    }
    if (!targetId) {
        console.groupEnd();
        throw new Error("[MoveContent] 缺失必要的目标位置 ID (target)");
    }

    // 1. 查询源实体与目标实体的元数据
    const sourceRes = await post("/api/query/sql", {
        stmt: `SELECT id, root_id, parent_id, path, box, type, subtype FROM blocks WHERE id = '${sourceId}' LIMIT 1`
    });
    const sourceRows = Array.isArray(sourceRes) ? sourceRes : (sourceRes?.data || []);
    if (sourceRows.length === 0) {
        console.groupEnd();
        throw new Error(`[MoveContent] 未在数据库中找到源块: ${sourceId}`);
    }
    const sourceMeta = sourceRows[0];
    console.log(`🔍 源实体 (type=${sourceMeta.type}):`, sourceMeta);

    const targetRes = await post("/api/query/sql", {
        stmt: `SELECT id, root_id, parent_id, path, box, type, subtype FROM blocks WHERE id = '${targetId}' LIMIT 1`
    });
    const targetRows = Array.isArray(targetRes) ? targetRes : (targetRes?.data || []);
    const targetMeta = targetRows.length > 0 ? targetRows[0] : null;
    console.log(`🎯 目标实体 (type=${targetMeta?.type || 'unknown'}):`, targetMeta);

    // 2. 多态分流执行
    if (sourceMeta.type === "d") {
        if (targetMeta && targetMeta.type === "d") {
            // 目标为文档 ➔ 移动为目标文档的子文档
            console.log(`🚀 [API] /api/filetree/moveDocs (移动文档到目标文档下: ${targetMeta.path})`);
            await post("/api/filetree/moveDocs", {
                fromPaths: [sourceMeta.path],
                toPath: targetMeta.path,
                toNotebook: targetMeta.box
            });
        } else {
            // 目标为笔记本根目录
            const targetNotebook = targetMeta?.box || targetId;
            console.log(`🚀 [API] /api/filetree/moveDocs (移动文档到笔记本根目录: ${targetNotebook})`);
            await post("/api/filetree/moveDocs", {
                fromPaths: [sourceMeta.path],
                toPath: "/",
                toNotebook: targetNotebook
            });
        }
    } else {
        if (targetMeta && targetMeta.type === "d") {
            // 目标为文档
            if (position === "top") {
                console.log(`🚀 [API] /api/block/moveBlock (移动到文档顶部: parentID=${targetId})`);
                await post("/api/block/moveBlock", {
                    id: sourceId,
                    parentID: targetId
                });
            } else {
                // 默认 bottom: 查出目标文档底部的最后一个直接子块
                const lastChildRes = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE root_id = '${targetId}' AND id != '${targetId}' AND parent_id = '${targetId}' ORDER BY sort DESC LIMIT 1`
                });
                const lastChildRows = Array.isArray(lastChildRes) ? lastChildRes : (lastChildRes?.data || []);
                const lastBlockId = lastChildRows.length > 0 ? lastChildRows[0].id : null;

                if (lastBlockId && lastBlockId !== sourceId) {
                    console.log(`🚀 [API] /api/block/moveBlock (移动到文档末尾块 ${lastBlockId} 下方: previousID=${lastBlockId})`);
                    await post("/api/block/moveBlock", {
                        id: sourceId,
                        previousID: lastBlockId
                    });
                } else {
                    console.log(`🚀 [API] /api/block/moveBlock (空文档直接以 parentID 挂载)`);
                    await post("/api/block/moveBlock", {
                        id: sourceId,
                        parentID: targetId
                    });
                }
            }
        } else {
            // 目标为普通块
            if (position === "inside") {
                console.log(`🚀 [API] /api/block/moveBlock (作为子块挂载: parentID=${targetId})`);
                await post("/api/block/moveBlock", {
                    id: sourceId,
                    parentID: targetId
                });
            } else {
                // 默认 after: 移动到目标块同级正下方
                console.log(`🚀 [API] /api/block/moveBlock (移动到目标块正下方: previousID=${targetId})`);
                await post("/api/block/moveBlock", {
                    id: sourceId,
                    previousID: targetId
                });
            }
        }
    }

    console.log(`✅ [MoveContent Success] 移动完成: ${sourceId} -> ${targetId}`);
    console.groupEnd();

    return {
        success: true,
        method: "custom",
        detail: `${sourceId} -> ${targetId}`
    };
}
