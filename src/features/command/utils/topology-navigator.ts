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

export async function fetchNodeMeta(id: string): Promise<TopologyNode | null> {
    if (!id || typeof id !== "string") return null;
    const cleanId = id.trim();

    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, parent_id, path, box, type, sort FROM blocks WHERE id = '${cleanId}' LIMIT 1`
        });
        const rows = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length > 0) {
            return {
                id: rows[0].id,
                type: rows[0].type,
                root_id: rows[0].root_id,
                parent_id: rows[0].parent_id,
                box: rows[0].box,
                path: rows[0].path,
                sort: typeof rows[0].sort === "number" ? rows[0].sort : parseInt(rows[0].sort || "0", 10)
            };
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

        if (current.type !== "d") {
            // 块的子块
            try {
                const orderSql = isLast ? "ORDER BY sort DESC" : "ORDER BY sort ASC";
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
            return (await findChildDoc(current, index, isLast)) || current;
        }
    }

    // 未知算子保持当前节点不变
    return current;
}

// ══════════════════════════════════════════════════════════════════
// 文件树辅助查询函数 (Doc File Tree Helpers)
// ══════════════════════════════════════════════════════════════════

/**
 * 获取当前笔记本的生效文档排序模式 (SortMode)
 * 思源规范：
 * 0: 文件名升序, 1: 文件名降序, 2: 更新时间升序, 3: 更新时间降序,
 * 4/5: 自然排序, 6: 自定义排序 (默认最常用), 9: 创建时间升序, 10: 创建时间降序,
 * 15: 继承全局 fileTree.sort
 */
function getNotebookSortMode(boxId: string): number {
    try {
        const globalSort = (window as any).siyuan?.config?.fileTree?.sort ?? 6;
        const notebookEl = document.querySelector(`ul[data-box="${boxId}"]`) || document.querySelector(`li[data-box="${boxId}"]`)?.parentElement;
        const rawSortMode = notebookEl?.getAttribute("data-sortmode");
        if (rawSortMode && rawSortMode !== "15") {
            const parsed = parseInt(rawSortMode, 10);
            if (!isNaN(parsed)) return parsed;
        }
        return globalSort;
    } catch (_) {
        return 6;
    }
}

/**
 * 根据 sortMode 生成精确对齐思源视觉文档树的 SQL ORDER BY 子句
 */
function getDocOrderByClause(sortMode: number, isReverse: boolean = false): string {
    switch (sortMode) {
        case 0: // 文件名升序
            return isReverse ? "ORDER BY content DESC" : "ORDER BY content ASC";
        case 1: // 文件名降序
            return isReverse ? "ORDER BY content ASC" : "ORDER BY content DESC";
        case 2: // 更新时间升序
            return isReverse ? "ORDER BY updated DESC" : "ORDER BY updated ASC";
        case 3: // 更新时间降序
            return isReverse ? "ORDER BY updated ASC" : "ORDER BY updated DESC";
        case 9: // 创建时间升序
            return isReverse ? "ORDER BY created DESC" : "ORDER BY created ASC";
        case 10: // 创建时间降序
            return isReverse ? "ORDER BY created ASC" : "ORDER BY created DESC";
        case 6: // 自定义拖拽排序 (思源默认真理源：blocks 表中的 sort 整数)
        default:
            return isReverse ? "ORDER BY sort DESC, created DESC" : "ORDER BY sort ASC, created ASC";
    }
}

/**
 * 查询同目录下的相邻文档 (offset > 0 向后，offset < 0 向前)
 * 单一权威源：基于 SQLite blocks 目录路径与真实排序字段纯净计算
 */
async function findSiblingDoc(docNode: TopologyNode, offset: number): Promise<TopologyNode | null> {
    if (!docNode.box || !docNode.path || docNode.id === docNode.box || docNode.path === "/") {
        return null;
    }

    // 提取同级目录前缀 (例如: /parent/doc.sy ➔ "/parent/"; 根目录 /doc.sy ➔ "/")
    const lastSlashIdx = docNode.path.lastIndexOf("/");
    const dirPrefix = lastSlashIdx <= 0 ? "/" : docNode.path.substring(0, lastSlashIdx + 1);

    const sqlFilter = dirPrefix === "/"
        ? `(path NOT LIKE '/%/%' OR path IS NULL)`
        : `(path LIKE '${dirPrefix}%' AND path NOT LIKE '${dirPrefix}%/%')`;

    const sortMode = getNotebookSortMode(docNode.box);
    const orderClause = getDocOrderByClause(sortMode);

    console.group(`[TopologyNavigator] 🔍 寻找兄弟文档 (docNode=${docNode.id}, offset=${offset})`);
    console.log(`📂 当前路径: "${docNode.path}", 目录前缀: "${dirPrefix}", SortMode: ${sortMode} ("${orderClause}")`);

    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, path, box, type, sort, content, updated, created FROM blocks WHERE type = 'd' AND box = '${docNode.box}' AND id != '${docNode.box}' AND ${sqlFilter} ${orderClause}`
        });
        const rows: any[] = Array.isArray(res) ? res : (res?.data || []);
        console.log(`📋 同级文档列表 (${rows.length} 篇):`, rows.map((r, i) => `[${i}] ${r.id} (${r.content || r.path}) [sort=${r.sort}]`));

        if (rows.length <= 1) {
            console.warn(`⚠️ 目录下仅有 ${rows.length} 篇文档，无同级兄弟`);
            console.groupEnd();
            return null;
        }

        const currentIndex = rows.findIndex(r => r.id === docNode.id || r.path === docNode.path);
        console.log(`🎯 当前文档在同级中的 Index: ${currentIndex} / ${rows.length}`);

        if (currentIndex === -1) {
            console.warn(`⚠️ 当前文档未在同级列表中找到`);
            console.groupEnd();
            return null;
        }

        const targetIndex = currentIndex + offset;
        if (targetIndex >= 0 && targetIndex < rows.length) {
            const targetId = rows[targetIndex].id;
            console.log(`✅ 成功定位兄弟文档 [index ${targetIndex}]: id=${targetId} (${rows[targetIndex].content || ''})`);
            console.groupEnd();
            return await fetchNodeMeta(targetId);
        } else {
            console.warn(`⚠️ 目标索引越界: ${targetIndex} (有效范围 0 ~ ${rows.length - 1})，已达首尾边界`);
        }
    } catch (e) {
        console.error(`❌ 查询兄弟文档异常:`, e);
    }

    console.groupEnd();
    return null;
}

/**
 * 查询文档树中的父级文档
 */
async function findParentDoc(docNode: TopologyNode): Promise<TopologyNode | null> {
    if (!docNode.box || docNode.id === docNode.box || docNode.path === "/" || !docNode.path) return null;

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
 * 查询子文档或页面首块
 */
async function findChildDoc(docNode: TopologyNode, index: number, isLast: boolean): Promise<TopologyNode | null> {
    if (!docNode.box) return null;

    const isBoxDoc = docNode.id === docNode.box || docNode.path === "/" || !docNode.path;
    const cleanPathWithoutSy = isBoxDoc ? "" : docNode.path.replace(/\.sy$/, "");
    const sortMode = getNotebookSortMode(docNode.box);
    const orderSql = getDocOrderByClause(sortMode, isLast);

    console.group(`[TopologyNavigator] 🔍 寻找子级 (docNode=${docNode.id}, isBoxDoc=${isBoxDoc}, index=${index}, isLast=${isLast}, sortMode=${sortMode})`);

    // 1. 优先查找子文档
    try {
        const wherePath = isBoxDoc 
            ? `(path NOT LIKE '/%/%' OR path IS NULL)`
            : `(path LIKE '${cleanPathWithoutSy}/%' AND path NOT LIKE '${cleanPathWithoutSy}/%/%')`;

        const res = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, path, box, type, sort, content, updated, created FROM blocks WHERE type = 'd' AND box = '${docNode.box}' AND id != '${docNode.id}' AND ${wherePath} ${orderSql} LIMIT 1 OFFSET ${index - 1}`
        });
        const rows: any[] = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length > 0) {
            console.log(`✅ 命中子文档: id=${rows[0].id}, path=${rows[0].path}`);
            console.groupEnd();
            return await fetchNodeMeta(rows[0].id);
        }
    } catch (e) {
        console.warn(`[TopologyNavigator] 查询子文档异常:`, e);
    }

    // 2. 若无子文档，查找页面内的顶级正文块
    try {
        const res = await post("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE root_id = '${docNode.id}' AND parent_id = '${docNode.id}' ${orderSql} LIMIT 1 OFFSET ${index - 1}`
        });
        const rows = Array.isArray(res) ? res : (res?.data || []);
        if (rows.length > 0) {
            console.log(`✅ 命中页面顶级内容块: id=${rows[0].id}`);
            console.groupEnd();
            return await fetchNodeMeta(rows[0].id);
        }
    } catch (_) {}

    console.groupEnd();
    return null;
}
