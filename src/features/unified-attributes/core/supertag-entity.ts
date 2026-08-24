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
    /** 唯一主绑定的 AV 数据库 ID (二选一去重后) */
    selectedAvId: string;
    /** 主绑定的数据库名称 (如 "supertag-task" 或 "读书笔记") */
    selectedAvName: string;
    /** 是否为 supertag- 专属投影库 */
    isDedicatedDb: boolean;
    /** 是否存在重名数据库警告 */
    isDuplicateName: boolean;
    /** 关联的所有 AV 数据库配置 */
    dataConfigs: TypeConfig[];
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

    // 辅助：获取全局所有数据库名称用于重名检测
    const globalAvNameCounts = new Map<string, number>();
    try {
        const sqlRes = await post("/api/query/sql", {
            stmt: `SELECT content FROM blocks WHERE type = 'av' LIMIT 300;`
        });
        const rows = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
        rows.forEach((r: any) => {
            const n = (r.content || "").trim();
            if (n) {
                globalAvNameCounts.set(n, (globalAvNameCounts.get(n) || 0) + 1);
            }
        });
    } catch (_) {}

    const result: UnifiedSupertagDefinition[] = [];

    for (const name of allTagNames) {
        const rootTag = name.split(/[\.\/]/)[0].toLowerCase();
        const dataConfigs = dataMap.get(name) || [];
        const logicConfigs = logicMap.get(name) || [];
        const pref = supertagBinder.getPref(name);
        const validPref = (pref && pref !== "enabled" && pref !== "disabled") ? pref : "";
        const isEnabled = pref !== "disabled";

        // 二选一去重选择主数据库：
        // 1. 如果存在以 supertag- 开头的专属库，优先作为主库
        // 2. 否则选择偏好库或第一个关联库
        let primaryConfig: TypeConfig | null = null;
        const dedicatedConfig = dataConfigs.find(c => (c.avName || "").toLowerCase().startsWith("supertag-"));

        if (dedicatedConfig) {
            primaryConfig = dedicatedConfig;
        } else if (validPref) {
            primaryConfig = dataConfigs.find(c => c.avId === validPref) || {
                typeName: name,
                avId: validPref,
                avName: `DB ${validPref.slice(0, 6)}`,
                typeFieldId: ""
            };
        } else if (dataConfigs.length > 0) {
            primaryConfig = dataConfigs[0];
        }

        const selectedAvId = primaryConfig?.avId || "";
        const selectedAvName = primaryConfig?.displayName || primaryConfig?.avName || (selectedAvId ? `数据库 ${selectedAvId.slice(0, 6)}` : "");
        const isDedicatedDb = selectedAvName.toLowerCase().startsWith("supertag-");
        const isDuplicateName = Boolean(selectedAvName && (globalAvNameCounts.get(selectedAvName) || 0) > 1);

        const hasDataSchema = Boolean(selectedAvId);
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
            typeName: name,
            displayName: `#${name}`,
            isBuiltin: BUILTIN_SUPERTAGS.has(name),
            enabled: isEnabled,
            isReady,
            selectedAvId,
            selectedAvName,
            isDedicatedDb,
            isDuplicateName,
            dataConfigs,
            hasDataSchema,
            logicConfigs,
            hasBehavior,
            rulesCount,
            hasVirtualButton,
            conditionalScript
        });
    }

    // 排序：已就绪置顶，组内内置标签排前，其余按字母排序
    return result.sort((a, b) => {
        if (a.isReady && !b.isReady) return -1;
        if (!a.isReady && b.isReady) return 1;
        if (a.isBuiltin && !b.isBuiltin) return -1;
        if (!a.isBuiltin && b.isBuiltin) return 1;
        return a.typeName.localeCompare(b.typeName);
    });
}
