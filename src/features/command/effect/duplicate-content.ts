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
    const withChildren = Boolean(resolvedParams?.withChildren ?? false);

    if (!targetId) {
        throw new Error("[DuplicateContent] 缺失必要的待克隆目标 ID (id)");
    }

    // 1. 查询待克隆实体的元数据
    const metaRes = await post("/api/query/sql", {
        stmt: `SELECT id, root_id, parent_id, path, box, type, subtype FROM blocks WHERE id = '${targetId}' LIMIT 1`
    });
    const metaRows = Array.isArray(metaRes) ? metaRes : (metaRes?.data || []);
    if (metaRows.length === 0) {
        throw new Error(`[DuplicateContent] 未在数据库中找到待克隆实体: ${targetId}`);
    }
    const meta = metaRows[0];

    let createdId = "";

    // 2. 多态分流执行
    if (meta.type === "d") {
        // ── 页面/文档克隆 ─────────────────────────────────────────────
        const dupRes = await post("/api/filetree/duplicateDoc", {
            id: targetId
        });
        if (dupRes?.data?.id) {
            createdId = dupRes.data.id;
        }

        // 若开启 withChildren，递归克隆子页面树
        if (withChildren && createdId && meta.path && meta.box) {
            try {
                const cleanParentPath = meta.path.replace(/\.sy$/, "");
                const childDocsRes = await post("/api/query/sql", {
                    stmt: `SELECT id, path FROM blocks WHERE type = 'd' AND box = '${meta.box}' AND path LIKE '${cleanParentPath}/%' AND id != '${meta.box}' ORDER BY path ASC`
                });
                const childDocs = Array.isArray(childDocsRes) ? childDocsRes : (childDocsRes?.data || []);

                // 获取新生成主文档的新路径
                const newParentMeta = await post("/api/query/sql", {
                    stmt: `SELECT path FROM blocks WHERE id = '${createdId}' LIMIT 1`
                });
                const newParentRows = Array.isArray(newParentMeta) ? newParentMeta : (newParentMeta?.data || []);
                const newParentCleanPath = newParentRows[0]?.path?.replace(/\.sy$/, "") || "";

                if (newParentCleanPath) {
                    for (const child of childDocs) {
                        const childDup = await post("/api/filetree/duplicateDoc", { id: child.id });
                        const newChildId = childDup?.data?.id;
                        if (newChildId) {
                            const subRelativePath = child.path.substring(cleanParentPath.length); // e.g. /sub.sy
                            const toPath = newParentCleanPath + subRelativePath.substring(0, subRelativePath.lastIndexOf("/") + 1);
                            await post("/api/filetree/moveDocs", {
                                fromPaths: [childDup.data.path || ""],
                                toPath: toPath || newParentCleanPath,
                                toNotebook: meta.box
                            });
                        }
                    }
                }
            } catch (childErr) {
                console.warn(`⚠️ 递归克隆子文档出现异常:`, childErr);
            }
        }
    } else {
        // ── 块级深克隆 ────────────────────────────────────────────────
        const domRes = await post("/api/block/getBlockDOM", {
            id: targetId
        });
        const domString = domRes?.data?.dom || "";
        if (!domString) {
            throw new Error(`[DuplicateContent] 获取块 DOM 失败: ${targetId}`);
        }

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

        // 若为标题块且开启 withChildren，克隆其折叠管辖范围内的全部子块
        if (withChildren && createdId && meta.type === "h" && meta.root_id) {
            try {
                const currentLevel = parseInt((meta.subtype || "h6").replace(/\D/g, ""), 10) || 6;
                const siblingsRes = await post("/api/query/sql", {
                    stmt: `SELECT id, type, subtype, sort FROM blocks WHERE root_id = '${meta.root_id}' AND parent_id = '${meta.parent_id}' ORDER BY sort ASC`
                });
                const siblings = Array.isArray(siblingsRes) ? siblingsRes : (siblingsRes?.data || []);
                const currentIdx = siblings.findIndex((s: any) => s.id === targetId);

                if (currentIdx !== -1) {
                    const subBlocksToCopy: string[] = [];
                    for (let i = currentIdx + 1; i < siblings.length; i++) {
                        const s = siblings[i];
                        if (s.type === "h") {
                            const lvl = parseInt((s.subtype || "h6").replace(/\D/g, ""), 10) || 6;
                            if (lvl <= currentLevel) break; // 遇到同级或更高级标题，子树结束
                        }
                        subBlocksToCopy.push(s.id);
                    }

                    let lastInsertedId = createdId;
                    for (const subId of subBlocksToCopy) {
                        const subDom = await post("/api/block/getBlockDOM", { id: subId });
                        if (subDom?.data?.dom) {
                            const subInsert = await post("/api/block/insertBlock", {
                                previousID: lastInsertedId,
                                dataType: "dom",
                                data: subDom.data.dom
                            });
                            const subOps = subInsert?.data?.[0]?.doOperations;
                            if (Array.isArray(subOps) && subOps[0]?.id) {
                                lastInsertedId = subOps[0].id;
                            }
                        }
                    }
                }
            } catch (headingErr) {
                console.warn(`⚠️ 递归克隆标题子块异常:`, headingErr);
            }
        }
    }

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
