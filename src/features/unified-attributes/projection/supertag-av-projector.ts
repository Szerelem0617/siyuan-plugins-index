/**
 * supertag-av-projector.ts
 *
 * Supertag ➔ 思源原生 AV (Attribute View) 纯热 SQLite 数据库投影与双向同步引擎 (Facade 统一门面)
 *
 * 模块架构分工：
 * - types.ts: 类型定义与元数据注册表
 * - fetch-interceptor.ts: window.fetch 渲染与事务拦截网关
 * - iav-builder.ts: 思源原生标准 IAV 协议组装
 * - hot-table-engine.ts: proj_xxx 内存热表 SQL 驱动与实体/属性同步
 * - rerender-dispatcher.ts: 活动 Protyle 编辑器就地局部重绘与 WebSocket 广播调度
 */

import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { settings } from "../../../core/settings";
import { showMessage } from "siyuan";
import { type VirtualAVBinding, type VirtualColumnMeta, registerColumnMeta, getColumnMeta } from "./types";
import { buildVirtualIAVFromSQL, buildEmptyIAV } from "./iav-builder";
import { notifyFrontendToRerender } from "./rerender-dispatcher";
import {
    projectSupertagToSQLite,
    syncBlockToSQLite,
    removeBlockFromSQLite,
    handleCellUpdateInSQLite,
    flushDirtyBlocks,
    dropHotTable
} from "./hot-table-engine";
import { installFetchInterceptor } from "./fetch-interceptor";

export { type VirtualAVBinding, type VirtualColumnMeta, registerColumnMeta, getColumnMeta };

export class SupertagAVProjector {
    private static instance: SupertagAVProjector | null = null;
    /** 记录虚拟投影绑定关系: avId -> VirtualAVBinding */
    private bindings = new Map<string, VirtualAVBinding>();
    /** 记录 Supertag -> avId 映射 */
    private tagToAvMap = new Map<string, string>();
    /** 记录用户切换的投影视图模式: avId -> boolean (true: 投影视图, false: 物理数据视图) */
    private projectionModes = new Map<string, boolean>();
    /** 防回环互锁 */
    private isSyncing = false;

    public static getInstance(): SupertagAVProjector {
        if (!SupertagAVProjector.instance) {
            SupertagAVProjector.instance = new SupertagAVProjector();
            SupertagAVProjector.instance.installFetchHook();
            SupertagAVProjector.instance.loadPersistedBindings();
        }
        return SupertagAVProjector.instance;
    }

    /**
     * 安装 window.fetch 拦截网关
     */
    public installFetchHook() {
        installFetchInterceptor({
            isVirtualProjection: (avId) => this.isVirtualProjection(avId),
            generateVirtualIAVFromSQLite: (avId) => this.generateVirtualIAVFromSQLite(avId),
            handleAVCellUpdate: (op) => this.handleAVCellUpdate(op)
        });
    }

    public isVirtualProjection(avId: string): boolean {
        const cleanId = (avId || "").trim();
        if (!this.bindings.has(cleanId)) return false;
        // 如果用户显式设置了该数据库的投影视图模式
        if (this.projectionModes.has(cleanId)) {
            return Boolean(this.projectionModes.get(cleanId));
        }
        return true; // 默认开启投影视图
    }

    public isProjectionActive(avId: string): boolean {
        return this.isVirtualProjection(avId);
    }

    /**
     * 切换 AV 模式：物理数据 ⇄ 虚拟投影
     */
    public async toggleProjectionMode(avId: string, customTag?: string): Promise<boolean> {
        const cleanId = (avId || "").trim();
        const currentActive = this.isVirtualProjection(cleanId);
        const nextState = !currentActive;

        const boundTag = customTag || this.getBoundTag(cleanId) || "";

        this.projectionModes.set(cleanId, nextState);
        this.persistBindings();

        if (nextState) {
            if (boundTag) {
                await this.projectSupertagToAV(boundTag, cleanId);
            }
            this.notifyFrontendToRerender(cleanId);
            showMessage(`⚡ 已切换至 #${boundTag || "Supertag"} 标签虚拟投影视图`);
        } else {
            this.notifyFrontendToRerender(cleanId);
            showMessage(`📁 已切换至原生物理数据视图`);
        }

        return nextState;
    }

    /**
     * 建立 Tag 与 AV 的内存绑定映射
     */
    public bindTagToAV(tagName: string, avId: string) {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const cleanAvId = avId.trim();
        const tableName = "proj_" + cleanAvId.replace(/[^a-zA-Z0-9_]/g, "_");
        if (!this.bindings.has(cleanAvId)) {
            this.bindings.set(cleanAvId, {
                tagName: cleanTag,
                tableName,
                attrNames: [],
                createdAt: Date.now()
            });
            this.tagToAvMap.set(cleanTag, cleanAvId);
            this.persistBindings();
        }
    }

    public getBoundTag(avId: string): string | undefined {
        return this.bindings.get(avId.trim())?.tagName;
    }

    public getBinding(avId: string): VirtualAVBinding | undefined {
        return this.bindings.get(avId.trim());
    }

    public getBoundAv(tagName: string): string | undefined {
        const clean = tagName.replace(/^#/, "").trim();
        const root = clean.split(/[\.\/]/)[0].toLowerCase();
        return this.tagToAvMap.get(clean) || this.tagToAvMap.get(root);
    }

    public getBoundAVId(tagName: string): string | undefined {
        return this.getBoundAv(tagName);
    }

    /**
     * 将单个块的属性实时同步/插入到 SQLite 内存虚拟投影热表中
     */
    public async syncBlockToVirtualTable(blockId: string, tagName: string, customAttrs: Record<string, string>, blockContent?: string) {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();
        const avId = this.tagToAvMap.get(cleanTag) || this.tagToAvMap.get(rootTag);
        if (!avId) return;
        const binding = this.bindings.get(avId);
        if (!binding) return;

        await syncBlockToSQLite(binding, avId, blockId, tagName, customAttrs, blockContent);
    }

    /**
     * 当块被移除 Supertag 时，实时从内存热表中删除该行
     */
    public async removeBlockFromVirtualTable(blockId: string, tagName: string) {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();
        const avId = this.tagToAvMap.get(cleanTag) || this.tagToAvMap.get(rootTag);
        if (!avId) return;
        const binding = this.bindings.get(avId);
        if (!binding) return;

        await removeBlockFromSQLite(binding, blockId);
    }

    /**
     * 从思源全库拉取打标块，初始化/重构 SQLite 热表
     */
    public async projectSupertagToAV(tagName: string, avId: string): Promise<{ success: boolean; rowCount: number; attrNames: string[]; message?: string }> {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const cleanAvId = avId.trim();

        this.bindTagToAV(cleanTag, cleanAvId);
        const binding = this.bindings.get(cleanAvId)!;

        return await projectSupertagToSQLite(cleanTag, cleanAvId, binding);
    }

    /**
     * 关闭/解绑虚拟投影 (支持延迟模式下自动统一回写)
     */
    public async unbindTagFromAV(avId: string): Promise<void> {
        const cleanAvId = avId.trim();
        const binding = this.bindings.get(cleanAvId);
        if (!binding) return;

        const syncMode = (settings.get("virtualAvSyncMode") as string) || "realtime";

        if (syncMode === "delayed") {
            const flushedCount = await flushDirtyBlocks(binding);
            if (flushedCount > 0) {
                showMessage(`✓ 虚拟投影已关闭，已将 ${flushedCount} 个修改的属性统一回写到文档本体。`, 4000);
            }
        }

        await dropHotTable(binding.tableName);

        this.bindings.delete(cleanAvId);
        this.tagToAvMap.delete(binding.tagName);
        this.persistBindings();

        this.notifyFrontendToRerender(cleanAvId, binding.blockId);
        if (syncMode === "realtime") {
            showMessage("✓ 已关闭虚拟投影，恢复为普通数据库视图");
        }
    }

    /**
     * 从热 SQLite 表组装 IAV 协议 (含冷启动自愈能力)
     */
    public async generateVirtualIAVFromSQLite(avId: string): Promise<any | null> {
        const binding = this.bindings.get(avId);
        if (!binding) return null;

        try {
            const { db } = await getSqliteEngine();

            // 检查表是否存在，若因重启导致内存表不存在则自动重构
            const tableCheck = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${binding.tableName}';`);
            if (!tableCheck || tableCheck.length === 0 || tableCheck[0].values.length === 0) {
                await this.projectSupertagToAV(binding.tagName, avId);
            }

            const res = db.exec(`SELECT * FROM "${binding.tableName}" ORDER BY _updated DESC;`);
            if (!res || res.length === 0) {
                return buildEmptyIAV(avId, binding.tagName, binding.attrNames);
            }

            return buildVirtualIAVFromSQL(
                avId,
                binding.tagName,
                binding.tableName,
                res[0].columns,
                res[0].values,
                db
            );
        } catch (err) {
            console.error(`[SupertagAVProjector] generateVirtualIAVFromSQLite 异常:`, err);
            return null;
        }
    }

    /**
     * 单元格反向编辑
     */
    public async handleAVCellUpdate(operation: any): Promise<void> {
        if (!operation || this.isSyncing) return;
        const avId = operation.avID || operation.avId;
        const binding = this.bindings.get(avId);
        if (!binding) return;

        try {
            this.isSyncing = true;
            await handleCellUpdateInSQLite(binding, operation);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * 通知当前前端编辑器即时重绘指定 AV 块
     */
    public notifyFrontendToRerender(avId: string, blockId?: string) {
        notifyFrontendToRerender(avId, blockId);
    }

    private persistBindings() {
        try {
            const obj: Record<string, VirtualAVBinding> = {};
            for (const [k, v] of this.bindings.entries()) {
                obj[k] = v;
            }
            localStorage.setItem("indexos_virtual_av_sql_bindings", JSON.stringify(obj));

            const modesObj: Record<string, boolean> = {};
            for (const [k, v] of this.projectionModes.entries()) {
                modesObj[k] = v;
            }
            localStorage.setItem("indexos_av_projection_modes", JSON.stringify(modesObj));
        } catch (e) {}
    }

    private loadPersistedBindings() {
        try {
            const raw = localStorage.getItem("indexos_virtual_av_sql_bindings");
            if (raw) {
                const obj = JSON.parse(raw);
                for (const [k, v] of Object.entries(obj)) {
                    this.bindings.set(k, v as VirtualAVBinding);
                    this.tagToAvMap.set((v as VirtualAVBinding).tagName, k);
                }
            }

            const rawModes = localStorage.getItem("indexos_av_projection_modes");
            if (rawModes) {
                const modesObj = JSON.parse(rawModes);
                for (const [k, v] of Object.entries(modesObj)) {
                    this.projectionModes.set(k, Boolean(v));
                }
            }
        } catch (e) {}
    }
}

export const supertagAVProjector = SupertagAVProjector.getInstance();
