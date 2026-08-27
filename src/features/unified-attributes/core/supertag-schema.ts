/**
 * supertag-schema.ts
 *
 * Supertag 元数据 Schema 字典与 Label ↔ Slug 确定性双向翻译网关
 * 负责解决 AV 数据库富类型/任意列名与底层思源块自定义属性 (custom-*) 之间的不对称阻抗。
 * 
 * 核心架构规则：
 * 1. 100% 1:1 实体强绑定模型：每个 Supertag 必然对应一个在 /data-dbs 中的同名 AV 数据库；
 * 2. 自动建库（Zero-Config）：新建 Supertag 时自动在 /data-dbs 创建同名 AV；
 * 3. 预判断（Pre-flight JIT Schema Evolution）：属性写入前检查 AV 列结构，不存在则自动扩列，并生成合规 slug；
 * 4. 0 冗余 Schema 存储：以原生 AV 数据库结构作为唯一真理源。
 */

import { post } from "../../../shared/api-client/request";
import { getSupertagDbRecords, SYSTEM_EXCLUDED_SUPERTAGS, isIdLike } from "./supertag-entity";
import { supertagBinder } from "./supertag-binder";
import { supertagAVProjector } from "../projection/supertag-av-projector";
import { getOrCreateDataDbsParentDoc } from "../../command/data-db-management";
import { NOTEBOOK_NAME } from "../../command/indexos/seed-data";
import { getTypeAvId } from "../../command/registration";
import { getAVSchema, instantiateAV, executeWritableSql, runQuery, avIdToTableName, registerFriendlyTableName } from "../../sqlite/sqlite-manager";

export interface SupertagFieldOption {
    id: string;
    name: string;
    color: string; // "1" ~ "8"
}

export interface SupertagFieldSchema {
    slug: string;        // 物理存储键标识符，如 "status", "due-date" (必须满足 ^[a-z][a-z0-9-]*$)
    label: string;       // 前端友好展示名，如 "任务状态 🎯", "截止日期", "Price ($)"
    type: "select" | "mSelect" | "date" | "checkbox" | "number" | "text";
    options?: SupertagFieldOption[];
    description?: string;
}

/** 常用词汇快速语义映射表 */
const COMMON_LABEL_SLUGS: Record<string, string> = {
    "状态": "status",
    "任务状态": "status",
    "优先级": "priority",
    "截止": "due",
    "截止日期": "due",
    "截止时间": "due",
    "日期": "date",
    "创建时间": "created",
    "更新时间": "updated",
    "进度": "progress",
    "备注": "memo",
    "负责人": "lead",
    "执行人": "assignee",
    "类型": "type",
    "分类": "category",
    "标签": "tags",
    "金额": "amount",
    "价格": "price",
    "成本": "cost",
    "评分": "rating",
    "标题": "title",
    "描述": "desc",
    "内容": "content",
    "难度": "difficulty",
    "耗时": "duration",
    "权重": "weight",
    "血量": "hp",
    "生命值": "hp",
    "魔法值": "mp",
    "攻击力": "atk",
    "防御力": "def",
    "作者": "author",
    "来源": "source",
    "链接": "url"
};

/**
 * 1. 任意字符串 -> 100% 合规且无损可逆的 ASCII 属性 Slug (满足以小写字母开头，仅含 a-z, 0-9, -)
 */
export function encodeAttrSlug(rawName: string): string {
    const raw = (rawName || "").trim();
    if (!raw) return "field";

    // 1. 检查常用预设词典
    if (COMMON_LABEL_SLUGS[raw]) {
        return COMMON_LABEL_SLUGS[raw];
    }

    // 2. 若原本就是合规的 ASCII 小写字母/数字/连字符（如 "createdblock", "status", "due-date"）
    // 且以小写字母开头，直接保留（人类高可读）
    if (/^[a-z][a-z0-9\-]*$/.test(raw)) {
        return raw;
    }

    // 3. 含有中文、Emoji、空格、大写字母或特殊符号 -> 转换为 UTF-8 字节十六进制，前缀 u-
    const bytes = new TextEncoder().encode(raw);
    const hex = Array.from(bytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

    return `u-${hex}`;
}

/**
 * 2. ASCII 属性 Slug -> 100% 无损还原原始中英文/Emoji 字段名 (解码)
 */
export function decodeAttrSlug(slug: string): string {
    if (!slug) return "";
    
    // 如果是 Unicode Hex 编码前缀 u-
    if (slug.startsWith("u-")) {
        const hex = slug.slice(2);
        try {
            const bytes = new Uint8Array(
                (hex.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16))
            );
            return new TextDecoder().decode(bytes);
        } catch {
            return slug;
        }
    }

    // 检查反向预设词典
    for (const [zh, en] of Object.entries(COMMON_LABEL_SLUGS)) {
        if (en === slug) return zh;
    }

    // 否则直接就是原生的 ASCII 字段名
    return slug;
}

/**
 * 兼容别名：slugify 统一采用 encodeAttrSlug
 */
export function slugify(label: string): string {
    return encodeAttrSlug(label);
}

/**
 * 物理属性 Key 生成网关: custom-${tag}-${slug}
 */
export function getPhysicalAttrKey(tagName: string, slug: string): string {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    const cleanSlug = encodeAttrSlug(slug);
    return `custom-${cleanTag}-${cleanSlug}`;
}

/**
 * 物理属性 Key 解析: custom-task-status -> { tag: "task", slug: "status", originalName: "状态" }
 */
export function parsePhysicalAttrKey(rawKey: string): { tag: string; slug: string; originalName: string } | null {
    if (!rawKey || !rawKey.startsWith("custom-")) return null;
    const body = rawKey.slice(7); // 去掉 custom-
    const firstDash = body.indexOf("-");
    if (firstDash === -1) {
        return { tag: "", slug: body, originalName: decodeAttrSlug(body) };
    }
    const tag = body.slice(0, firstDash);
    const slug = body.slice(firstDash + 1);
    return { tag, slug, originalName: decodeAttrSlug(slug) };
}

const inFlightCreations = new Map<string, Promise<string>>();

/**
 * 确保 Supertag 关联的 AV 数据库名称与 Supertag 保持一致（重命名联动）
 */
export async function syncSupertagDatabaseName(cleanTag: string, avId: string): Promise<void> {
    if (!cleanTag || !avId || isIdLike(cleanTag) || SYSTEM_EXCLUDED_SUPERTAGS.has(cleanTag)) return;

    try {
        const res = await post("/api/av/getAttributeView", { id: avId });
        const av = res?.av || res;
        const currentName = (av?.name || "").trim().toLowerCase();
        
        if (currentName && currentName !== cleanTag.toLowerCase() && currentName !== "unnamed" && currentName !== "unnamed database") {
            console.log(`[SupertagSchema] 🏷️ 捕获 Supertag 重命名: #${currentName} -> #${cleanTag}，联动更新关联 AV 数据库 (${avId}) 名称...`);
            
            // 1. 发送事务更新 AV 标题
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{
                    doOperations: [{
                        action: "setAttrViewName",
                        id: avId,
                        data: cleanTag
                    }]
                }]
            });

            // 2. 更新 AV 宿主块的属性
            try {
                const sqlRes = await post("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE id = '${avId}' OR ial LIKE '%${avId}%' LIMIT 1` });
                const blockId = sqlRes?.[0]?.id;
                if (blockId) {
                    await post("/api/attr/setBlockAttrs", {
                        id: blockId,
                        attrs: {
                            "custom-supertag-tag": cleanTag,
                            "custom-supertag-id": cleanTag,
                            "custom-av-name": cleanTag
                        }
                    });
                }
            } catch (_) {}

            // 3. 注册新表名
            registerFriendlyTableName(cleanTag, avId);
        }
    } catch (_) {}
}

/**
 * 确保 Supertag 对应的 AV 数据库存在（Zero-Config 自动建库网关）
 */
export async function ensureSupertagDatabase(tagName: string): Promise<string> {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    if (!cleanTag || isIdLike(cleanTag) || SYSTEM_EXCLUDED_SUPERTAGS.has(cleanTag)) {
        return "";
    }

    if (inFlightCreations.has(cleanTag)) {
        return inFlightCreations.get(cleanTag)!;
    }

    const checkAvExists = async (id: string): Promise<boolean> => {
        if (!id) return false;
        try {
            // 真实物理存在性校验：确保在活跃的 blocks 表中能查到该 AV 块，避免死链/幽灵ID
            const sql = `SELECT id FROM blocks WHERE (type = 'av' AND (markdown LIKE '%${id}%' OR ial LIKE '%${id}%' OR content LIKE '%${id}%')) OR id = '${id}' LIMIT 1`;
            const res = await post("/api/query/sql", { stmt: sql });
            return Boolean(res && res.length > 0);
        } catch {
            return false;
        }
    };

    const task = (async () => {
        try {
            // 1. 检查当前是否已绑定有效且真实存在的 AV 数据库
            const prefAvId = supertagBinder.getPref(cleanTag);
            if (prefAvId && await checkAvExists(prefAvId)) {
                return prefAvId;
            }

            const records = await getSupertagDbRecords();
            const existingRec = records.find(r => r.typeTag === cleanTag && r.relatedAv);
            if (existingRec && existingRec.relatedAv && await checkAvExists(existingRec.relatedAv)) {
                await supertagBinder.setPref(cleanTag, existingRec.relatedAv);
                supertagAVProjector.bindTagToAV(cleanTag, existingRec.relatedAv);
                return existingRec.relatedAv;
            }

            // 检查友好表名映射中是否已有可用的 AV ID
            try {
                const mappedId = resolveTableAvId(cleanTag);
                if (mappedId && await checkAvExists(mappedId)) {
                    await supertagBinder.setPref(cleanTag, mappedId);
                    supertagAVProjector.bindTagToAV(cleanTag, mappedId);
                    return mappedId;
                }
            } catch (_) {}

            // 2. 自动在 /data-dbs 中追加创建同名 AV 数据库
            console.log(`[SupertagSchema] 🚀 为 #${cleanTag} 在 /data-dbs 中创建同名 AV 数据库...`);
            const nbRes = await post("/api/notebook/lsNotebooks", {});
            const notebooks = nbRes?.notebooks || [];
            const targetNotebook = notebooks.find((n: any) => n.name === NOTEBOOK_NAME && !n.closed) || notebooks.find((n: any) => !n.closed) || notebooks[0];
            if (!targetNotebook) {
                console.warn("[SupertagSchema] 未找到可用笔记本");
                return "";
            }

            const dataDbsDocId = await getOrCreateDataDbsParentDoc(targetNotebook.id);
            if (!dataDbsDocId) {
                console.warn("[SupertagSchema] 创建或获取 /data-dbs 页面失败");
                return "";
            }

            // 创建新数据库（默认包含主键 BLOCK 列）
            const ddlSql = `CREATE TABLE "${cleanTag}" ( "主键" BLOCK );`;
            const ddlRes = await executeWritableSql(ddlSql, { targetDocId: dataDbsDocId });
            const avId = ddlRes?.avId || "";
            const avBlockId = ddlRes?.blockId || "";
            console.log(`[SupertagSchema] ✓ 成功为 #${cleanTag} 创建 AV 数据库: avId=${avId}`);

            if (avId) {
                // 立即在内存中绑定，防止后续轮询产生竞态与重复建库
                await supertagBinder.setPref(cleanTag, avId);
                supertagAVProjector.bindTagToAV(cleanTag, avId);

                if (avBlockId) {
                    try {
                        await post("/api/attr/setBlockAttrs", {
                            id: avBlockId,
                            attrs: {
                                "custom-supertag-tag": cleanTag,
                                "custom-supertag-id": cleanTag,
                                "custom-av-name": cleanTag
                            }
                        });
                    } catch (_) {}
                }

                // 更新 supertag-db 系统表 (使用 SiYuan 原生 API 批量写属性，不使用 DML)
                const typeAvId = getTypeAvId();
                if (typeAvId) {
                    try {
                        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: typeAvId });
                        const keys = Array.isArray(keysRes) ? keysRes : (keysRes?.keys || []);
                        const relKey = keys.find((k: any) => k.name === "Related av" || k.name === "relatedAv");
                        const primaryKey = keys.find((k: any) => k.type === "block" || k.name === "主键");
                        
                        const rowsRes = await post("/api/av/renderAttributeView", { id: typeAvId, page: 1, pageSize: 100 });
                        const avRows = rowsRes?.data?.view?.rows || rowsRes?.view?.rows || rowsRes?.rows || [];

                        const targetRow = avRows.find((r: any) => {
                            const pkCell = r.cells?.find((c: any) => c.keyID === primaryKey?.id) || r.cells?.[0];
                            const tagContent = pkCell?.value?.block?.content || pkCell?.value?.text?.content || "";
                            return tagContent.replace(/^#+/, "").trim().toLowerCase() === cleanTag;
                        });

                        if (targetRow && relKey) {
                            await post("/api/av/setAttributeViewBlockAttr", {
                                avID: typeAvId,
                                keyID: relKey.id,
                                itemID: targetRow.id,
                                value: { type: "text", text: { content: avId } }
                            });
                            console.log(`[SupertagSchema] ✓ 成功回写 supertag-db 行 ${targetRow.id} 的 Related av = ${avId}`);
                        }
                    } catch (updateErr) {
                        console.warn(`[SupertagSchema] 回写 supertag-db 失败:`, updateErr);
                    }
                }

                window.dispatchEvent(new CustomEvent("index-plugin-refresh-supertags"));
                return avId;
            }
        } catch (e) {
            console.error(`[SupertagSchema] 自动为 #${cleanTag} 创建 AV 数据库失败:`, e);
        } finally {
            inFlightCreations.delete(cleanTag);
        }
        return "";
    })();

    inFlightCreations.set(cleanTag, task);
    return task;
}

/**
 * 属性预判断网关 (Pre-flight JIT Schema Evolution)
 * 针对任何挂载在 Supertag 上的属性操作：
 * 1. 确保关联 AV 存在；
 * 2. 检查属性列是否存在，不存在则实时动态扩列 (JIT Add Column)；
 * 3. 产出标准的物理存储 custom-tag-slug 键名与列定义元数据。
 */
export async function preflightSupertagProperty(
    tagName: string,
    propertyName: string,
    sampleValue?: any
): Promise<{ slug: string; physicalKey: string; keyId: string; keyType: string }> {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    const rawProp = propertyName.trim();
    const slug = slugify(rawProp);
    const physicalKey = getPhysicalAttrKey(cleanTag, slug);

    const avId = await ensureSupertagDatabase(cleanTag);
    if (!avId) {
        return { slug, physicalKey, keyId: "", keyType: "text" };
    }

    let schema = await getAVSchema(avId);
    let matchedCol = schema.find(c => 
        c.keyName.toLowerCase() === rawProp.toLowerCase() || 
        c.colName.toLowerCase() === rawProp.toLowerCase() ||
        slugify(c.keyName) === slug
    );

    if (matchedCol) {
        return {
            slug,
            physicalKey,
            keyId: matchedCol.keyId,
            keyType: matchedCol.keyType
        };
    }

    // 动态类型推断
    let colType = "text";
    if (typeof sampleValue === "number" || (!isNaN(Number(sampleValue)) && sampleValue !== "" && sampleValue !== null && typeof sampleValue !== "boolean")) {
        colType = "number";
    } else if (typeof sampleValue === "boolean") {
        colType = "checkbox";
    } else if (typeof sampleValue === "string" && /^\d{4}-\d{2}-\d{2}/.test(sampleValue)) {
        colType = "date";
    } else if (Array.isArray(sampleValue)) {
        colType = "mSelect";
    }

    const newKeyID = (window as any).Lute?.NewNodeID?.() || `key_${Date.now()}`;
    try {
        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avId });
        const existingKeys = Array.isArray(keysRes) ? keysRes : (keysRes?.keys || []);
        const lastKeyID = existingKeys.length > 0 ? existingKeys[existingKeys.length - 1].id : "";

        console.log(`[Supertag-Preflight] 🚀 JIT 扩列: 为 #${cleanTag} (AV: ${avId}) 自动新增列 "${rawProp}" (类型: ${colType})`);
        await post("/api/av/addAttributeViewKey", {
            avID: avId,
            keyID: newKeyID,
            keyName: rawProp,
            keyType: colType,
            keyIcon: "",
            previousKeyID: lastKeyID
        });

        await instantiateAV(avId, true);
    } catch (e) {
        console.warn(`[Supertag-Preflight] JIT 扩列失败:`, e);
    }

    return {
        slug,
        physicalKey,
        keyId: newKeyID,
        keyType: colType
    };
}

/**
 * 内存 Schema 注册表缓存: tag -> SupertagFieldSchema[]
 */
const memorySchemaCache = new Map<string, SupertagFieldSchema[]>();

/**
 * 注册或更新内存中的 Supertag Schema
 */
export function registerSupertagSchema(tagName: string, fields: SupertagFieldSchema[]) {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    memorySchemaCache.set(cleanTag, fields);
}

/**
 * 获取指定 Supertag 的字段定义 Schema（单一真理源：从绑定 AV 数据库动态提取）
 */
export async function getSupertagSchema(tagName: string): Promise<SupertagFieldSchema[]> {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    if (!cleanTag) return [];

    try {
        const avId = supertagBinder.getPref(cleanTag) || (await ensureSupertagDatabase(cleanTag));
        if (avId) {
            const avSchema = await fetchAVKeyDefinitions(avId);
            if (avSchema.length > 0) {
                memorySchemaCache.set(cleanTag, avSchema);
                return avSchema;
            }
        }
    } catch (e) {
        console.warn(`[SupertagSchema] 读取 #${cleanTag} Schema 失败:`, e);
    }

    if (memorySchemaCache.has(cleanTag)) {
        return memorySchemaCache.get(cleanTag)!;
    }

    return [];
}

/**
 * 从原生 AV 数据库读取 Key 定义并转换为标准 SupertagFieldSchema
 */
async function fetchAVKeyDefinitions(avId: string): Promise<SupertagFieldSchema[]> {
    try {
        const res = await post("/api/av/getAttributeView", { id: avId });
        const avData = res?.data || res;
        if (!avData || !Array.isArray(avData.keyValues)) return [];

        const schemas: SupertagFieldSchema[] = [];
        for (const kv of avData.keyValues) {
            const key = kv.key;
            if (!key || key.type === "block" || key.type === "lineNumber") continue;

            const label = key.name || key.id;
            const slug = slugify(label);
            const options: SupertagFieldOption[] = [];

            if (Array.isArray(key.options)) {
                key.options.forEach((opt: any) => {
                    options.push({
                        id: opt.id || `opt_${opt.name}`,
                        name: opt.name || "",
                        color: opt.color || "1"
                    });
                });
            }

            schemas.push({
                slug,
                label,
                type: key.type || "text",
                options: options.length > 0 ? options : undefined,
                description: key.desc || ""
            });
        }
        return schemas;
    } catch (e) {
        console.warn(`[SupertagSchema] 获取 AV ${avId} Key 定义失败:`, e);
        return [];
    }
}
