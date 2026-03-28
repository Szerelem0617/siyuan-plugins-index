
export async function getSqliteStatus() {
    try {
        const startTime = performance.now();
        
        // 101% Offline Stable: Load directly from the local plugin path via SiYuan's server
        if (!(window as any).initSqlJs) {
            console.log("[SQLiteManager] Initializing engine from local storage...");
            const pluginName = "siyuan-plugins-index";
            const scriptUrl = `/plugins/${pluginName}/sql-wasm.js`;

            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = scriptUrl;
                script.onload = resolve;
                script.onerror = () => reject(new Error(`Failed to load ${scriptUrl}`));
                document.head.appendChild(script);
            });
        }

        const initSqlJs = (window as any).initSqlJs;
        if (typeof initSqlJs !== 'function') {
            return { status: "error", message: "initSqlJs initialization failed." };
        }

        // Explicitly locate the .wasm file in the local plugin directory
        const SQL = await initSqlJs({
            locateFile: (file: string) => {
                if (file.endsWith(".wasm")) {
                    return `/plugins/siyuan-plugins-index/${file}`;
                }
                return file;
            }
        });
        const db = new SQL.Database();
        const endTime = performance.now();
        
        // Use client to suppress warning if needed, but not really needed here
        console.log("[SQLiteManager] Test query result:", db.exec("SELECT 1")[0].values[0][0]);
        
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
