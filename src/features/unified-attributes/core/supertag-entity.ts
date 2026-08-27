/**
 * supertag-entity.ts
 *
 * Supertag 统一领域实体模型与聚合装配器 (Unified Supertag Entity Model)
 *
 * 核心设计：
 * 1. Data Schema (数据能力)：100% 纯属性治理，主绑定 AV 数据库（二选一去重：优先专属 supertag- 库，次选外部业务库）。
 * 2. Commands (命令能力)：生命周期条件触发器 (tag_created 等)、虚拟悬浮按钮、交互命令。
 */

import { getGlobalTypeConfigs } from "../../av/av-setting/db-config";
import { type TypeConfig } from "../../av/av-setting/types";
import { SUPERTAG_REGISTRY, type SupertagCommand } from "../../command/registration";
import { BUILTIN_SUPERTAGS, getSeedSupertagRows } from "../../command/indexos/seed-data";
import { supertagBinder } from "./supertag-binder";
import { supertagAVProjector } from "../projection/supertag-av-projector";
import { parseConditionalString } from "./supertag-trigger";
import { post } from "../../../shared/api-client/request";
import { fetchAllAVBlocks } from "../../sqlite/sqlite-data-fetcher";
import { getAttrFromIAL } from "../../../shared/utils";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";

export interface SupertagColumnInfo {
    id: string;
    name: string;
    type: string;
}

export interface UnifiedSupertagDefinition {
    /** 标签唯一标识 (全小写，不带 #，如 "task") */
    typeName: string;
    /** 显示用标签名 (如 "#task") */
    displayName: string;
    /** 是否为系统内置 Supertag (如 task, project, note) */
    isBuiltin: boolean;
    /** 推荐状态是否已开启 (true: 启用; false: 禁用) */
    enabled: boolean;
    
    /** 是否已就绪 (已建立有效数据表绑定或拥有命令配置) */
    isReady: boolean;
    
    // ─── 数据库组件 (Database Component) ───
    /** 唯一主绑定的 AV 数据库 ID */
    selectedAvId: string;
    /** 主绑定的数据库名称 */
    selectedAvName: string;
    /** 是否存在重名数据库警告 */
    isDuplicateName: boolean;
    /** 匹配到的同名数据库数量 */
    matchedCount: number;
    /** 是否已拥有数据库 */
    hasDataSchema: boolean;
    /** 匹配到的所有 AV 数据库块列表 (支持重名数据库循环定位) */
    matchedAvBlocks?: Array<{ id: string; name: string; blockId: string }>;

    // ─── 命令组件 (Commands Component) ───
    /** 关联的命令与交互规则定义集合 */
    logicConfigs: SupertagCommand[];
    /** 是否拥有命令或触发规则 */
    hasBehavior: boolean;
    /** 解析出的有效触发规则数量 */
    rulesCount: number;
    /** 是否配置了虚拟按钮 (VirtualButton) */
    hasVirtualButton: boolean;
    /** 条件触发脚本原始内容 */
    conditionalScript?: string;
}

export interface SupertagDbRecord {
    rowId: string;
    typeTag: string;
    manual: string;
    auto: string;
    relatedAv: string;
}

export const isIdLike = (str: string): boolean => {
    if (!str) return true;
    const s = str.trim().toLowerCase().replace(/^#+/, "");
    if (!s) return true;
    return /^av[_\-]/i.test(s) || 
           /^\d{14}/.test(s) || 
           /^[a-z0-9]{14,}[_\-][a-z0-9]+$/i.test(s) ||
           /^unnamed/i.test(s) ||
           /^untitled/i.test(s) ||
           /^未命名/.test(s) ||
           /^新条目/.test(s) ||
           s === "新条目" ||
           s === "未命名" ||
           s === "untitled" ||
           s === "unnamed";
};

export const SYSTEM_EXCLUDED_SUPERTAGS = new Set(["commanddb", "command-db", "supertagdb", "supertag-db", "command", "supertag", "datadbs", "data-dbs", "新条目", "未命名", "untitled", "unnamed"]);

/**
 * 结构化获取 supertag-db 系统表中的所有 Supertag 记录 (单一真理源)
 */
export async function getSupertagDbRecords(): Promise<SupertagDbRecord[]> {
    const records: SupertagDbRecord[] = [];
    const SYSTEM_EXCLUDED = SYSTEM_EXCLUDED_SUPERTAGS;
    
    // 1. 优先尝试从内存 SQLite 引擎查询活跃的 "supertag-db" (支持 av_${typeAvId} 或系统表 supertag-db)
    try {
        const { getTypeAvId } = await import("../../command/registration");
        const typeAvId = getTypeAvId();
        const { db } = await getSqliteEngine();

        if (typeAvId) {
            const typeTableName = `av_${typeAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const check = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${typeTableName}';`);
            if (check.length > 0 && check[0].values.length > 0) {
                const schemaRows = db.exec(`SELECT col_name, key_name, key_type FROM _av_schema WHERE av_id = ?;`, [typeAvId]);
                let primaryKeyCol = "supertag";
                let manualCol: string | null = null;
                let autoCol: string | null = null;
                let relatedAvCol: string | null = null;

                if (schemaRows.length > 0 && schemaRows[0].values.length > 0) {
                    for (const s of schemaRows[0].values) {
                        const colName = String(s[0]);
                        const keyName = String(s[1] || "").toLowerCase();
                        const keyType = String(s[2] || "").toLowerCase();

                        if (keyType === "block") {
                            primaryKeyCol = colName;
                        } else if (keyName === "manual" || keyName.includes("manual") || keyName.includes("icon menu")) {
                            manualCol = colName;
                        } else if (keyName === "auto" || keyName.includes("auto") || keyName.includes("conditional")) {
                            autoCol = colName;
                        } else if (keyName === "related av" || keyName === "related_av" || keyName.includes("related")) {
                            relatedAvCol = colName;
                        }
                    }
                } else {
                    const pragma = db.exec(`PRAGMA table_info("${typeTableName}");`);
                    const cols = pragma[0].values.map((v: any) => String(v[1]));
                    primaryKeyCol = cols.find(c => c.toLowerCase() === "主键" || c.toLowerCase() === "supertag") || (cols[2] || cols[0]);
                    manualCol = cols.find(c => c.toLowerCase().includes("manual")) || null;
                    autoCol = cols.find(c => c.toLowerCase().includes("auto") || c.toLowerCase().includes("conditional")) || null;
                    relatedAvCol = cols.find(c => c.toLowerCase().includes("related")) || null;
                }

                let sql = `SELECT rowID, "${primaryKeyCol}"`;
                sql += manualCol ? `, "${manualCol}"` : `, ''`;
                sql += autoCol ? `, "${autoCol}"` : `, ''`;
                sql += relatedAvCol ? `, "${relatedAvCol}"` : `, ''`;
                sql += ` FROM "${typeTableName}";`;

                const rows = db.exec(sql);
                if (rows.length > 0 && rows[0].values.length > 0) {
                    for (const r of rows[0].values) {
                        const rowId = String(r[0] || "");
                        const typeTag = String(r[1] || "").replace(/^#+/, "").trim().toLowerCase();
                        const manual = String(r[2] || "").trim();
                        const auto = String(r[3] || "").trim();
                        const relatedAv = String(r[4] || "").trim();
                        if (typeTag && !isIdLike(typeTag) && !SYSTEM_EXCLUDED.has(typeTag)) {
                            records.push({ rowId, typeTag, manual, auto, relatedAv });
                        }
                    }
                    if (records.length > 0) {
                        return records;
                    }
                }
            }
        }
    } catch (_) {}

    // 2. 如果 SQLite 未就绪，尝试从 SiYuan 原生 AV 读取 "supertag-db" (已实例化状态)
    try {
        const typeDocSql = `SELECT root_id FROM attributes WHERE name = 'custom-index-supertag-db' LIMIT 1`;
        const typeDocs = await post("/api/query/sql", { stmt: typeDocSql });
        if (typeDocs && typeDocs.length > 0) {
            const docId = typeDocs[0].root_id;
            const avSql = `SELECT id FROM blocks WHERE root_id = '${docId}' AND type = 'av' LIMIT 1`;
            const avRes = await post("/api/query/sql", { stmt: avSql });
            if (avRes && avRes.length > 0) {
                const domRes = await post("/api/block/getBlockDOM", { id: avRes[0].id });
                const html = domRes?.data?.dom || domRes?.dom || "";
                const match = html.match(/data-av-id="([^"]+)"/);
                const avId = match ? match[1] : avRes[0].id;
                if (avId) {
                    const renderRes = await post("/api/av/renderAttributeView", { id: avId });
                    const view = renderRes?.view || renderRes;
                    const rows: any[] = view?.rows || [];
                    const columns: any[] = view?.columns || [];
                    const manualIdx = columns.findIndex((c: any) => c.name?.toLowerCase() === "manual");
                    const autoIdx = columns.findIndex((c: any) => c.name?.toLowerCase() === "auto" || c.name?.toLowerCase() === "conditional");
                    const relAvIdx = columns.findIndex((c: any) => c.name?.toLowerCase() === "related av" || c.name?.toLowerCase() === "related_av");
                    for (const row of rows) {
                        const rowId = row.id || "";
                        const typeTagRaw = row.cells?.[0]?.value?.text?.content || row.cells?.[0]?.value?.block?.content || "";
                        const cleanTag = typeTagRaw.replace(/^#+/, "").trim().toLowerCase();
                        let manual = "";
                        let auto = "";
                        let relatedAv = "";
                        if (manualIdx >= 0 && row.cells?.[manualIdx]) {
                            manual = row.cells[manualIdx]?.value?.text?.content || "";
                        }
                        if (autoIdx >= 0 && row.cells?.[autoIdx]) {
                            auto = row.cells[autoIdx]?.value?.text?.content || "";
                        }
                        if (relAvIdx >= 0 && row.cells?.[relAvIdx]) {
                            const val = row.cells[relAvIdx]?.value;
                            relatedAv = val?.text?.content || val?.block?.id || "";
                        }
                        if (cleanTag && !isIdLike(cleanTag) && !SYSTEM_EXCLUDED.has(cleanTag)) {
                            records.push({ rowId, typeTag: cleanTag, manual, auto, relatedAv });
                        }
                    }
                    if (records.length > 0) {
                        return records;
                    }
                }
            }
        }
    } catch (_) {}

    // 3. 未实例化状态：读取 seed-data.ts TS 常量种子 (单一真理源)
    const seedRows = getSeedSupertagRows();
    for (const seed of seedRows) {
        records.push({
            rowId: seed.rowID,
            typeTag: seed.supertag.toLowerCase().trim(),
            manual: (seed as any).manual || "",
            auto: (seed as any).auto || seed.conditional || "",
            relatedAv: ""
        });
    }

    return records;
}

/**
 * 聚合查询并返回系统中所有统一超级标签实体 (Unified Supertags)
 * 双核心真理源：1. supertag-db 系统表  2. 工作区中建立的所有 AV 数据库
 */
export async function getUnifiedSupertagList(): Promise<UnifiedSupertagDefinition[]> {
    const SYSTEM_EXCLUDED = SYSTEM_EXCLUDED_SUPERTAGS;

    // 1. 读取第一源：supertag-db 系统表 (未实例化时读取 seed-data.ts 常量)
    const supertagDbRecords = await getSupertagDbRecords();
    const recordsByTag = new Map<string, SupertagDbRecord>();
    const recordsByRowId = new Map<string, SupertagDbRecord>();

    for (const rec of supertagDbRecords) {
        if (!isIdLike(rec.typeTag) && !SYSTEM_EXCLUDED.has(rec.typeTag)) {
            recordsByTag.set(rec.typeTag, rec);
            if (rec.rowId) recordsByRowId.set(rec.rowId, rec);
        }
    }

    // 2. 读取第二源：扫描全库所有 AV 数据库 (排除 commanddb/supertagdb 等系统内建库)
    const avBlockMap = new Map<string, { blockId: string; name: string }>();
    const avBlocksByTag = new Map<string, Array<{ id: string; name: string; blockId: string }>>();

    try {
        const rawAvBlocks = await fetchAllAVBlocks();
        for (const b of rawAvBlocks) {
            const targetAvId = b.avId;
            if (!targetAvId || targetAvId === "Not Found") continue;
            avBlockMap.set(targetAvId, { blockId: b.blockId, name: b.name });

            const customTag = (getAttrFromIAL(b.ial, "custom-supertag-tag") || "").trim().toLowerCase().replace(/^#+/, "");
            const customRowId = (getAttrFromIAL(b.ial, "custom-supertag-id") || "").trim();
            const dbNameTag = (b.name || "").trim().toLowerCase().replace(/^#+/, "").replace(/^supertag-/i, "");

            let matchedTag = "";
            if (customTag && !isIdLike(customTag)) {
                matchedTag = customTag;
            }
            if (!matchedTag && customRowId) {
                const rec = recordsByRowId.get(customRowId);
                if (rec && !isIdLike(rec.typeTag)) matchedTag = rec.typeTag;
            }
            if (!matchedTag && dbNameTag && !isIdLike(dbNameTag) && dbNameTag !== "unnamed database" && dbNameTag !== "unnamed") {
                matchedTag = dbNameTag;
            }

            if (matchedTag && !isIdLike(matchedTag) && !SYSTEM_EXCLUDED.has(matchedTag)) {
                if (!avBlocksByTag.has(matchedTag)) avBlocksByTag.set(matchedTag, []);
                avBlocksByTag.get(matchedTag)!.push({ id: targetAvId, name: b.name, blockId: b.blockId });
            }
        }
    } catch (_) {}

    // 3. 聚合双源 Supertag 集合
    const allTagsSet = new Set<string>([
        ...Array.from(recordsByTag.keys()),
        ...Array.from(avBlocksByTag.keys()),
        ...Array.from(BUILTIN_SUPERTAGS)
    ]);

    const result: UnifiedSupertagDefinition[] = [];

    for (const cleanTag of Array.from(allTagsSet)) {
        if (!cleanTag) continue;

        const rec = recordsByTag.get(cleanTag);
        const tagMatchedDbs = avBlocksByTag.get(cleanTag) || [];

        // 解析绑定的数据库
        let selectedAvId = rec?.relatedAv || "";
        if (selectedAvId && !avBlockMap.has(selectedAvId)) {
            // 如果记录中的 relatedAv 在当前全库扫描中已不存在（幽灵ID），重置并尝试从活跃库中匹配
            selectedAvId = tagMatchedDbs.length > 0 ? tagMatchedDbs[0].id : "";
        } else if (!selectedAvId && tagMatchedDbs.length > 0) {
            selectedAvId = tagMatchedDbs[0].id;
        }

        const hasDataSchema = Boolean(selectedAvId);
        const isDuplicateName = tagMatchedDbs.length > 1;
        const matchedCount = tagMatchedDbs.length || (selectedAvId ? 1 : 0);
        const selectedAvName = avBlockMap.get(selectedAvId)?.name || (selectedAvId ? cleanTag : "");

        // 自动建立有效投影绑定 (仅内存注册，不写存储，严禁系统库)
        if (hasDataSchema && selectedAvId && !SYSTEM_EXCLUDED.has(cleanTag)) {
            supertagAVProjector.bindTagToAV(cleanTag, selectedAvId);
        }

        // 解析命令与条件脚本配置
        let rulesCount = 0;
        let hasVirtualButton = false;
        const conditionalScript = rec?.auto || "";
        if (conditionalScript) {
            try {
                const rules = parseConditionalString(conditionalScript);
                rulesCount = rules.length;
            } catch (_) {
                rulesCount = 1;
            }
        }

        if (rec?.manual) {
            try {
                const manualList = JSON.parse(rec.manual);
                if (Array.isArray(manualList) && manualList.some((m: any) => m.showInVirtualButton || m.uiLocation === "VirtualButton")) {
                    hasVirtualButton = true;
                }
            } catch (_) {}
        }

        const hasBehavior = Boolean(rec?.manual || rec?.auto);
        const isReady = hasDataSchema || hasBehavior;
        const pref = supertagBinder.getPref(cleanTag);
        const isEnabled = pref !== "disabled";

        result.push({
            typeName: cleanTag,
            displayName: `#${cleanTag}`,
            isBuiltin: BUILTIN_SUPERTAGS.has(cleanTag),
            enabled: isEnabled,
            isReady,
            selectedAvId,
            selectedAvName,
            isDuplicateName,
            matchedCount,
            hasDataSchema,
            matchedAvBlocks: tagMatchedDbs,
            logicConfigs: [],
            hasBehavior,
            rulesCount,
            hasVirtualButton,
            conditionalScript
        });
    }

    return result.sort((a, b) => {
        if (a.isReady && !b.isReady) return -1;
        if (!a.isReady && b.isReady) return 1;
        if (a.isBuiltin && !b.isBuiltin) return -1;
        if (!a.isBuiltin && b.isBuiltin) return 1;
        return a.typeName.localeCompare(b.typeName);
    });
}
