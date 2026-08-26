/**
 * attribute-model.ts
 *
 * IndexOS 统一属性管理数据聚合层：
 * 负责两级大分类属性治理：
 * 1. 基础与零散属性 (Base & Ungoverned)：内置属性 (name/alias/memo/bookmark)、未归类 custom-* 属性、只读系统元数据
 * 2. 统一结构化属性 (Governed & Structured)：
 *    - Supertag 独占组件 (支持 custom-<tag>.<attr> 命名空间与全局共享回退)
 *    - 所属原生 AV 数据库属性 (支持 <dbName>.<colName> 解析与双向回写)
 */

import { post } from "../../../shared/api-client/request";
import { supertagAVProjector, getColumnMeta } from "../projection/supertag-av-projector";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { getColIDMap } from "../../../shared/utils/av-utils";
import { parseSupertags, serializeSupertags } from "../core/supertag-diff";

export interface TypedFieldOption {
    id: string;
    name: string;
    color: string; // "1" ~ "8"
}

export interface SystemMetadata {
    id: string;
    rootId: string;
    parentId: string;
    type: string;
    updated: string;
    created: string;
    contentLength: number;
    hpath?: string;
}

export interface BuiltinAttributes {
    bookmark: string;
    name: string;
    alias: string;
    memo: string;
}

export interface RawCustomField {
    key: string;
    rawKey: string;
    value: string;
}

export interface SupertagField {
    key: string;            // e.g. "status"
    fullKey: string;        // e.g. "task.status"
    rawKey: string;         // e.g. "custom-task-status" 或 "custom-status"
    label: string;          // e.g. "状态"
    type: "select" | "mSelect" | "date" | "checkbox" | "number" | "text";
    value: string;
    options?: TypedFieldOption[];
    isScoped: boolean;      // true 为独占命名空间属性，false 为全局共享属性
    tag: string;            // 所属 Tag，如 "task"
}

export interface SupertagGroup {
    tag: string;
    boundAvId?: string;
    boundAvName?: string;
    fields: SupertagField[];
}

export interface AVDatabaseField {
    keyId: string;
    colName: string;
    colType: string;
    displayValue: string;
    rawValue: any;
    options?: TypedFieldOption[];
    isReadonly: boolean;    // 公式、Rollup、只读列
}

export interface AVDatabaseGroup {
    avId: string;
    avName: string;
    itemId: string;
    isDuplicateName: boolean;
    fields: AVDatabaseField[];
}

export interface BlockAttributeData {
    blockId: string;
    rootId: string;
    blockType: string;
    content: string;
    supertags: string[];
    systemMeta: SystemMetadata;
    builtin: BuiltinAttributes;
    rawCustomFields: RawCustomField[];
    supertagGroups: SupertagGroup[];
    avGroups: AVDatabaseGroup[];
    projectionInfo?: {
        isProjected: boolean;
        tagName?: string;
        tableName?: string;
    };
}

const KNOWN_SCHEMA_DEFS: Record<string, { label: string; type: "select" | "mSelect" | "date" | "checkbox" | "number" | "text"; defaultOptions?: string[] }> = {
    "status": { label: "状态", type: "select", defaultOptions: ["Todo", "Doing", "Done", "Hold", "Canceled"] },
    "priority": { label: "优先级", type: "select", defaultOptions: ["P0 紧急", "P1 重要", "P2 普通", "P3 低"] },
    "due": { label: "截止时间", type: "date" },
    "due_date": { label: "截止日期", type: "date" },
    "date": { label: "日期", type: "date" },
    "rating": { label: "评分", type: "number" },
    "progress": { label: "进度", type: "number" },
    "completed": { label: "是否完成", type: "checkbox" },
    "health": { label: "生命值", type: "number" },
    "armor": { label: "护甲", type: "number" },
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
        rawAttrs = res?.data || res || {};
    } catch (e) {
        console.warn("[AttributeModel] 获取块属性异常:", e);
    }

    // 2. 获取块基础信息、系统元数据与父块信息
    let content = "";
    let rootId = "";
    let parentId = "";
    let blockType = "NodeParagraph";
    let updated = "";
    let created = "";
    let hpath = "";
    let contentLength = 0;

    try {
        const sqlRes = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, parent_id, type, content, length(content) as len, updated, created, hpath, ial FROM blocks WHERE id = '${cleanId}' LIMIT 1`
        });
        const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
        if (rows.length > 0) {
            const r = rows[0];
            content = r.content || "";
            rootId = r.root_id || "";
            parentId = r.parent_id || "";
            blockType = r.type || "NodeParagraph";
            updated = r.updated || "";
            created = r.created || "";
            hpath = r.hpath || "";
            contentLength = Number(r.len) || content.length;

            // 🌟 若当前块是列表项内的段落 (type 'p')，查询其父列表项 (type 'i') 属性进行融合提权
            if (blockType === "p" || blockType === "NodeParagraph") {
                try {
                    const parentSql = await post("/api/query/sql", {
                        stmt: `SELECT b2.id, b2.type, b2.ial FROM blocks b1 JOIN blocks b2 ON b1.parent_id = b2.id WHERE b1.id = '${cleanId}' AND b2.type = 'i' LIMIT 1;`
                    });
                    const parentRows = Array.isArray(parentSql) ? parentSql : (parentSql?.data || []);
                    if (parentRows.length > 0) {
                        const pId = parentRows[0].id;
                        const parentAttrsRes = await post("/api/attr/getBlockAttrs", { id: pId });
                        const pAttrs = parentAttrsRes?.data || parentAttrsRes || {};
                        rawAttrs = { ...pAttrs, ...rawAttrs };
                    }
                } catch (_) {}
            }
        }
    } catch (_) {}

    const systemMeta: SystemMetadata = {
        id: cleanId,
        rootId: rootId || cleanId,
        parentId: parentId || rootId || "",
        type: blockType,
        updated,
        created,
        contentLength,
        hpath
    };

    // 3. 解析 Supertag 标签列表
    const tagSet = new Set<string>();
    if (rawAttrs["custom-supertags"]) {
        parseSupertags(rawAttrs["custom-supertags"]).forEach(t => tagSet.add(t));
    }
    if (rawAttrs["custom-index-tags"]) {
        parseSupertags(rawAttrs["custom-index-tags"]).forEach(t => tagSet.add(t));
    }
    const tagMatches = content.match(/#([^#\s]+)#?/g);
    if (tagMatches) {
        tagMatches.forEach(t => tagSet.add(t.replace(/#/g, "").trim()));
    }
    const supertags = Array.from(tagSet);

    // 4. 解析内置属性
    const builtin: BuiltinAttributes = {
        bookmark: rawAttrs["bookmark"] || "",
        name: rawAttrs["name"] || "",
        alias: rawAttrs["alias"] || "",
        memo: rawAttrs["memo"] || ""
    };

    // 5. 结构化 Supertag 命名空间分组解析 (custom-<tag>.<attr> 与全局共享回退)
    const supertagGroupsMap = new Map<string, SupertagField[]>();
    const supertagBoundAvIds = new Set<string>();
    const supertagBoundAvNames = new Map<string, string>();

    for (const tag of supertags) {
        supertagGroupsMap.set(tag, []);
    }

    const processedKeys = new Set<string>([
        "id", "updated", "created", "bookmark", "name", "alias", "memo", "style",
        "custom-supertags", "custom-index-tags", "custom-avs", "av-names", "custom-av-name",
        "custom-av-names", "custom-index-buttons", "custom-index-db-config"
    ]);
    const rawCustomFields: RawCustomField[] = [];

    for (const [k, v] of Object.entries(rawAttrs)) {
        if (
            processedKeys.has(k) || 
            k.startsWith("custom-sy-") || 
            k === "custom-riff-decks" || 
            k.startsWith("custom-av-") ||
            k === "custom-avs" ||
            k === "av-names"
        ) continue;

        if (k.startsWith("custom-")) {
            const rawClean = k.replace(/^custom-/, "");

            // 严格按规范格式 custom-<tag>-<attr> 解析命名空间属性
            let matchedTag: string | null = null;
            let subAttrKey = rawClean;

            for (const tag of supertags) {
                if (rawClean.startsWith(`${tag}-`)) {
                    matchedTag = tag;
                    subAttrKey = rawClean.slice(tag.length + 1);
                    break;
                }
            }

            if (matchedTag) {
                // 独占命名空间属性 (支持通过 getColumnMeta 还原中文 Label 与列类型)
                const meta = getColumnMeta(matchedTag, subAttrKey);
                const schema = KNOWN_SCHEMA_DEFS[subAttrKey] || {
                    label: meta?.name || subAttrKey,
                    type: meta?.type || "text"
                };
                const options = buildFieldOptions(subAttrKey, schema, v);
                const field: SupertagField = {
                    key: subAttrKey,
                    fullKey: `${matchedTag}.${meta?.name || subAttrKey}`,
                    rawKey: k,
                    label: meta?.name || schema.label || subAttrKey,
                    type: meta?.type || schema.type,
                    value: v,
                    options,
                    isScoped: true,
                    tag: matchedTag
                };
                supertagGroupsMap.get(matchedTag)?.push(field);
                processedKeys.add(k);
            } else {
                // 检查是否为全局通用 schema 字段 (如 custom-status, custom-priority)
                const schema = KNOWN_SCHEMA_DEFS[rawClean];
                if (schema && supertags.length > 0) {
                    // 全局共享属性：挂载到所有 tag 下（如果没有独占属性覆盖的话）
                    for (const tag of supertags) {
                        const existingFields = supertagGroupsMap.get(tag) || [];
                        if (!existingFields.some(f => f.key === rawClean)) {
                            const options = buildFieldOptions(rawClean, schema, v);
                            existingFields.push({
                                key: rawClean,
                                fullKey: `${tag}.${rawClean} (共享)`,
                                rawKey: k,
                                label: schema.label || rawClean,
                                type: schema.type,
                                value: v,
                                options,
                                isScoped: false,
                                tag
                            });
                        }
                    }
                    processedKeys.add(k);
                } else {
                    rawCustomFields.push({
                        key: rawClean,
                        rawKey: k,
                        value: v
                    });
                    processedKeys.add(k);
                }
            }
        }
    }

    // 🌟 深度结合数据库列 Schema：为每个 Supertag 补充预设空列占位并丰富 Select 选项
    for (const tag of supertags) {
        const cleanTag = tag.replace(/^#/, "").trim().toLowerCase();
        const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();
        let boundAvId = supertagAVProjector.getBoundAv(cleanTag) || supertagAVProjector.getBoundAv(rootTag);
        if (!boundAvId) {
            const pref = supertagBinder.getPref(cleanTag) || supertagBinder.getPref(rootTag);
            if (pref && pref !== "disabled" && pref !== "enabled") {
                boundAvId = pref;
            }
        }

        if (boundAvId) {
            supertagBoundAvIds.add(boundAvId);
            try {
                const dbNameRes = await post("/api/query/sql", {
                    stmt: `SELECT content FROM blocks WHERE id = '${boundAvId}' LIMIT 1;`
                });
                const dbName = (Array.isArray(dbNameRes) && dbNameRes.length > 0) ? (dbNameRes[0].content || "专属数据库") : "专属数据库";
                supertagBoundAvNames.set(tag, dbName);

                const { keyValues } = await getColIDMap(boundAvId);
                const tagFields = supertagGroupsMap.get(tag) || [];

                for (const kv of keyValues) {
                    if (!kv.key) continue;
                    const colKey = kv.key.name;
                    const colType = kv.key.type;
                    if (colType === "block" || colKey === "主键" || colKey === "文档" || colKey === "Block" || colKey === "supertag") continue;

                    const colOptions: TypedFieldOption[] = (kv.key.options || []).map((opt: any, idx: number) => ({
                        id: opt.id || opt.name || `opt_${idx}`,
                        name: opt.name || opt.content || String(opt),
                        color: String(opt.color || (idx % 8) + 1)
                    }));

                    const existing = tagFields.find(f => f.key === colKey || f.label === colKey || f.rawKey.endsWith(`-${colKey}`));
                    if (existing) {
                        existing.label = colKey;
                        existing.type = colType as any;
                        if (colOptions.length > 0) {
                            existing.options = colOptions;
                        }
                    } else {
                        // 占位空字段（解决惰性写入后的可见性问题）
                        tagFields.push({
                            key: colKey,
                            fullKey: `${tag}.${colKey}`,
                            rawKey: `custom-${cleanTag}-${colKey}`,
                            label: colKey,
                            type: (colType as any) || "text",
                            value: "",
                            options: colOptions,
                            isScoped: true,
                            tag
                        });
                    }
                }
                supertagGroupsMap.set(tag, tagFields);
            } catch (err) {
                console.warn(`[AttributeModel] 拉取 Supertag #${tag} 关联数据库 Schema 失败:`, err);
            }
        }
    }

    const supertagGroups: SupertagGroup[] = Array.from(supertagGroupsMap.entries()).map(([tag, fields]) => ({
        tag,
        boundAvId: supertagAVProjector.getBoundAv(tag.replace(/^#/, "").trim().toLowerCase()) || undefined,
        boundAvName: supertagBoundAvNames.get(tag) || undefined,
        fields
    }));

    // 6. 所属原生 AV 数据库属性聚合 (<dbName>.<colName> 与重名预警，排除已被 Supertag 完整接管的库)
    const avGroups: AVDatabaseGroup[] = [];
    const joinedAvIds = new Set<string>();

    try {
        // ① 从 custom-avs 属性解析 (思源标准关联数据库)
        if (rawAttrs["custom-avs"]) {
            const rawAvs = String(rawAttrs["custom-avs"]).trim();
            try {
                if (rawAvs.startsWith("[") && rawAvs.endsWith("]")) {
                    const parsed = JSON.parse(rawAvs);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((id: any) => id && !supertagBoundAvIds.has(String(id).trim()) && joinedAvIds.add(String(id).trim()));
                    }
                } else {
                    rawAvs.split(/[,;\s]+/).forEach(id => id && !supertagBoundAvIds.has(id.trim()) && joinedAvIds.add(id.trim()));
                }
            } catch (_) {
                rawAvs.split(/[,;\s]+/).forEach(id => id && !supertagBoundAvIds.has(id.trim()) && joinedAvIds.add(id.trim()));
            }
        }

        // ② 从 custom-av-<avId> 属性解析
        for (const k of Object.keys(rawAttrs)) {
            if (k.startsWith("custom-av-") && k !== "custom-av-name" && k !== "custom-av-names" && k !== "custom-av-config") {
                const avId = k.replace(/^custom-av-/, "").trim();
                if (avId && !supertagBoundAvIds.has(avId)) joinedAvIds.add(avId);
            }
        }

        // ③ 从 av-names 属性反查 AV 库 ID
        if (rawAttrs["av-names"]) {
            const names = String(rawAttrs["av-names"]).split(/[,;\s]+/).map(n => n.trim()).filter(Boolean);
            for (const n of names) {
                try {
                    const sqlRes = await post("/api/query/sql", {
                        stmt: `SELECT id, content, ial FROM blocks WHERE type = 'av' AND (content = '${n}' OR ial LIKE '%${n}%') LIMIT 1;`
                    });
                    const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
                    if (rows.length > 0) {
                        const targetAvId = rows[0].id;
                        if (!supertagBoundAvIds.has(targetAvId)) {
                            joinedAvIds.add(targetAvId);
                        }
                    }
                } catch (_) {}
            }
        }

        // 辅助查询全局所有 AV 名称，用以判定重名
        const avNameCounts = new Map<string, number>();
        try {
            const allAvSql = await post("/api/query/sql", {
                stmt: `SELECT id, content, ial FROM blocks WHERE type = 'av' LIMIT 200;`
            });
            const avRows = Array.isArray(allAvSql) ? allAvSql : (allAvSql?.data || []);
            avRows.forEach((r: any) => {
                const n = (r.content || "").trim() || "未命名数据库";
                avNameCounts.set(n, (avNameCounts.get(n) || 0) + 1);
            });
        } catch (_) {}

        for (const avId of Array.from(joinedAvIds)) {
            try {
                const { keyValues, blockToItem, idToType } = await getColIDMap(avId);
                
                // 智能解析 itemId
                let itemId = blockToItem.get(cleanId);
                if (!itemId && parentId) itemId = blockToItem.get(parentId);
                if (!itemId && rootId) itemId = blockToItem.get(rootId);

                // 深度遍历 keyValues 匹配 block
                if (!itemId) {
                    for (const kv of keyValues) {
                        if (kv.values && Array.isArray(kv.values)) {
                            for (const v of kv.values) {
                                const cellBid = v.block?.id || (v.type === 'block' ? (v.content || v.text?.content || v.block?.content) : null);
                                if (cellBid === cleanId || (parentId && cellBid === parentId) || cellBid === rootId) {
                                    itemId = v.itemID || v.itemId || v.blockID || v.id;
                                    break;
                                }
                            }
                        }
                        if (itemId) break;
                    }
                }

                // 若仍未获取到 itemId，使用当前 blockId 作为兜底 item 标识
                if (!itemId) {
                    itemId = cleanId;
                }

                // 获取 AV 名称 (优先 API，兜底 SQL 与 ID)
                let avName = "";
                try {
                    const avDoc = await post("/api/av/getAttributeView", { id: avId });
                    if (avDoc?.name || avDoc?.av?.name) {
                        avName = (avDoc.name || avDoc.av.name).trim();
                    }
                } catch (_) {}

                if (!avName) {
                    try {
                        const sqlRes = await post("/api/query/sql", {
                            stmt: `SELECT content FROM blocks WHERE id = '${avId}' OR ial LIKE '%data-av-id="${avId}"%' LIMIT 1;`
                        });
                        const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
                        if (rows.length > 0 && rows[0].content) {
                            avName = rows[0].content.trim();
                        }
                    } catch (_) {}
                }

                if (!avName) {
                    avName = `数据库 ${avId.slice(0, 8)}`;
                }

                const isDuplicateName = (avNameCounts.get(avName) || 0) > 1;
                const fields: AVDatabaseField[] = [];

                for (const kv of keyValues) {
                    const keyId = kv.key.id;
                    const colName = kv.key.name || "未命名列";
                    const colType = kv.key.type || idToType[keyId] || "text";

                    // 忽略主列 block
                    if (colType === "block") continue;

                    const isReadonly = ["rollup", "formula", "created", "updated"].includes(colType);

                    // 提取单元格值
                    let displayValue = "";
                    let rawValue: any = null;
                    const valuesArr = kv.values || [];
                    const cell = valuesArr.find((v: any) => (v.itemID || v.itemId || v.id) === itemId);

                    if (cell) {
                        rawValue = cell;
                        if (cell.text?.content !== undefined) displayValue = cell.text.content;
                        else if (cell.number?.content !== undefined) displayValue = String(cell.number.content);
                        else if (cell.mSelect) displayValue = cell.mSelect.map((o: any) => o.content).join(", ");
                        else if (cell.date?.formattedContent) displayValue = cell.date.formattedContent;
                        else if (cell.checkbox) displayValue = cell.checkbox.checked ? "true" : "false";
                        else if (cell.content) displayValue = String(cell.content);
                    }

                    // 提取列选项 (如果有)
                    const options: TypedFieldOption[] = [];
                    if (kv.key.options && Array.isArray(kv.key.options)) {
                        kv.key.options.forEach((opt: any, idx: number) => {
                            options.push({
                                id: opt.id || `opt_${idx}`,
                                name: opt.name || opt.content || "",
                                color: opt.color || String((idx % 8) + 1)
                            });
                        });
                    }

                    fields.push({
                        keyId,
                        colName,
                        colType,
                        displayValue,
                        rawValue,
                        options: options.length > 0 ? options : undefined,
                        isReadonly
                    });
                }

                avGroups.push({
                    avId,
                    avName,
                    itemId,
                    isDuplicateName,
                    fields
                });
            } catch (avErr) {
                console.warn(`[AttributeModel] 解析所属 AV ${avId} 失败:`, avErr);
            }
        }
    } catch (err) {
        console.error("[AttributeModel] 数据库关联解析异常:", err);
    }

    // 7. 虚拟投影状态感知
    let projectionInfo = undefined;
    for (const tag of supertags) {
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
        systemMeta,
        builtin,
        rawCustomFields,
        supertagGroups,
        avGroups,
        projectionInfo
    };
}

function buildFieldOptions(key: string, schema: any, curVal: string): TypedFieldOption[] {
    const options: TypedFieldOption[] = [];
    const defaults = schema.defaultOptions || [];
    
    defaults.forEach((optName: string, idx: number) => {
        options.push({
            id: `opt_${idx}`,
            name: optName,
            color: String((idx % 8) + 1)
        });
    });

    if (curVal && !defaults.includes(curVal)) {
        options.push({
            id: `opt_custom`,
            name: curVal,
            color: "1"
        });
    }

    return options;
}

/**
 * 实时更新块自定义属性 / 基础属性
 */
export async function updateBlockAttributeValue(blockId: string, attrKey: string, attrValue: string): Promise<boolean> {
    const cleanId = blockId.trim();
    if (!cleanId || !attrKey) return false;

    try {
        await post("/api/attr/setBlockAttrs", {
            id: cleanId,
            attrs: {
                [attrKey]: attrValue
            }
        });
        return true;
    } catch (e) {
        console.error(`[AttributeModel] 保存块属性 ${attrKey} 失败:`, e);
        return false;
    }
}

/**
 * 实时更新原生 AV 数据库的单元格属性值
 */
export async function updateAVCellAttributeValue(avId: string, keyId: string, itemId: string, newValue: string, colType: string): Promise<boolean> {
    if (!avId || !keyId || !itemId) return false;

    try {
        let valuePayload: any = null;

        if (colType === "number") {
            const num = Number(newValue);
            valuePayload = {
                number: {
                    content: isNaN(num) ? 0 : num,
                    isNotEmpty: newValue.trim() !== ""
                }
            };
        } else if (colType === "date") {
            const ts = new Date(newValue).getTime();
            valuePayload = {
                date: {
                    content: isNaN(ts) ? Date.now() : ts,
                    isNotEmpty: newValue.trim() !== "",
                    hasEndDate: false
                }
            };
        } else if (colType === "checkbox") {
            valuePayload = {
                checkbox: {
                    checked: newValue === "true" || newValue === "1"
                }
            };
        } else if (colType === "select" || colType === "mSelect") {
            valuePayload = {
                mSelect: [{
                    id: `opt_${Date.now()}`,
                    content: newValue,
                    color: "1"
                }]
            };
        } else {
            valuePayload = {
                text: {
                    content: newValue
                }
            };
        }

        await post("/api/av/batchSetAttributeViewBlockAttrs", {
            avID: avId,
            values: [{
                keyID: keyId,
                itemID: itemId,
                value: valuePayload
            }]
        });

        return true;
    } catch (e) {
        console.error(`[AttributeModel] 回写原生 AV ${avId} 单元格失败:`, e);
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
        const curAttrs = res?.data || res || {};
        const curTags = parseSupertags(curAttrs["custom-supertags"] || "");
        const tagSet = new Set(curTags);

        if (action === "add") {
            tagSet.add(cleanTag);
        } else {
            tagSet.delete(cleanTag);
        }

        const newTagsStr = serializeSupertags(Array.from(tagSet));
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
