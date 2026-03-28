import { client } from "../../shared/api-client";

export async function getSqliteStatus() {
    try {
        // Here we attempt to check if sql.js is available or if we can load it.
        // For now, since it was just added to package.json, we check if we can import it.
        // In real production, we'd use the CDN approach if we don't want to bundle it.
        
        const startTime = performance.now();
        // @ts-ignore
        const initSqlJs = (window as any).initSqlJs || (await import("sql.js")).default;
        
        if (typeof initSqlJs !== 'function') {
            return { status: "error", message: "initSqlJs is not a function. Check if sql.js is correctly bundled or provided via window." };
        }

        const SQL = await initSqlJs({
            // locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${file}`
        });
        const db = new SQL.Database();
        const endTime = performance.now();
        
        return { 
            status: "success", 
            message: "SQLite WASM (sql.js) is successfully initialized.",
            loadTime: (endTime - startTime).toFixed(2) + "ms",
            version: SQL.version || "unknown"
        };
    } catch (e) {
        console.error("[SQLiteManager] Load fail:", e);
        return { status: "error", message: e.message };
    }
}
