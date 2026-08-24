/**
 * supertag-entity.ts
 *
 * Supertag 统一领域实体模型与聚合装配器 (Unified Supertag Entity Model)
 *
 * 核心设计：
 * 消除“数据 Tag”与“命令 Tag”的二元割裂，将 Supertag 建模为单一实体原型 (Entity Archetype)：
 * 1. Data Schema (数据能力)：绑定的思源 AV 数据库、列字段定义、Hot-SQLite 虚拟投影。
 * 2. Behavior (行为能力)：生命周期条件触发器 (tag_created 等)、虚拟悬浮按钮、Icon Menu 项。
 */

import { getGlobalTypeConfigs } from "../../av/av-setting/db-config";
import { type TypeConfig } from "../../av/av-setting/types";
import { SUPERTAG_REGISTRY, type SupertagCommand } from "../../command/registration";
import { BUILTIN_SUPERTAGS } from "../../command/indexos/seed-data";
import { supertagBinder } from "./supertag-binder";
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
    
    /** 是否已就绪 (已建立有效数据表绑定或拥有行为配置) */
    isReady: boolean;
    
    // ─── 数据组件 (Data Component) ───
    /** 绑定的首选 AV 数据库 ID (如有) */
    selectedAvId: string;
    /** 关联的所有 AV 数据库配置 (支持重名/多库) */
    dataConfigs: TypeConfig[];
    /** 是否已建立有效数据库绑定 */
    hasDataSchema: boolean;
    /** 选中的模板库 ID (用于克隆生成专属库) */
    selectedTemplateAvId?: string;

    // ─── 行为组件 (Behavior Component) ───
    /** 关联的命令与交互规则定义集合 */
    logicConfigs: SupertagCommand[];
    /** 是否拥有行为或触发规则 */
    hasBehavior: boolean;
    /** 解析出的有效触发规则数量 */
    rulesCount: number;
    /** 是否配置了虚拟按钮 (VirtualButton) */
    hasVirtualButton: boolean;
    /** 条件触发脚本原始内容 */
    conditionalScript?: string;
}

/**
 * 聚合查询并返回系统中所有统一超级标签实体 (Unified Supertags)
 */
export async function getUnifiedSupertagList(): Promise<UnifiedSupertagDefinition[]> {
    const scannedData = await getGlobalTypeConfigs();
    const logicData = SUPERTAG_REGISTRY || [];

    const dataMap = new Map<string, TypeConfig[]>();
    scannedData.forEach((d) => {
        const name = (d.typeName || "").trim().toLowerCase();
        if (!name) return;
        if (!dataMap.has(name)) dataMap.set(name, []);
        dataMap.get(name)!.push(d);
    });

    const logicMap = new Map<string, SupertagCommand[]>();
    logicData.forEach((l) => {
        const name = (l.typeTag || "").trim().toLowerCase();
        if (!name) return;
        if (!logicMap.has(name)) logicMap.set(name, []);
        logicMap.get(name)!.push(l);
    });

    const allTagNames = Array.from(new Set([
        ...Array.from(dataMap.keys()),
        ...Array.from(logicMap.keys())
    ]));

    const result: UnifiedSupertagDefinition[] = [];

    for (const name of allTagNames) {
        const dataConfigs = dataMap.get(name) || [];
        const logicConfigs = logicMap.get(name) || [];
        const pref = supertagBinder.getPref(name);
        const validPref = (pref && pref !== "enabled" && pref !== "disabled") ? pref : "";
        const isEnabled = pref !== "disabled";

        const hasDataSchema = dataConfigs.length > 0;
        const hasBehavior = logicConfigs.length > 0;
        const isReady = hasDataSchema || hasBehavior;
        const templatePref = supertagBinder.getTemplatePref(name);

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
            typeName: name,
            displayName: `#${name}`,
            isBuiltin: BUILTIN_SUPERTAGS.has(name),
            enabled: isEnabled,
            isReady,
            selectedAvId: validPref || dataConfigs[0]?.avId || "",
            dataConfigs,
            hasDataSchema,
            selectedTemplateAvId: templatePref || "",
            logicConfigs,
            hasBehavior,
            rulesCount,
            hasVirtualButton,
            conditionalScript
        });
    }

    // 智能补充重名数据库的文档标题
    await enrichDuplicateDbNames(result);

    // 排序：已就绪（含库或含行为）置顶 ➔ 未建库/待初始化置灰沉底；组内内置标签排前，其余按字母排序
    return result.sort((a, b) => {
        if (a.isReady && !b.isReady) return -1;
        if (!a.isReady && b.isReady) return 1;
        if (a.isBuiltin && !b.isBuiltin) return -1;
        if (!a.isBuiltin && b.isBuiltin) return 1;
        return a.typeName.localeCompare(b.typeName);
    });
}

/**
 * 为重名数据库补充文档标题 (如 "工作日志.1", "工作日志.2")
 */
async function enrichDuplicateDbNames(groups: UnifiedSupertagDefinition[]) {
    for (const g of groups) {
        if (!g.dataConfigs || g.dataConfigs.length <= 1) continue;

        const blockIds = g.dataConfigs.map(c => c.blockId || c.avId).filter(Boolean);
        if (blockIds.length === 0) continue;

        try {
            const stmt = `SELECT b.id, d.content as doc_title, d.hpath, b.created, b.updated FROM blocks b LEFT JOIN blocks d ON b.root_id = d.id WHERE b.id IN ('${blockIds.join("','")}')`;
            const res = await post("/api/query/sql", { stmt });
            const rows = (res && Array.isArray(res)) ? res : (res?.data || []);

            const infoMap = new Map<string, { docTitle: string; created: string }>();
            if (Array.isArray(rows)) {
                rows.forEach((r: any) => {
                    let title = r.doc_title || "";
                    if (!title && r.hpath) {
                        const parts = r.hpath.split("/").filter(Boolean);
                        title = parts[parts.length - 1] || "";
                    }
                    if (!title) title = "未命名页";
                    infoMap.set(r.id, { docTitle: title, created: r.created || "" });
                });
            }

            const docCountMap = new Map<string, number>();
            g.dataConfigs.forEach(cfg => {
                const info = infoMap.get(cfg.blockId || cfg.avId);
                const docTitle = info ? info.docTitle : (cfg.avName || "未知页");
                docCountMap.set(docTitle, (docCountMap.get(docTitle) || 0) + 1);
            });

            const docIndexMap = new Map<string, number>();
            g.dataConfigs.forEach(cfg => {
                const info = infoMap.get(cfg.blockId || cfg.avId);
                const docTitle = info ? info.docTitle : (cfg.avName || "未知页");
                const count = docCountMap.get(docTitle) || 1;

                if (count > 1) {
                    const currentIndex = (docIndexMap.get(docTitle) || 0) + 1;
                    docIndexMap.set(docTitle, currentIndex);
                    (cfg as any).displayName = `${docTitle}.${currentIndex}`;
                } else {
                    (cfg as any).displayName = docTitle;
                }
            });
        } catch (e) {
            console.error("Failed to enrich duplicate db names:", e);
        }
    }
}
