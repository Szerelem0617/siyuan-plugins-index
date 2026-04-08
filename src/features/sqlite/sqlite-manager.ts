import { post } from "../../shared/api-client/request";

let dbInstance: any = null;
let SQL_ENGINE: any = null;
const STORAGE_DB_PATH = "/data/storage/petal/siyuan-plugins-index/index-os.sqlite";

export async function getSqliteEngine() {
    if (dbInstance) return { db: dbInstance, SQL: SQL_ENGINE };

    try {
        if (!(window as any).initSqlJs) {
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
        SQL_ENGINE = await initSqlJs({
            locateFile: (file: string) => `/plugins/siyuan-plugins-index/${file}`
        });

        // 1. 尝试从磁盘加载
        try {
            const fileRes = await fetch("/api/file/getFile", {
                method: "POST",
                body: JSON.stringify({ path: STORAGE_DB_PATH })
            });
            
            if (fileRes.status === 200) {
                const buffer = await fileRes.arrayBuffer();
                dbInstance = new SQL_ENGINE.Database(new Uint8Array(buffer));
                console.log("[SQLiteManager] Disk DB Loaded.");
            } else {
                dbInstance = new SQL_ENGINE.Database();
            }
        } catch (e) {
            dbInstance = new SQL_ENGINE.Database();
        }

        // 2. 初始化元数据
        dbInstance.run("CREATE TABLE IF NOT EXISTS _meta (id TEXT PRIMARY KEY, type TEXT, updated TEXT);");
        
        return { db: dbInstance, SQL: SQL_ENGINE };
    } catch (e) {
        throw e;
    }
}

export async function saveDatabaseToDisk() {
    if (!dbInstance) return;
    try {
        const data = dbInstance.export();
        const formData = new FormData();
        formData.append("path", STORAGE_DB_PATH);
        formData.append("file", new Blob([data]));
        formData.append("isDir", "false");

        await fetch("/api/file/putFile", { method: "POST", body: formData });
    } catch (e) {
        console.error("Save failed", e);
    }
}

export async function instantiateAV(avID: string) {
    const { db } = await getSqliteEngine();
    const res = await post("/api/av/getAttributeView", { id: avID });
    const av = res.av || res;
    const keyValues = av.keyValues || [];
    
    if (keyValues.length === 0) return { success: false, message: "Empty" };

    const columns = keyValues.map((kv: any) => ({
        id: kv.key.id,
        name: kv.key.name.replace(/[^\w]/g, '_'),
        type: kv.key.type
    }));

    db.run(`DROP TABLE IF EXISTS "${avID}";`); 
    db.run(`CREATE TABLE "${avID}" (rowID TEXT PRIMARY KEY, ${columns.map(c => `"${c.name}" TEXT`).join(", ")});`);

    const rowMap = new Map<string, any>();
    keyValues.forEach((kv: any) => {
        const colSafeName = kv.key.name.replace(/[^\w]/g, '_');
        kv.values?.forEach((v: any) => {
            const rowId = v.itemID || v.itemId || v.id;
            if (!rowMap.has(rowId)) rowMap.set(rowId, { rowID: rowId });
            const item = rowMap.get(rowId);
            item[colSafeName] = v.text?.content || v.number?.content || v.mOption?.map((o: any) => o.content).join(", ") || v.content || "";
        });
    });

    const rows = Array.from(rowMap.values());
    for (const row of rows) {
        const fields = ["rowID", ...columns.map(c => c.name)];
        const values = fields.map(f => row[f] || "");
        db.run(`INSERT INTO "${avID}" (${fields.map(f => `"${f}"`).join(", ")}) VALUES (${fields.map(() => "?").join(", ")});`, values);
    }

    db.run(`INSERT OR REPLACE INTO _meta (id, type, updated) VALUES (?, 'av', ?);`, [avID, new Date().toISOString()]);
    await saveDatabaseToDisk();

    return { success: true, rowCount: rows.length };
}

export async function runQuery(sql: string) {
    const { db } = await getSqliteEngine();
    const res = db.exec(sql);
    return res.length > 0 ? { columns: res[0].columns, values: res[0].values } : { columns: [], values: [] };
}

export async function getInstantiatedIds(): Promise<Set<string>> {
    const { db } = await getSqliteEngine();
    try {
        const res = db.exec("SELECT id FROM _meta WHERE type = 'av'");
        return new Set(res[0]?.values.map((v: any) => v[0]) || []);
    } catch { return new Set(); }
}
