/**
 * duplicate-content.ts
 * 克隆内容命令 (index.duplicateContent) - 多态块/文档深克隆执行器
 *
 * 架构规范：
 * 1. 块级克隆：通过 /api/block/getBlockDOM 获取物理 AST，调用 /api/block/insertBlock 插入副本并返回新 ID；
 * 2. 页面级克隆：通过 /api/filetree/duplicateDoc 完整克隆文档树，返回新文档 ID；
 * 3. 统一输出 createdblock，完全支持前后台无头执行与复合命令链式衔接。
 */

import { post } from "../../../shared/api-client/request";
import type { CommandContext, DispatchResult } from "../command-dispatcher";

export async function triggerDuplicateContent(
    resolvedParams: Record<string, unknown>,
    _context?: CommandContext
): Promise<DispatchResult> {
    const targetId = String(resolvedParams?.id || "").trim();

    console.group(`⚡ [DuplicateContent Execution] targetId=${targetId}`);

    if (!targetId) {
        console.groupEnd();
        throw new Error("[DuplicateContent] 缺失必要的克隆目标实体 ID (id)");
    }

    // 1. 查询目标实体的元数据
    const metaRes = await post("/api/query/sql", {
        stmt: `SELECT id, root_id, parent_id, path, box, type, subtype FROM blocks WHERE id = '${targetId}' LIMIT 1`
    });
    const metaRows = Array.isArray(metaRes) ? metaRes : (metaRes?.data || []);
    if (metaRows.length === 0) {
        console.groupEnd();
        throw new Error(`[DuplicateContent] 未在数据库中找到待克隆实体: ${targetId}`);
    }
    const meta = metaRows[0];
    console.log(`🔍 待克隆实体元数据 (type=${meta.type}):`, meta);

    let createdId = "";

    // 2. 多态分流执行
    if (meta.type === "d") {
        // ── 页面/文档克隆 ─────────────────────────────────────────────
        console.log(`🚀 [API] /api/filetree/duplicateDoc (克隆文档: ${targetId})`);
        const dupRes = await post("/api/filetree/duplicateDoc", {
            id: targetId
        });
        if (dupRes?.data?.id) {
            createdId = dupRes.data.id;
        }
    } else {
        // ── 块级深克隆 ────────────────────────────────────────────────
        console.log(`🚀 [API] /api/block/getBlockDOM (获取块物理 DOM: ${targetId})`);
        const domRes = await post("/api/block/getBlockDOM", {
            id: targetId
        });
        const domString = domRes?.data?.dom || "";
        if (!domString) {
            console.groupEnd();
            throw new Error(`[DuplicateContent] 获取块 DOM 失败: ${targetId}`);
        }

        console.log(`🚀 [API] /api/block/insertBlock (在下方插入副本)`);
        const insertRes = await post("/api/block/insertBlock", {
            previousID: targetId,
            dataType: "dom",
            data: domString
        });

        // 提取新生成的 Block ID
        const ops = insertRes?.data?.[0]?.doOperations;
        if (Array.isArray(ops) && ops.length > 0 && ops[0].id) {
            createdId = ops[0].id;
        } else if (insertRes?.data?.id) {
            createdId = insertRes.data.id;
        }
    }

    console.log(`✅ [DuplicateContent Success] 克隆完成: 原 ID=${targetId} ➔ 新 ID=${createdId}`);
    console.groupEnd();

    return {
        success: true,
        method: "custom",
        id: createdId,
        outputs: {
            createdblock: createdId,
            id: createdId
        },
        detail: `${targetId} -> ${createdId}`
    };
}
