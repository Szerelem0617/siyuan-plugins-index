/**
 * topology-navigator.ts
 *
 * 拓扑导航引擎 (Topology Navigation Engine)
 *
 * 核心机制与规范：
 * 1. 初始锚点：当前触发实体（块或文档页面）。
 * 2. 算子分流：
 *    - 同层级保持算子 (Homogeneous)：
 *      - prev[N] / next[N]：向前/向后第 N 个兄弟（块找兄弟块，页面找同级兄弟页面）。若无则 fallback 回自身；
 *      - parent[N]：向上找父级（块找父块，页面找父页面）。若已达顶层无对应父级则 fallback 回自身；
 *      - child[N]：向下找第 N 个子级（块找子块，页面找子页面/首层块）。若无则 fallback 回自身。
 *    - 跨层级跃迁算子 (Cross-Level)：
 *      - doc：块 ➔ 所在文档；页面 ➔ 自身；
 *      - notebook：块/页面 ➔ 所在笔记本 ID；
 *      - root：相对根跃迁（块 ➔ 页面；页面 ➔ 笔记本）。
 * 3. 链式组合：支持形如 "doc.next", "doc.parent", "prev2", "doc.next.child", "parent.parent" 等任意自由链式导航。
 */

import { post } from "../../../shared/api-client/request";

export interface TopologyNode {
    id: string;
    type: string;
    root_id?: string;
    parent_id?: string;
    box?: string;
    path?: string;
    sort?: number;
}

/** 缓存最近查询过的节点元数据，避免链式步进时重复查表 */
const nodeMetaCache = new Map<string, TopologyNode>();

export async function fetchNodeMeta(id: string): Promise<TopologyNode | null> {
    if (!id || typeof id !== "string") return null;
    const cleanId = id.trim();
    if (nodeMetaCache.has(cleanId)) {
        return nodeMetaCache.get(cleanId)!;
    }

    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, parent_id, path, box, type, sort FROM blocks WHERE id = '${cleanId}' LIMIT 1`
        });
        const rows = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length > 0) {
            const node: TopologyNode = {
                id: rows[0].id,
                type: rows[0].type,
                root_id: rows[0].root_id,
                parent_id: rows[0].parent_id,
                box: rows[0].box,
                path: rows[0].path,
                sort: typeof rows[0].sort === "number" ? rows[0].sort : parseInt(rows[0].sort || "0", 10)
            };
            nodeMetaCache.set(cleanId, node);
            return node;
        }
    } catch (e) {
        console.warn(`[TopologyNavigator] fetchNodeMeta failed for ${cleanId}:`, e);
    }
    return null;
}

/**
 * 执行链式拓扑导航
 * @param startId 起始块或页面 ID
 * @param pathExpr 路径表达式，如 "doc.next", "prev", "doc.parent", "root", "prev2"
 * @returns 最终导航到的实体 ID（若某步未找到则自动 fallback 保留在当前节点）
 */
export async function navigateTopology(startId: string, pathExpr: string): Promise<string> {
    if (!startId || !pathExpr) return startId || "";

    const rawSteps = pathExpr
        .split(/[._/]/)
        .map(s => s.trim().toLowerCase())
        .filter(s => Boolean(s) && s !== "id");

    if (rawSteps.length === 0) return startId;

    let currentNode = await fetchNodeMeta(startId);
    if (!currentNode) {
        // 若当前未查到元数据，可能是直接传入的笔记本 ID 或特殊 ID，保持不变
        return startId;
    }

    for (const step of rawSteps) {
        currentNode = await executeNavigationStep(currentNode, step);
    }

    return currentNode.id;
}

/**
 * 执行单步导航算子
 */
async function executeNavigationStep(current: TopologyNode, step: string): Promise<TopologyNode> {
    // ══════════════════════════════════════════════════════════════════
    // 0. 自指算子 (Self)
    // ══════════════════════════════════════════════════════════════════
    if (step === "self" || step === "this") {
        return current;
    }

    // ══════════════════════════════════════════════════════════════════
    // 1. 跨层级跃迁算子 (Cross-Level Leap)
    // ══════════════════════════════════════════════════════════════════

    // 1.1 doc: 跃迁到所属文档页面
    if (step === "doc" || step === "page") {
        if (current.type === "d") return current;
        if (current.root_id) {
            const docNode = await fetchNodeMeta(current.root_id);
            return docNode || current;
        }
        return current;
    }

    // 1.2 notebook / box: 跃迁到所属笔记本
    if (step === "notebook" || step === "box") {
        if (current.box) {
            return {
                id: current.box,
                type: "notebook",
                box: current.box
            };
        }
        return current;
    }

    // 1.3 root: 相对根跃迁（块 ➔ 文档页面；文档页面 ➔ 笔记本）
    if (step === "root") {
        if (current.type !== "d" && current.root_id) {
            const docNode = await fetchNodeMeta(current.root_id);
            return docNode || current;
        }
        if (current.box) {
            return {
                id: current.box,
                type: "notebook",
                box: current.box
            };
        }
        return current;
    }

    // 1.4 block[N]: 块层级跃迁（若当前为块指自身；若当前为页面则跃迁到页面内第 N 个顶级块）
    const blockMatch = step.match(/^block(\d+)?$/);
    if (blockMatch) {
        if (current.type !== "d") {
            return current;
        } else {
            const index = blockMatch[1] ? Math.max(1, parseInt(blockMatch[1], 10)) : 1;
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE root_id = '${current.id}' AND parent_id = '${current.id}' ORDER BY sort ASC LIMIT 1 OFFSET ${index - 1}`
                });
                const rows = Array.isArray(res) ? res : (res?.data || []);
                if (rows.length > 0) {
                    const blockChildNode = await fetchNodeMeta(rows[0].id);
                    if (blockChildNode) return blockChildNode;
                }
            } catch (_) {}
            return current;
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 2. 同层级保持算子 (Homogeneous Navigation)
    // ══════════════════════════════════════════════════════════════════

    // 2.1 prev[N]: 向前找同级第 N 个兄弟 (默认 N=1)
    const prevMatch = step.match(/^(?:prev|previous)(\d+)?$/);
    if (prevMatch) {
        const offset = prevMatch[1] ? Math.max(1, parseInt(prevMatch[1], 10)) : 1;
        if (current.type !== "d") {
            // 块的前向兄弟块
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE parent_id = '${current.parent_id}' AND sort < ${current.sort} ORDER BY sort DESC LIMIT 1 OFFSET ${offset - 1}`
                });
                const rows = Array.isArray(res) ? res : (res?.data || []);
                if (rows.length > 0) {
                    const siblingNode = await fetchNodeMeta(rows[0].id);
                    if (siblingNode) return siblingNode;
                }
            } catch (_) {}
            return current; // fallback 回自身
        } else {
            // 页面的前向同级页面（同一目录下）
            const siblingDoc = await findSiblingDoc(current, -offset);
            return siblingDoc || current;
        }
    }

    // 2.2 next[N]: 向后找同级第 N 个兄弟 (默认 N=1)
    const nextMatch = step.match(/^next(\d+)?$/);
    if (nextMatch) {
        const offset = nextMatch[1] ? Math.max(1, parseInt(nextMatch[1], 10)) : 1;
        if (current.type !== "d") {
            // 块的后向兄弟块
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE parent_id = '${current.parent_id}' AND sort > ${current.sort} ORDER BY sort ASC LIMIT 1 OFFSET ${offset - 1}`
                });
                const rows = Array.isArray(res) ? res : (res?.data || []);
                if (rows.length > 0) {
                    const siblingNode = await fetchNodeMeta(rows[0].id);
                    if (siblingNode) return siblingNode;
                }
            } catch (_) {}
            return current;
        } else {
            // 页面的后向同级页面
            const siblingDoc = await findSiblingDoc(current, offset);
            return siblingDoc || current;
        }
    }

    // 2.3 parent[N]: 向上找父级 (块找父块，页面找父页面)
    const parentMatch = step.match(/^parent(\d+)?$/);
    if (parentMatch) {
        let count = parentMatch[1] ? Math.max(1, parseInt(parentMatch[1], 10)) : 1;
        let walkNode = current;

        while (count > 0) {
            if (walkNode.type !== "d") {
                // 块级向上：如果已到达顶层块（parent_id === root_id），停止向上，保持为顶层块
                if (!walkNode.parent_id || walkNode.parent_id === walkNode.root_id) {
                    break;
                }
                const parentBlockNode = await fetchNodeMeta(walkNode.parent_id);
                if (!parentBlockNode || parentBlockNode.type === "d") {
                    break;
                }
                walkNode = parentBlockNode;
            } else {
                // 页面级向上：找文档树中的父级文档
                const parentDocNode = await findParentDoc(walkNode);
                if (!parentDocNode) break;
                walkNode = parentDocNode;
            }
            count--;
        }
        return walkNode;
    }

    // 2.4 child[N] / first_child / last_child: 向下找第 N 个子级
    const childMatch = step.match(/^(?:child|children)(\d+)?$/) || (step === "first" || step === "first_child" ? ["child1", "1"] : null) || (step === "last" || step === "last_child" ? ["last", "-1"] : null);
    if (childMatch) {
        const isLast = childMatch[1] === "-1";
        const index = isLast ? 1 : (childMatch[1] ? Math.max(1, parseInt(childMatch[1], 10)) : 1);
        const orderSql = isLast ? "ORDER BY sort DESC" : "ORDER BY sort ASC";

        if (current.type !== "d") {
            // 块的子块
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE parent_id = '${current.id}' ${orderSql} LIMIT 1 OFFSET ${index - 1}`
                });
                const rows = Array.isArray(res) ? res : (res?.data || []);
                if (rows.length > 0) {
                    const childNode = await fetchNodeMeta(rows[0].id);
                    if (childNode) return childNode;
                }
            } catch (_) {}
            return current;
        } else {
            // 页面的子级：优先找子文档，若无子文档则找页面内的顶级块
            const childDoc = await findChildDoc(current, index, isLast);
            if (childDoc) return childDoc;

            // 页面内直接顶级内容块
            try {
                const res = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE root_id = '${current.id}' AND parent_id = '${current.id}' ${orderSql} LIMIT 1 OFFSET ${index - 1}`
                });
                const rows = Array.isArray(res) ? res : (res?.data || []);
                if (rows.length > 0) {
                    const blockChildNode = await fetchNodeMeta(rows[0].id);
                    if (blockChildNode) return blockChildNode;
                }
            } catch (_) {}
            return current;
        }
    }

    // 未知算子保持当前节点不变
    return current;
}

// ══════════════════════════════════════════════════════════════════
// 文件树辅助查询函数 (Doc File Tree Helpers)
// ══════════════════════════════════════════════════════════════════

/**
 * 查询同目录下的相邻文档 (offset > 0 向后，offset < 0 向前)
 */
async function findSiblingDoc(docNode: TopologyNode, offset: number): Promise<TopologyNode | null> {
    if (!docNode.box) return null;

    // 笔记本文档 (Box Doc) 自身无同级文档兄弟
    if (docNode.id === docNode.box || docNode.path === "/" || !docNode.path) return null;

    const lastSlashIdx = docNode.path.lastIndexOf("/");
    const dirPath = lastSlashIdx <= 0 ? "/" : docNode.path.substring(0, lastSlashIdx + 1);

    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, path, box, type, sort FROM blocks WHERE type = 'd' AND box = '${docNode.box}' AND id != '${docNode.box}' AND path LIKE '${dirPath === "/" ? "/%" : dirPath + "%"}' AND path NOT LIKE '${dirPath === "/" ? "/%/%" : dirPath + "%/%"}' ORDER BY sort ASC`
        });
        const rows: any[] = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length <= 1) return null;

        const currentIndex = rows.findIndex(r => r.id === docNode.id);
        if (currentIndex === -1) return null;

        const targetIndex = currentIndex + offset;
        if (targetIndex >= 0 && targetIndex < rows.length) {
            return await fetchNodeMeta(rows[targetIndex].id);
        }
    } catch (e) {
        console.warn(`[TopologyNavigator] findSiblingDoc failed:`, e);
    }
    return null;
}

/**
 * 查询文档树中的父级文档
 */
async function findParentDoc(docNode: TopologyNode): Promise<TopologyNode | null> {
    if (!docNode.box) return null;

    // 笔记本文档 (Box Doc) 自身无父文档
    if (docNode.id === docNode.box || docNode.path === "/" || !docNode.path) return null;

    const parts = docNode.path.split("/").filter(Boolean);
    if (parts.length <= 1) {
        // 顶级文档：尝试获取所在笔记本的 Box Doc (若存在)
        const boxDocNode = await fetchNodeMeta(docNode.box);
        if (boxDocNode && boxDocNode.type === "d") {
            return boxDocNode;
        }
        return null;
    }

    // 父级文档的 path 为上一层路径拼接 .sy (如 /parentDocId/currentDocId.sy -> /parentDocId.sy)
    const parentPath = "/" + parts.slice(0, -1).join("/") + ".sy";
    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, path, box, type, sort FROM blocks WHERE type = 'd' AND box = '${docNode.box}' AND path = '${parentPath}' LIMIT 1`
        });
        const rows: any[] = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length > 0) {
            return await fetchNodeMeta(rows[0].id);
        }
    } catch (e) {
        console.warn(`[TopologyNavigator] findParentDoc failed:`, e);
    }
    return null;
}

/**
 * 查询子文档
 */
async function findChildDoc(docNode: TopologyNode, index: number, isLast: boolean): Promise<TopologyNode | null> {
    if (!docNode.box) return null;

    const isBoxDoc = docNode.id === docNode.box || docNode.path === "/" || !docNode.path;
    const cleanPathWithoutSy = isBoxDoc ? "" : docNode.path.replace(/\.sy$/, "");
    const orderSql = isLast ? "ORDER BY sort DESC" : "ORDER BY sort ASC";

    try {
        const wherePath = isBoxDoc 
            ? `path LIKE '/%' AND path NOT LIKE '/%/%' AND id != '${docNode.box}'`
            : `path LIKE '${cleanPathWithoutSy}/%' AND path NOT LIKE '${cleanPathWithoutSy}/%/%'`;

        const res = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, path, box, type, sort FROM blocks WHERE type = 'd' AND box = '${docNode.box}' AND ${wherePath} ${orderSql} LIMIT 1 OFFSET ${index - 1}`
        });
        const rows: any[] = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length > 0) {
            return await fetchNodeMeta(rows[0].id);
        }
    } catch (e) {
        console.warn(`[TopologyNavigator] findChildDoc failed:`, e);
    }
    return null;
}
