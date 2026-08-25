/**
 * types.ts
 *
 * Supertag AV 虚拟投影引擎核心类型定义与元数据仓库
 */

export interface VirtualColumnMeta {
    id: string;   // 原生 key.id
    name: string; // 显示名称 (如 "状态", "优先级")
    type: string; // 列类型 (如 "select", "date", "text")
}

const columnMetaRegistry = new Map<string, VirtualColumnMeta>();

export function registerColumnMeta(tag: string, slug: string, meta: VirtualColumnMeta) {
    columnMetaRegistry.set(`${tag.toLowerCase()}:${slug.toLowerCase()}`, meta);
}

export function getColumnMeta(tag: string, slug: string): VirtualColumnMeta | undefined {
    return columnMetaRegistry.get(`${tag.toLowerCase()}:${slug.toLowerCase()}`);
}

export interface VirtualAVBinding {
    tagName: string;
    tableName: string;
    attrNames: string[];
    blockId?: string;
    createdAt: number;
}
