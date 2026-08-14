import { getSqliteEngine, saveDatabaseToDisk } from "../../sqlite/sqlite-manager";
import commandsData from "../registry/builtin";

const TABLE_REGISTRY = "sys_registry_db";

/**
 * ⚠️ 系统架构说明（v1.11+）
 *
 * 1. sys_registry_db 是 Layer 1 命令定义的 SQLite 查询缓存/镜像，
 *    定义的真实来源是 commands.json + 内存注册表（executor 不可序列化）。
 * 2. Layer 2（Command-DB）/ Layer 3（Type-DB）的种子数据已迁移到
 *    seed-data.ts 的 TS 常量中，不再有 sys_command_db / sys_type_db 表。
 * 3. 未实例化时运行时读 seed-data.ts；实例化后读思源 AV（经 av_ 镜像）。
 *    种子常量只读，运行时禁止写入。
 */
export async function initSystemTables() {
    const { db } = await getSqliteEngine();

    // Layer 1 注册表
    db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_REGISTRY} (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        dispatch TEXT,
        params TEXT,
        constraints TEXT,
        meta TEXT
    );`);

    // 清理旧的内置命令数据并重新从 commands.json 载入以保证热更新生效
    try {
        db.run(`DELETE FROM ${TABLE_REGISTRY} WHERE meta LIKE '%builtin%' OR meta IS NULL`);
    } catch (_) { /* ignore */ }

    const stmt = db.prepare(`INSERT OR REPLACE INTO ${TABLE_REGISTRY} (id, name, description, dispatch, params, constraints, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const cmd of (commandsData as any).commands) {
        stmt.run([
            cmd.id,
            cmd.name,
            cmd.description || "",
            JSON.stringify(cmd.dispatch),
            JSON.stringify(cmd.params),
            JSON.stringify(cmd.constraints),
            JSON.stringify(cmd.meta)
        ]);
    }
    stmt.free();

    await saveDatabaseToDisk();
}

/**
 * Returns the table names for other modules to use.
 * Layer 2/3 种子表已删除，仅保留 Layer 1 注册表。
 */
export function getSystemTableNames() {
    return {
        registry: TABLE_REGISTRY
    };
}
