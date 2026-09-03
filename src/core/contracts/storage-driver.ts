/**
 * storage-driver.ts
 * 
 * IndexOS DIP 核心存储契约 (ISqlStorageDriver)
 * 核心引擎通过该接口与任何底层数据库（如 SQLite WASM、IndexedDB、PostgreSQL）解耦对话。
 */

export interface SqlQueryResult<T = any> {
    columns: string[];
    values: any[][];
    rows: T[];
}

export interface ISqlStorageDriver {
    /** 执行只读 SQL 查询并返回结构化行 */
    query<T = any>(sql: string, params?: any[]): Promise<T[]>;
    
    /** 执行原生 SQL 语句（DDL/DML），返回影响或原生结果 */
    execute(sql: string, params?: any[]): Promise<any>;
    
    /** 检查数据表是否存在 */
    hasTable(tableName: string): Promise<boolean>;
    
    /** 批量原子事务 */
    transaction(sqls: Array<{ sql: string; params?: any[] }>): Promise<void>;
    
    /** 将当前数据库状态持久化到存储介质 */
    saveToDisk?(): Promise<void>;
}
