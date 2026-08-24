/**
 * supertag-binder.ts
 *
 * Supertag 数据库绑定与属性初始化挂载模块 (纯块属性 + 0 物理 AV 插入)
 *
 * 核心规则：
 * 1. 绑定数据库默认开启虚拟投影：setPref 时自动建立 Hot-SQLite 内存投影映射
 * 2. 打上 Supertag 时：
 *    - 绝不调用 addAttributeViewBlocks 往物理 .av/*.json 写入行；
 *    - 自动提取关联数据库的列结构，并为块挂载声明 custom-<tag>-<col>="" 空属性；
 *    - 内存 SQLite 虚拟投影表实时更新并刷新视图。
 */

import { post } from "../../../../shared/api-client/request";
import { getColIDMap } from "../../../../shared/utils/av-utils";
import { sanitizeBlockAttrName } from "../../utils/attribute-sanitizer";
import { supertagAVProjector, registerColumnMeta } from "../projection/supertag-av-projector";
import { showMessage } from "siyuan";
import type { TypeConfig } from "../../../av/av-setting/types";

export interface SupertagPrefs {
    [tag: string]: string; // tag -> avId preference
}

export class SupertagBinder {
    private prefs: SupertagPrefs = {};

    constructor() {
        this.loadPrefs();
    }

    public async loadPrefs() {
        try {
            const res = await post("/api/file/getFile", {
                path: "/data/storage/petal/siyuan-plugins-index/supertag-prefs.json"
            });
            if (res && typeof res === "object") {
                this.prefs = res;
            }
        } catch (_) {
            this.prefs = {};
        }
    }

    public async savePrefs() {
        try {
            await post("/api/file/putFile", {
                path: "/data/storage/petal/siyuan-plugins-index/supertag-prefs.json",
                isDir: false,
                file: new Blob([JSON.stringify(this.prefs, null, 2)], { type: "application/json" })
            });
        } catch (e) {
            console.error("[SupertagBinder] Failed to save supertag prefs:", e);
        }
    }

    public getPref(tag: string): string | undefined {
        return this.prefs[tag];
    }

    /**
     * 设置 Supertag 绑定的数据库偏好，并默认自动开启虚拟投影
     */
    public async setPref(tag: string, avId: string) {
        this.prefs[tag] = avId;
        await this.savePrefs();

        const cleanTag = tag.replace(/#/g, "").trim();
        const cleanAvId = (avId || "").trim();

        // 默认自动开启 Hot-SQLite 内存虚拟投影
        if (cleanAvId && cleanAvId !== "disabled" && cleanAvId !== "enabled") {
            try {
                await supertagAVProjector.projectSupertagToAV(cleanTag, cleanAvId);
                console.log(`[Supertag-Binder] ✨ 已为 #${cleanTag} 自动建立与数据库 ${cleanAvId} 的虚拟投影`);
            } catch (err) {
                console.warn(`[Supertag-Binder] 建立虚拟投影异常:`, err);
            }
        }
    }

    /**
     * 当块被赋予 Supertag 时：
     * 1. 100% 走 custom attr 挂载，不向物理 .av/*.json 写入任何行；
     * 2. 读取该数据库的所有列定义，将属性声明为 custom-<tag>-<col> = "" (blank 空属性语义)；
     *    - 英文列名: custom-<tag>-status
     *    - 中文/特殊列名: custom-<tag>-k_<keyId> (符合 Go 内核白名单且与原生列绑定)
     * 3. 内存 SQLite 投影视图即时同步 (0 延迟)。
     */
    public async applySupertag(blockId: string, cleanTag: string, config: TypeConfig) {
        if (!blockId || !cleanTag) return;
        const avId = config?.avId;

        try {
            console.log(`[Supertag-Binder] 🏷️ 正在为块 "${blockId}" 挂载 Supertag #${cleanTag} 数据库属性...`);

            // 1. 确保该 Tag 与 AV 数据库的虚拟投影处于激活状态
            if (avId && !supertagAVProjector.isVirtualProjection(avId)) {
                await supertagAVProjector.projectSupertagToAV(cleanTag, avId, blockId);
            }

            // 2. 读取该 AV 数据库的所有列结构
            const initAttrs: Record<string, string> = {};

            if (avId) {
                try {
                    const { keyValues, idToType } = await getColIDMap(avId);
                    for (const kv of keyValues) {
                        const colName = kv.key.name || "";
                        const colId = kv.key.id;
                        const colType = kv.key.type || idToType[colId] || "text";

                        if (!colName || colType === "block" || ["rollup", "formula", "created", "updated"].includes(colType)) {
                            continue;
                        }

                        let colSlug = "";
                        if (/^[a-zA-Z0-9_-]+$/.test(colName.trim())) {
                            colSlug = colName.trim().toLowerCase().replace(/_/g, "-");
                        } else {
                            // 中文或特殊字符列名：使用安全的 Key ID 映射 custom-<tag>-k_<keyId>
                            const cleanColId = colId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
                            colSlug = `k-${cleanColId}`;
                        }

                        // 注册列元数据供 Inspector 与虚拟表渲染中文 label
                        registerColumnMeta(cleanTag, colSlug, {
                            id: colId,
                            name: colName,
                            type: colType
                        });

                        const attrKey = `custom-${cleanTag}-${colSlug}`;

                        // 若是类型分类列，设置映射初始值；其余字段初始化为 blank 空属性语义 ("")
                        if (config.typeFieldId && colId === config.typeFieldId && config.mappedValue !== undefined) {
                            initAttrs[attrKey] = String(config.mappedValue).trim();
                        } else {
                            initAttrs[attrKey] = "";
                        }
                    }
                } catch (colErr) {
                    console.warn(`[Supertag-Binder] 读取列定义失败，使用默认属性:`, colErr);
                }
            }

            // 3. 将属性一次性挂载写入物理块自身 IAL (零物理 AV 磁盘写入)
            if (Object.keys(initAttrs).length > 0) {
                await post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: initAttrs
                });
                console.log(`[Supertag-Binder] ✓ 成功为块 ${blockId} 挂载 ${Object.keys(initAttrs).length} 个专属属性:`, initAttrs);
            }

            // 4. 获取块标题内容
            let blockContent = "";
            try {
                const blockRes = await post("/api/block/getBlockInfo", { id: blockId });
                blockContent = blockRes?.rootTitle || blockRes?.title || "";
                if (!blockContent) {
                    const sqlRes = await post("/api/query/sql", { stmt: `SELECT content FROM blocks WHERE id = '${blockId}'` });
                    if (Array.isArray(sqlRes) && sqlRes.length > 0) blockContent = sqlRes[0].content || "";
                }
            } catch (_) {}

            // 5. 立即同步到 SQLite 内存热表中 (0 延迟呈现)
            if (avId) {
                await supertagAVProjector.syncBlockToVirtualTable(blockId, cleanTag, initAttrs, blockContent);
                supertagAVProjector.notifyFrontendToRerender(avId, blockId);
            }

            showMessage(`✨ Supertag: 已挂载 #${cleanTag} 属性至文档块`);
        } catch (e) {
            console.error("[Supertag-Binder] 挂载 Supertag 属性失败:", e);
        }
    }
}

export const supertagBinder = new SupertagBinder();
