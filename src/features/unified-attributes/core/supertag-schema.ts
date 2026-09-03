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
import { getTypeAvId } from "../../command/registration";
import { getAVSchema, executeWritableSql, runQuery, avIdToTableName, registerFriendlyTableName } from "../../sqlite/sqlite-manager";

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

const B32_CHARS = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * 微型 Base32 编码器 (RFC 4648 Unpadded, 仅输出 a-z, 2-7)
 */
export function base32Encode(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let output = "";

    for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
            output += B32_CHARS[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += B32_CHARS[(value << (5 - bits)) & 31];
    }

    return output;
}

/**
 * 微型 Base32 解码器 (RFC 4648 Unpadded)
 */
export function base32Decode(input: string): Uint8Array {
    let bits = 0;
    let value = 0;
    const output: number[] = [];

    for (let i = 0; i < input.length; i++) {
        const char = input[i].toLowerCase();
        const index = B32_CHARS.indexOf(char);
        if (index === -1) continue;

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return new Uint8Array(output);
}

/**
 * 校验标识符是否为纯合法字符（仅限小写英文字母 a-z、数字 0-9 与连字符 -）
 */
export function isLegalAttrIdentifier(str: string): boolean {
    if (!str) return false;
    return /^[a-z0-9][a-z0-9\-]*$/.test(str);
}

/**
 * 物理属性 Key 生成网关:
 * 1. 超级标签专属命名空间（纯合规字符）：采用双连字符锁定 custom-tag--${tag}--${field}，彻底消除与普通带连字符属性（如 my-name）的二义性
 * 2. 独立/全局属性（纯合规字符）：直接存原名 custom-${field}
 * 3. 若二者其一包含非法内容（中文、Emoji、空格、下划线、大写等），对整段进行统一 Base32 编码: custom-b32-${base32}
 */
export function getPhysicalAttrKey(tagName: string, propertyName: string): string {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    const cleanProp = propertyName.trim();

    if (cleanTag) {
        if (isLegalAttrIdentifier(cleanTag) && isLegalAttrIdentifier(cleanProp)) {
            return `custom-tag--${cleanTag}--${cleanProp}`;
        }
        // 只要包含非合法内容，统一进行整段 Base32 转码
        const payload = `${cleanTag}\x1f${cleanProp}`;
        const bytes = new TextEncoder().encode(payload);
        const b32 = base32Encode(bytes);
        return `custom-b32-${b32}`;
    }

    // 独立/全局属性 (无 Supertag 命名空间，存原名)
    if (isLegalAttrIdentifier(cleanProp)) {
        return `custom-${cleanProp}`;
    }

    const payload = `\x1f${cleanProp}`;
    const bytes = new TextEncoder().encode(payload);
    const b32 = base32Encode(bytes);
    return `custom-b32-${b32}`;
}

/**
 * 物理属性 Key 解析网关:
 * 1. custom-b32-* -> Base32 解码还原
 * 2. custom-tag--<tag>--<field> -> 确定性解析出 tag 与 field
 * 3. custom-<field> -> 全局独立属性，直接返回原名（如 custom-my-name 解析为 tag="", originalName="my-name"）
 */
export function parsePhysicalAttrKey(rawKey: string): { tag: string; slug: string; originalName: string; isEncoded: boolean } | null {
    if (!rawKey || !rawKey.startsWith("custom-")) return null;

    // 1. 整段 Base32 转码属性解析
    if (rawKey.startsWith("custom-b32-")) {
        const b32Payload = rawKey.slice(11);
        try {
            const bytes = base32Decode(b32Payload);
            const decoded = new TextDecoder().decode(bytes);
            const sepIdx = decoded.indexOf("\x1f");
            if (sepIdx !== -1) {
                const tag = decoded.slice(0, sepIdx);
                const field = decoded.slice(sepIdx + 1);
                return { tag, slug: field, originalName: field, isEncoded: true };
            }
        } catch (_) {}
        return null;
    }

    // 2. 超级标签专属命名空间 (使用双连字符 custom-tag--<tag>--<field> 精确匹配)
    if (rawKey.startsWith("custom-tag--")) {
        const body = rawKey.slice(12); // 去掉 "custom-tag--"
        const sepIdx = body.indexOf("--");
        if (sepIdx !== -1) {
            const tag = body.slice(0, sepIdx);
            const field = body.slice(sepIdx + 2);
            return { tag, slug: field, originalName: field, isEncoded: false };
        }
    }

    // 3. 全局 / 独立属性: custom-<propName> 直接存原名 (包括含有连字符的 my-name, user-id 等)
    const originalName = rawKey.slice(7);
    return { tag: "", slug: originalName, originalName, isEncoded: false };
}

export function encodeAttrSlug(rawName: string): string {
    return rawName;
}

export function decodeAttrSlug(slug: string): string {
    return slug;
}

export function slugify(label: string): string {
    return (label || "").trim();
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

            return "";
        } catch (e) {
            console.error(`[SupertagSchema] 解析 #${cleanTag} 关联数据库失败:`, e);
            return "";
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
    let rawProp = propertyName.trim();

    // 递归剥离任何已有的 custom- 或 custom-tag-- 或 <tag>-- 前缀，坚决杜绝命名空间套娃
    while (
        rawProp.startsWith("custom-tag--") ||
        rawProp.startsWith("custom-") ||
        (cleanTag && (
            rawProp.toLowerCase().startsWith(`tag--${cleanTag}--`) ||
            rawProp.toLowerCase().startsWith(`${cleanTag}--`) ||
            rawProp.toLowerCase().startsWith(`${cleanTag}-`) ||
            rawProp.toLowerCase().startsWith(`${cleanTag}.`) ||
            rawProp.toLowerCase().startsWith(`${cleanTag}_`)
        ))
    ) {
        if (rawProp.startsWith("custom-tag--")) {
            rawProp = rawProp.slice(12);
            const idx = rawProp.indexOf("--");
            if (idx !== -1) rawProp = rawProp.slice(idx + 2);
        } else if (rawProp.startsWith("custom-")) {
            rawProp = rawProp.slice(7);
        } else if (cleanTag && rawProp.toLowerCase().startsWith(`tag--${cleanTag}--`)) {
            rawProp = rawProp.slice(`tag--${cleanTag}--`.length);
        } else if (cleanTag && rawProp.toLowerCase().startsWith(`${cleanTag}--`)) {
            rawProp = rawProp.slice(`${cleanTag}--`.length);
        } else if (cleanTag) {
            rawProp = rawProp.slice(cleanTag.length + 1);
        }
    }

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

    // 沉淀至 supertag-db 命令侧 Core Schema (0.1ms SQLite 本地写入，零物理网络副作用)
    await appendSupertagCommandField(cleanTag, {
        slug,
        label: rawProp,
        type: colType
    });

    return {
        slug,
        physicalKey,
        keyId: "",
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
 * 读取 supertag-db 中的命令侧持久化 Core Schema
 */
export async function getSupertagCommandSchema(tagName: string): Promise<SupertagFieldSchema[]> {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    if (!cleanTag) return [];

    try {
        const { getSqliteEngine } = await import("../../sqlite/sqlite-manager");
        const { db } = await getSqliteEngine();
        const res = db.exec(`SELECT "Schema" FROM "supertag-db" WHERE lower("主键") = '${cleanTag}' LIMIT 1;`);
        if (res && res.length > 0 && res[0].values.length > 0) {
            const rawJson = String(res[0].values[0][0] || "[]");
            const parsed = JSON.parse(rawJson);
            if (Array.isArray(parsed)) {
                return parsed.map((item: any) => ({
                    slug: slugify(item.name || item.slug || item.label || ""),
                    label: item.label || item.name || item.slug || "",
                    type: item.type || "text",
                    options: item.options,
                    description: item.description || ""
                })).filter(f => f.slug);
            }
        }
    } catch (e) {
        console.warn(`[SupertagSchema] 读取命令 Schema 失败:`, e);
    }
    return [];
}

/**
 * 追加/更新 supertag-db 中的命令侧字段定义
 */
export async function appendSupertagCommandField(tagName: string, field: SupertagFieldSchema): Promise<void> {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    if (!cleanTag || !field.slug) return;

    try {
        const { getSqliteEngine } = await import("../../sqlite/sqlite-manager");
        const { db } = await getSqliteEngine();
        const current = await getSupertagCommandSchema(cleanTag);
        const existingIdx = current.findIndex(f => f.slug.toLowerCase() === field.slug.toLowerCase());
        if (existingIdx >= 0) {
            current[existingIdx] = { ...current[existingIdx], ...field };
        } else {
            current.push(field);
        }

        const newSchemaJson = JSON.stringify(current);
        db.run(`UPDATE "supertag-db" SET "Schema" = ?, _updated = ? WHERE lower("主键") = ?;`, [newSchemaJson, Date.now(), cleanTag]);

        const { saveMetaToStorage } = await import("../../command/indexos/command-sqlite");
        await saveMetaToStorage();
    } catch (e) {
        console.warn(`[SupertagSchema] 更新命令 Schema 失败:`, e);
    }
}

/**
 * 获取指定 Supertag 的超集合并 Schema (真实同名 AV 列 ∪ 命令侧持久化 Core Schema)
 */
export async function getSupertagSchema(tagName: string): Promise<SupertagFieldSchema[]> {
    const cleanTag = tagName.replace(/^#+/, "").trim().toLowerCase();
    if (!cleanTag) return [];

    // 1. 读取真实同名 AV 数据库列
    let avSchema: SupertagFieldSchema[] = [];
    try {
        const avId = supertagBinder.getPref(cleanTag) || (await ensureSupertagDatabase(cleanTag));
        if (avId) {
            avSchema = await fetchAVKeyDefinitions(avId);
        }
    } catch (e) {
        console.warn(`[SupertagSchema] 读取 #${cleanTag} AV Schema 失败:`, e);
    }

    // 2. 读取命令侧持久化 Core Schema (0.1ms SQLite 直读)
    const cmdSchema = await getSupertagCommandSchema(cleanTag);

    // 3. 超集合并 (以真实同名 AV 原生列定义优先覆盖)
    const mergedMap = new Map<string, SupertagFieldSchema>();
    for (const f of cmdSchema) {
        mergedMap.set(f.slug.toLowerCase(), f);
    }
    for (const f of avSchema) {
        mergedMap.set(f.slug.toLowerCase(), f);
    }

    const result = Array.from(mergedMap.values());
    if (result.length > 0) {
        memorySchemaCache.set(cleanTag, result);
        return result;
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
