/**
 * types.ts
 *
 * Supertag AV 虚拟投影引擎核心类型定义
 */

export interface VirtualAVBinding {
    tagName: string;
    tableName: string;
    attrNames: string[];
    blockId?: string;
    createdAt: number;
}
