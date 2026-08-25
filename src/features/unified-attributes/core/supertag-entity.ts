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
import { BUILTIN_SUPERTAGS } from "../../command/indexos/seed-data";
import { supertagBinder } from "./supertag-binder";
import { supertagAVProjector } from "../projection/supertag-av-projector";
import { parseConditionalString } from "./supertag-trigger";
import { post } from "../../../shared/api-client/request";

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

import { fetchAllAVBlocks } from "../../sqlite/sqlite-data-fetcher";
import { getAttrFromIAL } from "../../../shared/utils";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";

/**
 * 规范化数据库名称提取 Supertag 匹配名
 */
function normalizeDbName(raw: string): string {
    return (raw || "")
        .replace(/^#+/, "")
        .replace(/^supertag-/i, "")
        .trim()
        .toLowerCase();
}

export interface SupertagDbRecord {
    rowId: string;
    typeTag: string;
    relatedAv: string;
}

/**
 * 获取 supertag-db 系统表中的所有 Supertag 记录 (包含行 ID, 标签名, 关联数据库 ID)
 */
export async function getSupertagDbRecords(): Promise<SupertagDbRecord[]> {
    const records: SupertagDbRecord[] = [];
    
    // 1. 优先尝试从内存 SQLite 引擎查询 "supertag-db"
    try {
        const { db } = await getSqliteEngine();
        const check = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='supertag-db';`);
        if (check.length > 0 && check[0].values.length > 0) {
            const pragma = db.exec(`PRAGMA table_info("supertag-db");`);
            const colNames = pragma[0].values.map((v: any) => String(v[1]).toLowerCase());
            const primaryKeyCol = colNames.includes("主键") ? "主键" : (colNames.includes("typetag") ? "typetag" : colNames[0]);
            const relatedAvCol = colNames.includes("related_av") ? "related_av" : (colNames.includes("relatedav") ? "relatedav" : null);

            let sql = `SELECT rowid, "${primaryKeyCol}"`;
            if (relatedAvCol) sql += `, "${relatedAvCol}"`;
            sql += ` FROM "supertag-db";`;

            const rows = db.exec(sql);
            if (rows.length > 0 && rows[0].values.length > 0) {
                for (const r of rows[0].values) {
                    const rowId = String(r[0] || "");
                    const typeTag = String(r[1] || "").replace(/^#+/, "").trim().toLowerCase();
                    const relatedAv = relatedAvCol ? String(r[2] || "").trim() : "";
                    if (typeTag) {
                        records.push({ rowId, typeTag, relatedAv });
                    }
                }
                return records;
            }
        }
    } catch (_) {}

    // 2. 如果 SQLite 未就绪，从 SiYuan 原生 AV 读取
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
                    const relAvIdx = columns.findIndex((c: any) => c.name === "related_av" || c.keyName === "related_av");
                    for (const row of rows) {
                        const rowId = row.id || "";
                        const typeTagRaw = row.cells?.[0]?.value?.text?.content || row.cells?.[0]?.value?.block?.content || "";
                        const cleanTag = typeTagRaw.replace(/^#+/, "").trim().toLowerCase();
                        let relatedAv = "";
                        if (relAvIdx >= 0 && row.cells?.[relAvIdx]) {
                            const val = row.cells[relAvIdx]?.value;
                            relatedAv = val?.text?.content || val?.block?.id || "";
                        }
                        if (cleanTag) {
                            records.push({ rowId, typeTag: cleanTag, relatedAv });
                        }
                    }
                }
            }
        }
    } catch (_) {}

    return records;
}

/**
 * 聚合查询并返回系统中所有统一超级标签实体 (Unified Supertags)
 * 依赖 custom-supertag-id / custom-supertag-tag 属性与 supertag-db 行 ID，不再脆弱依赖数据库名
 */
export async function getUnifiedSupertagList(): Promise<UnifiedSupertagDefinition[]> {
    const logicData = SUPERTAG_REGISTRY || [];

    const logicMap = new Map<string, SupertagCommand[]>();
    logicData.forEach((l) => {
        const name = (l.typeTag || "").trim().toLowerCase().replace(/^#+/, "");
        if (!name) return;
        if (!logicMap.has(name)) logicMap.set(name, []);
        logicMap.get(name)!.push(l);
    });

    // 1. 读取 supertag-db 系统表中的所有 Supertag 记录与行 ID
    const supertagDbRecords = await getSupertagDbRecords();
    const tagToDbRecord = new Map<string, SupertagDbRecord>();
    const rowIdToDbRecord = new Map<string, SupertagDbRecord>();
    const avIdToDbRecord = new Map<string, SupertagDbRecord>();

    for (const rec of supertagDbRecords) {
        tagToDbRecord.set(rec.typeTag, rec);
        if (rec.rowId) rowIdToDbRecord.set(rec.rowId, rec);
        if (rec.relatedAv) avIdToDbRecord.set(rec.relatedAv, rec);
    }

    // 2. 扫描全库所有 AV 数据库，优先根据 custom-supertag-* 属性与行 ID 关联
    const dbsByTag = new Map<string, Array<{ id: string; name: string; blockId: string; rootId: string }>>();
    const SYSTEM_EXCLUDED = new Set(["commanddb", "command-db", "supertagdb", "supertag-db", "command", "supertag"]);

    try {
        const rawAvBlocks = await fetchAllAVBlocks();
        for (const b of rawAvBlocks) {
            const targetAvId = b.avId;
            if (!targetAvId || targetAvId === "Not Found") continue;

            const cleanDbName = normalizeDbName(b.name || "");
            if (SYSTEM_EXCLUDED.has(cleanDbName)) continue;

            // ① 优先检查块属性 custom-supertag-tag 与 custom-supertag-id (真理源)
            const customTag = getAttrFromIAL(b.ial, "custom-supertag-tag");
            const customRowId = getAttrFromIAL(b.ial, "custom-supertag-id");

            let matchedTag = "";

            if (customTag) {
                matchedTag = customTag.replace(/^#+/, "").trim().toLowerCase();
            } else if (customRowId && rowIdToDbRecord.has(customRowId)) {
                matchedTag = rowIdToDbRecord.get(customRowId)!.typeTag;
            } else if (avIdToDbRecord.has(targetAvId)) {
                matchedTag = avIdToDbRecord.get(targetAvId)!.typeTag;
            } else if (cleanDbName && cleanDbName !== "unnamed database" && cleanDbName !== "unnamed") {
                // ② 备选降级：同名/初始路径匹配，一旦命中立即自动持久化 custom-supertag-tag 属性（自愈机制）
                matchedTag = cleanDbName;
                const rec = tagToDbRecord.get(matchedTag);
                const persistRowId = rec?.rowId || matchedTag;
                if (b.blockId) {
                    post("/api/attr/setBlockAttrs", {
                        id: b.blockId,
                        attrs: {
                            "custom-supertag-tag": matchedTag,
                            "custom-supertag-id": persistRowId
                        }
                    }).catch(() => {});
                }
            }

            if (matchedTag && !SYSTEM_EXCLUDED.has(matchedTag)) {
                if (!dbsByTag.has(matchedTag)) dbsByTag.set(matchedTag, []);
                dbsByTag.get(matchedTag)!.push({
                    id: targetAvId,
                    name: b.name || matchedTag,
                    blockId: b.blockId,
                    rootId: b.rootId || ""
                });
            }
        }
    } catch (err) {
        console.warn("[SupertagEntity] 扫描 AV 数据库失败:", err);
    }

    // 3. 收集所有合法 Supertag 标签列表
    const allTagNamesSet = new Set<string>();

    // ① 内置 Supertag 种子
    BUILTIN_SUPERTAGS.forEach(t => allTagNamesSet.add(t.toLowerCase().replace(/^#+/, "").trim()));

    // ② supertag-db 系统表中的所有标签
    supertagDbRecords.forEach(r => allTagNamesSet.add(r.typeTag));

    // ③ 注册的命令 Supertag
    logicMap.forEach((_, tag) => allTagNamesSet.add(tag.toLowerCase().replace(/^#+/, "").trim()));

    // ④ 关联到的所有 Supertag 数据库
    dbsByTag.forEach((_, tag) => allTagNamesSet.add(tag));

    // ⑤ 工作区物理打标块中的标签 (#tag 或 custom-supertags)
    try {
        const tagBlocksRes = await post("/api/query/sql", {
            stmt: `SELECT DISTINCT tag FROM blocks WHERE tag != '' LIMIT 500;`
        });
        const tagRows = Array.isArray(tagBlocksRes) ? tagBlocksRes : (tagBlocksRes?.data || []);
        tagRows.forEach((r: any) => {
            if (r.tag) {
                String(r.tag).split(/[\s,]+/).forEach(t => {
                    const clean = t.replace(/^#+|#+$/g, "").trim().toLowerCase();
                    if (clean && /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,24}$/.test(clean)) {
                        allTagNamesSet.add(clean);
                    }
                });
            }
        });

        const supertagRows = await post("/api/query/sql", {
            stmt: `SELECT ial FROM blocks WHERE ial LIKE '%custom-supertags=%' LIMIT 300;`
        });
        const stRows = Array.isArray(supertagRows) ? supertagRows : (supertagRows?.data || []);
        stRows.forEach((r: any) => {
            const rawVal = getAttrFromIAL(r.ial, "custom-supertags");
            if (rawVal) {
                parseSupertags(rawVal).forEach(t => {
                    const clean = t.replace(/^#+|#+$/g, "").trim().toLowerCase();
                    if (clean && /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,24}$/.test(clean)) {
                        allTagNamesSet.add(clean);
                    }
                });
            }
        });
    } catch (_) {}

    const result: UnifiedSupertagDefinition[] = [];

    for (const name of Array.from(allTagNamesSet)) {
        const cleanTag = name.toLowerCase().replace(/^#+/, "").trim();
        if (!cleanTag) continue;

        const matchedDbs = dbsByTag.get(cleanTag) || [];
        const logicConfigs = logicMap.get(cleanTag) || [];
        const pref = supertagBinder.getPref(cleanTag);
        const isEnabled = pref !== "disabled";

        const hasDataSchema = matchedDbs.length > 0;
        const isDuplicateName = matchedDbs.length > 1;
        const matchedCount = matchedDbs.length;
        const selectedAvId = matchedDbs[0]?.id || "";
        const selectedAvName = matchedDbs[0]?.name || "";

        // 自动建立有效同名绑定
        if (hasDataSchema && selectedAvId) {
            supertagBinder.setPref(cleanTag, selectedAvId);
            supertagAVProjector.bindTagToAV(cleanTag, selectedAvId);
        }

        const hasBehavior = logicConfigs.length > 0;
        const isReady = hasDataSchema || hasBehavior;

        let rulesCount = 0;
        let hasVirtualButton = false;
        let conditionalScript = "";

        for (const l of logicConfigs) {
            if (l.uiLocation === "VirtualButton") {
                hasVirtualButton = true;
            }
            if (l.conditionalScript) {
                conditionalScript = l.conditionalScript;
                try {
                    const rules = parseConditionalString(l.conditionalScript);
                    rulesCount += rules.length;
                } catch (_) {
                    rulesCount += 1;
                }
            }
        }

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
            logicConfigs,
            hasBehavior,
            rulesCount,
            hasVirtualButton,
            conditionalScript
        });
    }

    // 排序：已就绪置顶，内置标签排前，其余按字母排序
    return result.sort((a, b) => {
        if (a.isReady && !b.isReady) return -1;
        if (!a.isReady && b.isReady) return 1;
        if (a.isBuiltin && !b.isBuiltin) return -1;
        if (!a.isBuiltin && b.isBuiltin) return 1;
        return a.typeName.localeCompare(b.typeName);
    });
}
