/**
 * writeback-coordinator.ts
 *
 * Supertag 虚拟投影高效防抖批量写回管道 (Batch Writeback Pipeline)
 * 核心特性：
 * 1. 100ms 防抖聚合池：将密集的单格/多行编辑合并为单次 /api/attr/batchSetBlockAttrs 批量提交；
 * 2. 确定性 Slug 翻译：通过 getPhysicalAttrKey(tag, slug) 生成合法的 custom-${tag}-${slug}；
 * 3. 事务防回环互锁 (Anti-Loop Tx Lock)：记录最近写回的 token，拦截随后广播的重复事件。
 */

import { post } from "../../../shared/api-client/request";
import { getPhysicalAttrKey } from "../core/supertag-schema";
import { notifyFrontendToRerender } from "./rerender-dispatcher";

class WritebackCoordinator {
    private static instance: WritebackCoordinator | null = null;
    private queue: Map<string, Map<string, string>> = new Map(); // blockId -> (attrKey -> value)
    private timer: any = null;
    private antiLoopTokens = new Set<string>(); // "blockId:attrKey:value"

    public static getInstance(): WritebackCoordinator {
        if (!WritebackCoordinator.instance) {
            WritebackCoordinator.instance = new WritebackCoordinator();
        }
        return WritebackCoordinator.instance;
    }

    /**
     * 将一次单元格更新推入批量写回队列 (防抖 100ms 批量提交)
     */
    public enqueue(blockId: string, tagName: string, slug: string, value: string, avId?: string) {
        if (!blockId || !slug) return;
        const attrKey = getPhysicalAttrKey(tagName, slug);

        if (!this.queue.has(blockId)) {
            this.queue.set(blockId, new Map());
        }
        this.queue.get(blockId)!.set(attrKey, value);

        // 注册防回环 token (有效期 3000ms)
        const token = `${blockId}:${attrKey}:${value}`;
        this.antiLoopTokens.add(token);
        setTimeout(() => this.antiLoopTokens.delete(token), 3000);

        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.flush(avId);
        }, 100);
    }

    /**
     * 判断某个外部变更事件是否由本协调器自身写回产生 (防回环)
     */
    public isSelfUpdate(blockId: string, attrKey: string, value: string): boolean {
        const token = `${blockId}:${attrKey}:${value}`;
        return this.antiLoopTokens.has(token);
    }

    /**
     * 立即将聚合池中的所有属性变更通过 batchSetBlockAttrs 批量提交给思源内核
     */
    public async flush(avId?: string) {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.queue.size === 0) return;

        const blockAttrs: Array<{ id: string; attrs: Record<string, string> }> = [];
        for (const [blockId, attrMap] of this.queue.entries()) {
            const attrsObj: Record<string, string> = {};
            for (const [k, v] of attrMap.entries()) {
                attrsObj[k] = v;
            }
            blockAttrs.push({
                id: blockId,
                attrs: attrsObj
            });
        }
        this.queue.clear();

        try {
            await post("/api/attr/batchSetBlockAttrs", {
                blockAttrs
            });

            if (avId) {
                setTimeout(() => {
                    notifyFrontendToRerender(avId);
                }, 80);
            }
        } catch (err) {
            console.error("[WritebackCoordinator] 批量写回块属性失败:", err);
        }
    }
}

export const writebackCoordinator = WritebackCoordinator.getInstance();
