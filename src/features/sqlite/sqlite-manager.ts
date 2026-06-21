import { post } from "../../shared/api-client/request";
import { plugin } from "../../shared/utils";

let dbInstance: any = null;
let SQL_ENGINE: any = null;
const STORAGE_DB_PATH = "/data/storage/petal/siyuan-plugins-index/index-os.sqlite";

export async function getSqliteEngine() {
    if (dbInstance) return { db: dbInstance, SQL: SQL_ENGINE };

    try {
        if (!(window as any).initSqlJs) {
            const pluginId = plugin?.id || "siyuan-plugins-index";
            const scriptUrl = `/plugins/${pluginId}/sql-wasm.js`;

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
            locateFile: (file: string) => `/plugins/${plugin?.id || "siyuan-plugins-index"}/${file}`
        });

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
    console.log(`[SQLiteManager] Instantiating AV: ${avID}`);
    const res = await post("/api/av/getAttributeView", { id: avID });
    
    // Debug: Check if the response is actually valid
    if (!res || (res.code && res.code !== 0)) {
        console.error(`[SQLiteManager] API Error for ${avID}:`, res);
        return { success: false, message: `API Error: ${res?.msg || "Unknown"}` };
    }

    const av = res.av || res;
    const keyValues = av.keyValues || [];
    // console.log(`[SQLiteManager] Fetched AV structure for ${avID}. Columns: ${keyValues.length}`);

    if (keyValues.length === 0) return { success: false, message: "Empty/No columns" };

    // 1. 映射列头 (增加去重逻辑)
    const usedNames = new Set(["rowID"]);
    const columns = keyValues.map((kv: any) => {
        let baseName = kv.key.name.replace(/[^\w]/g, '_') || "unnamed";
        let safeName = baseName;
        
        // 如果已存在或为空（比如全是非 ASCII 字符），则追加 ID 后四位
        if (usedNames.has(safeName) || safeName === "__") {
            safeName = `${baseName}_${kv.key.id.slice(-4)}`;
        }
        
        // 万一还是重名（极端情况），使用自增序号
        let counter = 1;
        while (usedNames.has(safeName)) {
            safeName = `${baseName}_${counter}`;
            counter++;
        }

        usedNames.add(safeName);
        return {
            id: kv.key.id,
            name: safeName,
            type: kv.key.type
        };
    });

    // 2. 清理旧数据并重新建表
    // console.log(`[SQLiteManager] Creating table "${avID}"...`);
    db.run(`DROP TABLE IF EXISTS "${avID}";`);
    db.run(`CREATE TABLE "${avID}" (rowID TEXT PRIMARY KEY, ${columns.map(c => `"${c.name}" TEXT`).join(", ")});`);

    // 3. 行归类数据平铺
    const rowMap = new Map<string, any>();
    // 预先建立 ID 到 安全列名 的映射，防止在循环中重复计算
    const idToSafeName = new Map<string, string>();
    columns.forEach(c => idToSafeName.set(c.id, c.name));

    keyValues.forEach((kv: any) => {
        const colSafeName = idToSafeName.get(kv.key.id);
        const colId = kv.key.id;
        
        if (!colSafeName) return;

        kv.values?.forEach((v: any) => {
            try {
                const rowId = v.blockID || v.blockId || v.itemID || v.itemId;
                if (!rowId) return;

                if (!rowMap.has(rowId)) rowMap.set(rowId, { rowID: rowId });
                const item = rowMap.get(rowId);

                let val: any = null;
                // 增强型值提取逻辑，增加防护与 Debug
                if (v.block) {
                    val = v.block.content;
                } else if (v.text) {
                    val = v.text.content;
                } else if (v.number) {
                    val = v.number.isNotEmpty ? v.number.content : null;
                } else if (v.mSelect || v.mOption) {
                    const options = v.mSelect || v.mOption || [];
                    const contents = options.map((o: any) => o?.content).filter(Boolean);
                    val = contents.length > 0 ? JSON.stringify(contents) : null;
                } else if (v.url) {
                    val = v.url.content;
                } else if (v.email) {
                    val = v.email.content;
                } else if (v.phone) {
                    val = v.phone.content;
                } else if (v.checkbox) {
                    val = v.checkbox.checked ? 1 : 0;
                } else if (v.date) {
                    val = v.date.isNotEmpty ? v.date.content : null;
                } else if (v.relation) {
                    // --- Relation Debug Segment ---
                    const relContents = v.relation.contents || [];
                    const relIds = relContents.map((rc: any) => {
                        if (!rc) return null;
                        return rc.block?.id || rc.blockID || rc.content || (rc.Block ? rc.Block.ID : null);
                    }).filter(Boolean);
                    val = relIds.length > 0 ? JSON.stringify(relIds) : null;
                } else if (v.rollup) {
                    const rollupContents = v.rollup.contents || [];
                    const rollupVals = rollupContents.map((rc: any) => rc?.content || "").filter(Boolean);
                    val = rollupVals.length > 1 ? JSON.stringify(rollupVals) : (rollupVals[0] || null);
                } else if (v.mAsset) {
                    val = (v.mAsset && v.mAsset.length > 0) ? JSON.stringify(v.mAsset) : null;
                } else {
                    val = v.content || null;
                }

                item[colSafeName] = val;
            } catch (cellMetaError) {
                console.error(`[SQLite-Debug] Cell Process Error. Col: ${kv.key.name}(${colId}), Row: ${v.blockID}`, cellMetaError, v);
            }
        });
    });

    // 4. 批量执行插入
    const rows = Array.from(rowMap.values());
    console.log(`[SQLiteManager] Inserting ${rows.length} rows into "${avID}"...`);
    
    for (const row of rows) {
        try {
            const fields = ["rowID", ...columns.map(c => c.name)];
            const placeholders = fields.map(() => "?").join(", ");
            const values = fields.map(f => {
                const v = row[f];
                return (v === undefined || v === null) ? null : v;
            });
            
            db.run(`INSERT INTO "${avID}" (${fields.map(f => `"${f}"`).join(", ")}) VALUES (${placeholders});`, values);
        } catch (rowInsertError) {
            console.error(`[SQLite-Debug] Row Insert Failed. Data:`, row, rowInsertError);
        }
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
