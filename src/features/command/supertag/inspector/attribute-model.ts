/**
 * attribute-model.ts
 *
 * IndexOS 统一属性管理数据聚合层：
 * 负责聚合指定块的内置属性 (name/alias/memo/bookmark)、Supertag 强类型属性与底层自定义属性 (custom-*)
 */

import { post } from "../../../../shared/api-client/request";
import { supertagAVProjector } from "../projection/supertag-av-projector";
import { getSqliteEngine } from "../../../sqlite/sqlite-manager";

export interface TypedFieldOption {
    id: string;
    name: string;
    color: string; // "1" ~ "8"
}

export interface TypedField {
    key: string;       // 去除 custom- 前缀的干净键名，如 "status", "priority"
    rawKey: string;    // 物理键名，如 "custom-status"
    label: string;     // UI 显示名称
    type: "select" | "mSelect" | "date" | "checkbox" | "number" | "text";
    value: string;     // 原始字符串值
    options?: TypedFieldOption[];
    tagSource?: string; // 来源 Supertag (若有)
}

export interface BlockAttributeData {
    blockId: string;
    rootId: string;
    blockType: string;
    content: string;
    supertags: string[];
    builtin: {
        bookmark: string;
        name: string;
        alias: string;
        memo: string;
    };
    typedFields: TypedField[];
    rawCustomFields: Array<{ key: string; rawKey: string; value: string }>;
    projectionInfo?: {
        isProjected: boolean;
        tagName?: string;
        tableName?: string;
    };
}

const KNOWN_SCHEMA_DEFS: Record<string, { label: string; type: "select" | "mSelect" | "date" | "checkbox" | "number" | "text"; defaultOptions?: string[] }> = {
    "status": { label: "状态", type: "select", defaultOptions: ["Todo", "Doing", "Done", "Hold", "Canceled"] },
    "index-task": { label: "状态", type: "select", defaultOptions: ["Todo", "Doing", "Done", "Hold", "Canceled"] },
    "priority": { label: "优先级", type: "select", defaultOptions: ["P0 紧急", "P1 重要", "P2 普通", "P3 低"] },
    "due": { label: "截止时间", type: "date" },
    "due_date": { label: "截止日期", type: "date" },
    "date": { label: "日期", type: "date" },
    "rating": { label: "评分", type: "number" },
    "progress": { label: "进度", type: "number" },
    "completed": { label: "是否完成", type: "checkbox" },
    "type": { label: "分类", type: "select" },
    "category": { label: "类别", type: "select" },
    "tags": { label: "标签", type: "mSelect" },
    "memo": { label: "备注", type: "text" },
    "url": { label: "链接", type: "text" }
};

export async function loadBlockAttributeData(blockId: string): Promise<BlockAttributeData> {
    const cleanId = blockId.trim();

    // 1. 获取物理属性
    let rawAttrs: Record<string, string> = {};
    try {
        const res = await post("/api/attr/getBlockAttrs", { id: cleanId });
        rawAttrs = res || {};
    } catch (e) {
        console.warn("[AttributeModel] 获取块属性异常:", e);
    }

    // 2. 获取块基础信息与内容
    let content = "";
    let rootId = "";
    let blockType = "NodeParagraph";
    try {
        const sqlRes = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, type, content, ial FROM blocks WHERE id = '${cleanId}' LIMIT 1`
        });
        const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
        if (rows.length > 0) {
            content = rows[0].content || "";
            rootId = rows[0].root_id || "";
            blockType = rows[0].type || "NodeParagraph";

            // 🌟 若当前块是列表项内的段落 (type 'p')，查询其父列表项 (type 'i') 属性进行融合提权
            if (blockType === "p" || blockType === "NodeParagraph") {
                try {
                    const parentSql = await post("/api/query/sql", {
                        stmt: `SELECT b2.id, b2.type, b2.ial FROM blocks b1 JOIN blocks b2 ON b1.parent_id = b2.id WHERE b1.id = '${cleanId}' AND b2.type = 'i' LIMIT 1;`
                    });
                    const parentRows = Array.isArray(parentSql) ? parentSql : (parentSql?.data || []);
                    if (parentRows.length > 0) {
                        const parentId = parentRows[0].id;
                        const parentAttrsRes = await post("/api/attr/getBlockAttrs", { id: parentId });
                        if (parentAttrsRes) {
                            rawAttrs = { ...parentAttrsRes, ...rawAttrs };
                        }
                    }
                } catch (_) {}
            }
        }
    } catch (_) {}

    // 3. 解析 Supertag 标签列表
    const tagSet = new Set<string>();
    if (rawAttrs["custom-supertags"]) {
        rawAttrs["custom-supertags"].split(/[,#\s]+/).map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    }
    if (rawAttrs["custom-index-tags"]) {
        rawAttrs["custom-index-tags"].split(/[,#\s]+/).map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    }
    // 从内容正文捕获 #tag# 或 #tag
    const tagMatches = content.match(/#([^#\s]+)#?/g);
    if (tagMatches) {
        tagMatches.forEach(t => tagSet.add(t.replace(/#/g, "").trim()));
    }
    const supertags = Array.from(tagSet);

    // 4. 解析内置属性
    const builtin = {
        bookmark: rawAttrs["bookmark"] || "",
        name: rawAttrs["name"] || "",
        alias: rawAttrs["alias"] || "",
        memo: rawAttrs["memo"] || ""
    };

    // 5. 区分类型化字段与原生未分类自定义属性
    const typedFields: TypedField[] = [];
    const rawCustomFields: Array<{ key: string; rawKey: string; value: string }> = [];

    const processedKeys = new Set<string>(["id", "updated", "bookmark", "name", "alias", "memo", "custom-supertags", "custom-index-tags"]);

    // 首先提取所有的 custom-* 属性
    for (const [k, v] of Object.entries(rawAttrs)) {
        if (processedKeys.has(k) || k.startsWith("custom-sy-") || k === "custom-riff-decks") continue;

        if (k.startsWith("custom-")) {
            const cleanKey = k.replace(/^custom-/, "");
            const schema = KNOWN_SCHEMA_DEFS[cleanKey];

            if (schema) {
                // 构建选项 (如果有)
                const options: TypedFieldOption[] = [];
                if (schema.defaultOptions) {
                    schema.defaultOptions.forEach((opt, idx) => {
                        options.push({
                            id: `opt_${cleanKey}_${opt}`,
                            name: opt,
                            color: String((idx % 8) + 1)
                        });
                    });
                }
                // 若当前值不在默认选项中，且非空，动态追加
                if (v && !options.some(o => o.name === v)) {
                    options.push({
                        id: `opt_${cleanKey}_${v}`,
                        name: v,
                        color: String((options.length % 8) + 1)
                    });
                }

                typedFields.push({
                    key: cleanKey,
                    rawKey: k,
                    label: schema.label,
                    type: schema.type,
                    value: v,
                    options: options.length > 0 ? options : undefined
                });
            } else {
                rawCustomFields.push({
                    key: cleanKey,
                    rawKey: k,
                    value: v
                });
            }
            processedKeys.add(k);
        }
    }

    // 如果挂载了已知标签 (如 #task)，但块上尚无 status/priority 等属性，依据 Schema 补充展示空白字段供用户填写
    if (supertags.includes("task") || supertags.includes("任务")) {
        const ensureKeys = ["status", "priority", "due"];
        for (const k of ensureKeys) {
            if (!typedFields.some(f => f.key === k)) {
                const schema = KNOWN_SCHEMA_DEFS[k];
                const options: TypedFieldOption[] = (schema.defaultOptions || []).map((opt, idx) => ({
                    id: `opt_${k}_${opt}`,
                    name: opt,
                    color: String((idx % 8) + 1)
                }));
                typedFields.push({
                    key: k,
                    rawKey: `custom-${k}`,
                    label: schema.label,
                    type: schema.type,
                    value: "",
                    options: options.length > 0 ? options : undefined,
                    tagSource: "task"
                });
            }
        }
    }

    // 6. 虚拟投影状态感知
    let projectionInfo = undefined;
    for (const tag of supertags) {
        // 检查是否存在绑定的热 SQLite 虚拟投影
        try {
            const { db } = await getSqliteEngine();
            const res = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'proj_%';`);
            if (res && res.length > 0 && res[0].values.length > 0) {
                projectionInfo = {
                    isProjected: true,
                    tagName: tag,
                    tableName: String(res[0].values[0][0])
                };
                break;
            }
        } catch (_) {}
    }

    return {
        blockId: cleanId,
        rootId,
        blockType,
        content,
        supertags,
        builtin,
        typedFields,
        rawCustomFields,
        projectionInfo
    };
}

/**
 * 设置/更新指定块属性并同步更新 SQLite 虚拟投影表
 */
export async function updateBlockAttributeValue(blockId: string, attrKey: string, attrValue: string): Promise<boolean> {
    const cleanId = blockId.trim();
    const isBuiltin = ["name", "alias", "memo", "bookmark"].includes(attrKey);
    const rawKey = isBuiltin ? attrKey : (attrKey.startsWith("custom-") ? attrKey : `custom-${attrKey}`);

    try {
        await post("/api/attr/setBlockAttrs", {
            id: cleanId,
            attrs: {
                [rawKey]: attrValue
            }
        });

        // 同步更新 SQLite 热投影表 (如果已挂载)
        try {
            const cleanColName = attrKey.replace(/^custom-/, "");
            const { db } = await getSqliteEngine();
            const tables = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'proj_%';`);
            if (tables && tables.length > 0 && tables[0].values.length > 0) {
                for (const row of tables[0].values) {
                    const tableName = String(row[0]);
                    try {
                        db.run(`UPDATE "${tableName}" SET "${cleanColName}" = ?, _updated = ? WHERE id = ?;`, [attrValue, Date.now(), cleanId]);
                    } catch (_) {}
                }
            }
        } catch (_) {}

        return true;
    } catch (e) {
        console.error("[AttributeModel] 更新属性失败:", e);
        return false;
    }
}

/**
 * 批量为块添加或移除 Supertag
 */
export async function toggleSupertagOnBlock(blockId: string, tag: string, action: "add" | "remove"): Promise<boolean> {
    const cleanId = blockId.trim();
    const cleanTag = tag.replace(/#/g, "").trim();

    try {
        const res = await post("/api/attr/getBlockAttrs", { id: cleanId });
        const curTagsStr = res?.["custom-supertags"] || "";
        const tagSet = new Set(curTagsStr.split(/[,#\s]+/).map(t => t.trim()).filter(Boolean));

        if (action === "add") {
            tagSet.add(cleanTag);
        } else {
            tagSet.delete(cleanTag);
        }

        const newTagsStr = Array.from(tagSet).join(",");
        await post("/api/attr/setBlockAttrs", {
            id: cleanId,
            attrs: {
                "custom-supertags": newTagsStr
            }
        });

        return true;
    } catch (e) {
        console.error("[AttributeModel] 修改 Supertag 失败:", e);
        return false;
    }
}
