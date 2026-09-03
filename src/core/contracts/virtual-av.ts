/**
 * virtual-av.ts
 * 
 * IndexOS DIP 虚拟多维表格驱动契约 (IVirtualAvDriver)
 * 定义将底层 SQL 虚拟表投射到多维表格视图的标准流式分页与单元格双向编辑契约。
 */

export interface VirtualAvPagination {
    page: number;
    pageSize: number;
    totalCount: number;
    pageCount: number;
}

export interface IVirtualAvDriver {
    /** 检查指定的 AV 标识是否由本虚拟驱动接管 */
    isVirtual(avId: string): boolean;
    
    /** 基于页码与页长请求渲染虚拟视图 JSON 结构 */
    renderView(avId: string, page?: number, pageSize?: number): Promise<any | null>;
    
    /** 处理表格内单元格事务修改并回写底层 */
    updateCell(operation: any): Promise<void>;
}
