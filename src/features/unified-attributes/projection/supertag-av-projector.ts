/**
 * supertag-av-projector.ts
 *
 * Supertag ➔ 思源原生 AV (Attribute View) 纯热 SQLite 数据库投影与双向同步引擎
 *
 * 核心架构：
 * 1. 【热 SQLite 表单一真理源】
 *    为每一个虚拟投影建立专属的 SQLite 数据表 (如 proj_xxx)，所有增删改查全量走标准 SQL 驱动。
 *    支持冷启动自愈：当内存数据库重启重置时，首次渲染自动从 SQLite 块缓存重构热表。
 * 2. 【双回写模式支持 (Settings 自适应)】
 *    - 模式 1 (realtime 实时同步)：在 SQLite 热表中执行 UPDATE，并及时将变更写回物理块 custom-* 属性。
 *    - 模式 2 (delayed 延迟统一回写)：在投影期间物理 Markdown 文件保持 0 写入，仅在用户点击“关闭虚拟投影”时，统一提取 _dirty 标记的行进行批量回写，随后清理 SQL 表。
 * 3. 【零磁盘双存 + 事务拦截防报错】
 *    通过 Hook 拦截 /api/av/renderAttributeView (从 SQL 表合成 IAV 视图) 与 /api/transactions (拦截虚拟表操作，阻止 Go 后端报错)。
 * 4. 【就地即时渲染】
 *    开启/关闭/修改投影时，向当前编辑器全域派发原生 refreshAttributeView 消息，就地瞬间重绘。
 */

import { post } from "../../../shared/api-client/request";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import { settings } from "../../../core/settings";
import { showMessage } from "siyuan";
import { parseSupertags } from "../core/supertag-diff";

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

export class SupertagAVProjector {
    private static instance: SupertagAVProjector | null = null;
    /** 记录虚拟投影绑定关系: avId -> VirtualAVBinding */
    private bindings = new Map<string, VirtualAVBinding>();
    /** 记录 Supertag -> avId 映射 */
    private tagToAvMap = new Map<string, string>();
    /** 记录用户切换的投影视图模式: avId -> boolean (true: 投影视图, false: 物理数据视图) */
    private projectionModes = new Map<string, boolean>();
    /** 标记拦截器是否已安装 */
    private isHookInstalled = false;
    /** 防回环互锁 */
    private isSyncing = false;

    public static getInstance(): SupertagAVProjector {
        if (!SupertagAVProjector.instance) {
            SupertagAVProjector.instance = new SupertagAVProjector();
            SupertagAVProjector.instance.installFetchHook();
            SupertagAVProjector.instance.loadPersistedBindings();
        }
        return SupertagAVProjector.instance;
    }

    /**
     * 安装 window.fetch 拦截器，捕获 /api/av/renderAttributeView 与 /api/transactions
     */
    public installFetchHook() {
        if (this.isHookInstalled || typeof window === "undefined") return;
        this.isHookInstalled = true;

        const originalFetch = window.fetch;
        const self = this;

        window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            try {
                const url = typeof input === "string" ? input : (input instanceof Request ? input.url : input.toString());

                // 1. 拦截 AV 渲染请求 -> 直接从热 SQLite 表合成虚拟 IAV 返回前端
                if (url.includes("/api/av/renderAttributeView")) {
                    let reqBody: any = null;
                    if (typeof init?.body === "string") {
                        try { reqBody = JSON.parse(init.body); } catch (_) {}
                    } else if (init?.body && typeof init.body === "object") {
                        reqBody = init.body;
                    }

                    const avId = reqBody?.id || reqBody?.avID;
                    const isVirtual = avId ? self.isVirtualProjection(avId) : false;

                    if (avId && isVirtual) {
                        const virtualData = await self.generateVirtualIAVFromSQLite(avId);
                        if (virtualData) {
                            setTimeout(async () => {
                                try {
                                    const { avProjectionToggle } = await import("./av-projection-toggle");
                                    avProjectionToggle.scanAndMountToggles();
                                } catch (_) {}
                            }, 40);
                            return new Response(JSON.stringify({
                                code: 0,
                                msg: "",
                                data: virtualData
                            }), {
                                status: 200,
                                headers: { "Content-Type": "application/json" }
                            });
                        }
                    } else {
                        setTimeout(async () => {
                            try {
                                const { avProjectionToggle } = await import("./av-projection-toggle");
                                avProjectionToggle.scanAndMountToggles();
                            } catch (_) {}
                        }, 60);
                    }
                }

                // 2. 拦截虚拟 AV 的单元格编辑事务 -> 在 SQLite 中执行 UPDATE 并阻止 Go 后端报错
                if (url.includes("/api/transactions")) {
                    let reqBody: any = null;
                    if (typeof init?.body === "string") {
                        reqBody = JSON.parse(init.body);
                    } else if (init?.body && typeof init.body === "object") {
                        reqBody = init.body;
                    }

                    const txs = reqBody?.transactions || [];
                    let hasVirtualAvOp = false;

                    for (const tx of txs) {
                        const ops = tx?.doOperations || [];
                        for (const op of ops) {
                            if ((op.action === "updateAttrViewCell" || op.action === "updateAttrViewCells" || op.action === "setAttrViewCell") && self.isVirtualProjection(op.avID)) {
                                hasVirtualAvOp = true;
                                await self.handleAVCellUpdate(op);
                            }
                        }
                    }

                    if (hasVirtualAvOp) {
                        return new Response(JSON.stringify({
                            code: 0,
                            msg: "",
                            data: txs.map((t: any) => ({ doOperations: t.doOperations || [] }))
                        }), {
                            status: 200,
                            headers: { "Content-Type": "application/json" }
                        });
                    }
                }
            } catch (err) {
                console.error(`[SupertagAVProjector] 拦截请求处理异常:`, err);
            }

            return originalFetch.apply(this, arguments as any);
        };

        console.log(`🚀 [SupertagAVProjector] 热 SQLite 拦截网关已就绪 (SQL驱动 + 零磁盘双存)`);
    }

    public isVirtualProjection(avId: string): boolean {
        const cleanId = avId.trim();
        if (!this.bindings.has(cleanId)) return false;
        // 如果用户显式关闭了该数据库的投影视图，返回 false
        if (this.projectionModes.has(cleanId)) {
            return Boolean(this.projectionModes.get(cleanId));
        }
        return true; // 默认开启投影视图
    }

    public isProjectionActive(avId: string): boolean {
        return this.isVirtualProjection(avId);
    }

    public async toggleProjectionMode(avId: string, customTag?: string): Promise<boolean> {
        const cleanId = avId.trim();
        const currentActive = this.isVirtualProjection(cleanId);
        const nextState = !currentActive;

        const boundTag = customTag || this.getBoundTag(cleanId) || "";

        // 立即设置新状态并持久化，保证后续任何 fetch hook 均读取最新状态
        this.projectionModes.set(cleanId, nextState);
        this.persistBindings();

        if (nextState) {
            // 切换为虚拟投影模式：从思源全库拉取打标块并构建热表
            if (boundTag) {
                await this.projectSupertagToAV(boundTag, cleanId);
            }
            this.notifyFrontendToRerender(cleanId);
            showMessage(`⚡ 已切换至 #${boundTag || "Supertag"} 标签虚拟投影视图`);
        } else {
            // 切换为原生物理数据模式
            this.notifyFrontendToRerender(cleanId);
            showMessage(`📁 已切换至原生物理数据视图`);
        }

        return nextState;
    }

    public bindTagToAV(tagName: string, avId: string) {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const cleanAvId = avId.trim();
        const tableName = "proj_" + cleanAvId.replace(/[^a-zA-Z0-9_]/g, "_");
        if (!this.bindings.has(cleanAvId)) {
            this.bindings.set(cleanAvId, {
                tagName: cleanTag,
                tableName,
                attrNames: [],
                createdAt: Date.now()
            });
            this.tagToAvMap.set(cleanTag, cleanAvId);
            this.persistBindings();
        }
    }

    public getBoundTag(avId: string): string | undefined {
        return this.bindings.get(avId.trim())?.tagName;
    }

    public getBinding(avId: string): VirtualAVBinding | undefined {
        return this.bindings.get(avId.trim());
    }

    public getBoundAv(tagName: string): string | undefined {
        const clean = tagName.replace(/^#/, "").trim();
        const root = clean.split(/[\.\/]/)[0].toLowerCase();
        return this.tagToAvMap.get(clean) || this.tagToAvMap.get(root);
    }

    public getBoundAVId(tagName: string): string | undefined {
        return this.getBoundAv(tagName);
    }

    /**
     * 将单个块的属性实时同步/插入到 SQLite 内存虚拟投影热表中 (0 延迟即时呈现)
     */
    public async syncBlockToVirtualTable(blockId: string, tagName: string, customAttrs: Record<string, string>, blockContent?: string) {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();
        const avId = this.tagToAvMap.get(cleanTag) || this.tagToAvMap.get(rootTag);
        if (!avId) return;
        const binding = this.bindings.get(avId);
        if (!binding) return;

        try {
            const { db } = await getSqliteEngine();
            // 确保表存在
            const tableCheck = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${binding.tableName}';`);
            if (!tableCheck || tableCheck.length === 0 || tableCheck[0].values.length === 0) {
                await this.initSQLiteTableForTag(binding.tagName || rootTag, binding.tableName);
            }

            // 获取热表的列定义
            const colInfoRes = db.exec(`PRAGMA table_info("${binding.tableName}");`);
            if (!colInfoRes || colInfoRes.length === 0) return;

            const existingCols = colInfoRes[0].values.map((r: any) => String(r[1])); // 列名列表
            
            // 如果 customAttrs 中有热表中尚未建立的专属新列，动态 ALTER TABLE ADD COLUMN
            for (const [k] of Object.entries(customAttrs)) {
                if (k.startsWith(`custom-${rootTag}-`) || k.startsWith(`custom-${cleanTag}-`)) {
                    const prefix = k.startsWith(`custom-${rootTag}-`) ? `custom-${rootTag}-` : `custom-${cleanTag}-`;
                    const colName = k.slice(prefix.length);
                    if (!existingCols.includes(colName) && colName !== "id" && colName !== "title" && !colName.startsWith("_")) {
                        try {
                            db.exec(`ALTER TABLE "${binding.tableName}" ADD COLUMN "${colName}" TEXT;`);
                            existingCols.push(colName);
                            if (!binding.attrNames.includes(colName)) {
                                binding.attrNames.push(colName);
                            }
                        } catch (_) {}
                    }
                }
            }

            // 构造 INSERT OR REPLACE
            const content = String(blockContent || "未命名项").replace(/#([^#\s]+)#?/g, "").trim() || "未命名项";
            const colNames = ["id", "title", "_updated", "_dirty"];
            const colValues: any[] = [blockId, content, Date.now(), 0];

            for (const col of existingCols) {
                if (col !== "id" && col !== "title" && col !== "_root_id" && col !== "_updated" && col !== "_dirty") {
                    colNames.push(col);
                    const val = customAttrs[`custom-${rootTag}-${col}`] ??
                                customAttrs[`custom-${cleanTag}-${col}`] ??
                                "";
                    colValues.push(val);
                }
            }

            const placeholders = colNames.map(() => "?").join(", ");
            const sql = `INSERT OR REPLACE INTO "${binding.tableName}" (${colNames.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders});`;
            db.run(sql, colValues);

            console.log(`[SupertagAVProjector] ✓ 已将块 ${blockId} 实时同步至热表 ${binding.tableName}`);
        } catch (err) {
            console.error(`[SupertagAVProjector] 同步块到热表失败:`, err);
        }
    }

    /**
     * 当块被移除 Supertag 时，实时从内存热表中删除该行
     */
    public async removeBlockFromVirtualTable(blockId: string, tagName: string) {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();
        const avId = this.tagToAvMap.get(cleanTag) || this.tagToAvMap.get(rootTag);
        if (!avId) return;
        const binding = this.bindings.get(avId);
        if (!binding) return;

        try {
            const { db } = await getSqliteEngine();
            db.run(`DELETE FROM "${binding.tableName}" WHERE id = ?;`, [blockId]);
        } catch (_) {}
    }

    /**
     * 核心步骤 2: 从思源全库拉取打标块，初始化 SQLite 热表
     */
    public async projectSupertagToAV(tagName: string, avId: string): Promise<{ success: boolean; rowCount: number; attrNames: string[]; message?: string }> {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const cleanAvId = avId.trim();
        const rootTag = cleanTag.split(/[\.\/]/)[0].toLowerCase();

        // 建立双向持久化映射
        this.bindTagToAV(cleanTag, cleanAvId);
        const binding = this.bindings.get(cleanAvId)!;
        const tableName = binding.tableName;

        try {
            // 1. 查询全库命中标签或带有该 tag custom 属性的物理块
            const blocksRes = await post("/api/query/sql", {
                stmt: `SELECT id, root_id, content, ial, tag, updated, created FROM blocks WHERE ial LIKE '%custom-supertags%' OR ial LIKE '%custom-${rootTag}%' OR ial LIKE '%custom-${cleanTag}%' OR tag LIKE '%#${rootTag}#%' OR tag = '${rootTag}' OR tag LIKE '%#${rootTag}.%' OR tag LIKE '%#${rootTag}/%' ORDER BY updated DESC LIMIT 500`
            });

            const rows: any[] = Array.isArray(blocksRes) ? blocksRes : (blocksRes?.data || []);
            const parsedRows: any[] = [];
            const attrKeysSet = new Set<string>();

            for (const row of rows) {
                const attrs = parseIAL(row.ial || "");
                const blockTags = new Set<string>();

                // 解析显式 Supertags
                if (attrs["custom-supertags"]) {
                    parseSupertags(attrs["custom-supertags"]).forEach(t => blockTags.add(t.toLowerCase()));
                }
                if (attrs["custom-index-tags"]) {
                    parseSupertags(attrs["custom-index-tags"]).forEach(t => blockTags.add(t.toLowerCase()));
                }

                // 解析行内标签与块 tag 属性
                if (row.tag) {
                    row.tag.split(/[\s,]+/).forEach((t: string) => {
                        const cl = t.replace(/#/g, "").trim().toLowerCase();
                        if (cl) blockTags.add(cl);
                    });
                }

                const isTagMatched = Array.from(blockTags).some(t => 
                    t === cleanTag.toLowerCase() || 
                    t === rootTag || 
                    t.startsWith(`${rootTag}.`) || 
                    t.startsWith(`${rootTag}/`)
                );

                // 检查是否有任何当前 Tag 专属的 custom-<tag>-* 属性
                const hasTagCustomAttr = Object.keys(attrs).some(k => 
                    k.startsWith(`custom-${rootTag}-`) || k.startsWith(`custom-${cleanTag}-`)
                );

                if (!isTagMatched && !hasTagCustomAttr) {
                    continue; // 严格过滤：非此 Tag 的块绝不投影！
                }

                parsedRows.push({
                    id: row.id,
                    content: String(row.content || "未命名项").replace(/#([^#\s]+)#?/g, "").trim() || "未命名项",
                    root_id: row.root_id || "",
                    updated: parseInt(row.updated || "0") || Date.now(),
                    attrs
                });

                // 严格只收集以当前 rootTag 或 cleanTag 开头的专属属性 (custom-<tag>-<attr>)
                for (const k of Object.keys(attrs)) {
                    if (k.startsWith("custom-")) {
                        const rawClean = k.replace(/^custom-/, "");
                        if (rawClean.startsWith(`${rootTag}-`) || rawClean.startsWith(`${cleanTag}-`)) {
                            const prefix = rawClean.startsWith(`${rootTag}-`) ? `${rootTag}-` : `${cleanTag}-`;
                            attrKeysSet.add(rawClean.slice(prefix.length));
                        }
                    }
                }
            }

            if (attrKeysSet.size === 0) attrKeysSet.add("status");
            const attrNames = Array.from(attrKeysSet);
            const { db } = await getSqliteEngine();

            db.exec(`DROP TABLE IF EXISTS "${tableName}";`);

            const colDefs = [
                `"id" TEXT PRIMARY KEY`,
                `"title" TEXT`,
                `"_root_id" TEXT`,
                `"_updated" INTEGER`,
                `"_dirty" INTEGER DEFAULT 0`,
                ...attrNames.map(a => `"${a}" TEXT`)
            ].join(",\n    ");

            const createSql = `CREATE TABLE "${tableName}" (\n    ${colDefs}\n);`;
            db.exec(createSql);

            // 批量插入初始数据
            if (parsedRows.length > 0) {
                const colNames = ["id", "title", "_root_id", "_updated", "_dirty", ...attrNames];
                const placeholders = colNames.map(() => "?").join(", ");
                const insertSql = `INSERT INTO "${tableName}" (${colNames.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders});`;
                const stmt = db.prepare(insertSql);

                for (const r of parsedRows) {
                    const rowValues = [
                        r.id,
                        r.content,
                        r.root_id,
                        r.updated,
                        0,
                        ...attrNames.map(a => {
                            return r.attrs[`custom-${cleanTag}-${a}`] ||
                                   r.attrs[`custom-${rootTag}-${a}`] ||
                                   "";
                        })
                    ];
                    stmt.run(rowValues);
                }
                stmt.free();
            }

            return { success: true, rowCount: parsedRows.length, attrNames };
        } catch (err) {
            console.error(`[SupertagAVProjector] 初始化 SQLite 热表失败:`, err);
            return { success: false, rowCount: 0, attrNames: [], message: String(err) };
        }
    }

    /**
     * 关闭/解绑虚拟投影 (支持延迟模式下自动统一回写)
     */
    public async unbindTagFromAV(avId: string): Promise<void> {
        const cleanAvId = avId.trim();
        const binding = this.bindings.get(cleanAvId);
        if (!binding) return;

        const syncMode = (settings.get("virtualAvSyncMode") as string) || "realtime";

        // 如果是延迟回写模式，在关闭投影时将 _dirty = 1 的所有修改统一回写到文档本体
        if (syncMode === "delayed") {
            try {
                const { db } = await getSqliteEngine();
                const dirtyRes = db.exec(`SELECT * FROM "${binding.tableName}" WHERE _dirty = 1;`);
                
                if (dirtyRes && dirtyRes.length > 0 && dirtyRes[0].values.length > 0) {
                    const columns = dirtyRes[0].columns;
                    const rows = dirtyRes[0].values;
                    const idIdx = columns.indexOf("id");
                    const batchAttrs: Array<{ id: string; attrs: Record<string, string> }> = [];

                    for (const row of rows) {
                        const blockId = String(row[idIdx]);
                        const attrs: Record<string, string> = {};

                        for (let c = 0; c < columns.length; c++) {
                            const col = columns[c];
                            if (col !== "id" && col !== "title" && !col.startsWith("_")) {
                                const val = row[c] !== null && row[c] !== undefined ? String(row[c]) : "";
                                attrs[`custom-${col}`] = val;
                            }
                        }
                        batchAttrs.push({ id: blockId, attrs });
                    }

                    try {
                        await post("/api/attr/batchSetBlockAttrs", { blockAttrs: batchAttrs });
                    } catch (batchErr) {
                        for (const item of batchAttrs) {
                            await post("/api/attr/setBlockAttrs", { id: item.id, attrs: item.attrs });
                        }
                    }

                    showMessage(`✓ 虚拟投影已关闭，已将 ${rows.length} 个修改的属性统一回写到文档本体。`, 4000);
                }
            } catch (flushErr) {
                console.error(`[SupertagAVProjector] 统一回写异常:`, flushErr);
            }
        }

        // 清理 SQLite 表
        try {
            const { db } = await getSqliteEngine();
            db.exec(`DROP TABLE IF EXISTS "${binding.tableName}";`);
        } catch (e) {}

        this.bindings.delete(cleanAvId);
        this.tagToAvMap.delete(binding.tagName);
        this.persistBindings();

        // 通知前端恢复为普通数据库视图
        this.notifyFrontendToRerender(cleanAvId, binding.blockId);
        if (syncMode === "realtime") {
            showMessage("✓ 已关闭虚拟投影，恢复为普通数据库视图");
        }
    }

    /**
     * 【从热 SQLite 表组装 IAV 协议 (含冷启动自愈能力)】
     */
    public async generateVirtualIAVFromSQLite(avId: string): Promise<any | null> {
        const binding = this.bindings.get(avId);
        if (!binding) return null;

        try {
            const { db } = await getSqliteEngine();

            // 检查表是否存在，若因重启导致内存表不存在则自动重构
            const tableCheck = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${binding.tableName}';`);
            if (!tableCheck || tableCheck.length === 0 || tableCheck[0].values.length === 0) {
                await this.initSQLiteTableForTag(binding.tagName, binding.tableName);
            }

            // 1. 查询热表所有行
            const res = db.exec(`SELECT * FROM "${binding.tableName}" ORDER BY _updated DESC;`);
            if (!res || res.length === 0) {
                // 表格为空时生成空 IAV 视图
                return this.buildEmptyIAV(avId, binding.tagName, binding.attrNames);
            }

            const columnsList = res[0].columns;
            const valuesList = res[0].values;

            // 2. 区分主键列与自定义属性列
            const attrCols = columnsList.filter((c: string) => c !== "id" && c !== "title" && !c.startsWith("_"));

            // 3. 构建列定义 (Columns)
            const avColumns: any[] = [];

            // 主键列
            const primaryColId = "col_primary_block";
            avColumns.push({
                id: primaryColId,
                name: "标题",
                type: "block",
                icon: "",
                width: "320px",
                hidden: false,
                wrapField: true
            });

            // 自定义属性列
            for (const attr of attrCols) {
                const colId = `col_${attr}`;
                
                // 从 SQLite 查询当前列的所有去重枚举值用于构建 select options
                const optRes = db.exec(`SELECT DISTINCT "${attr}" FROM "${binding.tableName}" WHERE "${attr}" IS NOT NULL AND "${attr}" != '';`);
                const options: Array<{ id: string; name: string; color: string }> = [];

                if (optRes && optRes.length > 0) {
                    optRes[0].values.forEach((valArr: any[], idx: number) => {
                        const optVal = String(valArr[0]);
                        options.push({
                            id: `opt_${attr}_${optVal}`,
                            name: optVal,
                            color: String((idx % 8) + 1)
                        });
                    });
                }

                const meta = getColumnMeta(binding.tagName, attr);
                let displayName = meta?.name || attr;
                if (attr === "status" || attr === "index-task") displayName = "状态";
                else if (attr === "priority") displayName = "优先级";
                else if (attr === "due" || attr === "due_date") displayName = "截止时间";
                else if (attr === "memo") displayName = "备注";

                avColumns.push({
                    id: colId,
                    name: displayName,
                    type: meta?.type || "select",
                    icon: "",
                    width: "160px",
                    hidden: false,
                    wrapField: false,
                    options
                });
            }

            // 4. 构建数据行 (Rows & Cells)
            const idIdx = columnsList.indexOf("id");
            const titleIdx = columnsList.indexOf("title");

            const avRows = valuesList.map((rowArr: any[]) => {
                const rowId = String(rowArr[idIdx]);
                const rowTitle = String(rowArr[titleIdx] || "未命名项");

                const cells: any[] = [];

                // 主键单元格
                cells.push({
                    id: `${rowId}_${primaryColId}`,
                    color: "",
                    bgColor: "",
                    valueType: "block",
                    value: {
                        id: `${rowId}_${primaryColId}`,
                        keyID: primaryColId,
                        blockID: rowId,
                        type: "block",
                        block: {
                            id: rowId,
                            content: rowTitle,
                            icon: ""
                        }
                    }
                });

                // 各属性单元格
                for (const attr of attrCols) {
                    const colId = `col_${attr}`;
                    const aIdx = columnsList.indexOf(attr);
                    const val = aIdx !== -1 && rowArr[aIdx] !== null && rowArr[aIdx] !== undefined ? String(rowArr[aIdx]) : "";

                    const selectItems = val ? [{
                        id: `opt_${attr}_${val}`,
                        content: val,
                        name: val,
                        color: "1"
                    }] : [];

                    cells.push({
                        id: `${rowId}_${colId}`,
                        color: "",
                        bgColor: "",
                        valueType: "select",
                        value: {
                            id: `${rowId}_${colId}`,
                            keyID: colId,
                            blockID: rowId,
                            type: "select",
                            mSelect: selectItems
                        }
                    });
                }

                return {
                    id: rowId,
                    cells
                };
            });

            // 5. 组装标准 IAV 数据对象
            const viewId = "view_sql_table";
            const cleanTagName = (binding.tagName || "").replace(/^#/, "").toLowerCase();
            const tableData = {
                id: avId,
                name: `supertag-${cleanTagName}`,
                viewID: viewId,
                viewType: "table",
                views: [
                    {
                        id: viewId,
                        name: "表格",
                        type: "table",
                        icon: "iconTable",
                        hideAttrViewName: false,
                        pageSize: 50,
                        showIcon: true,
                        wrapField: false,
                        filters: [],
                        sorts: [],
                        groups: []
                    }
                ],
                view: {
                    id: viewId,
                    name: "表格",
                    type: "table",
                    icon: "iconTable",
                    hideAttrViewName: false,
                    pageSize: 50,
                    showIcon: true,
                    wrapField: false,
                    columns: avColumns,
                    rows: avRows,
                    rowCount: avRows.length,
                    filters: [],
                    sorts: [],
                    groups: []
                }
            };

            return tableData;
        } catch (err) {
            console.error(`[SupertagAVProjector] generateVirtualIAVFromSQLite 异常:`, err);
            return null;
        }
    }

    private buildEmptyIAV(avId: string, tagName: string, attrNames: string[]) {
        const viewId = "view_sql_table";
        const primaryColId = "col_primary_block";
        const avColumns: any[] = [{
            id: primaryColId,
            name: "标题",
            type: "block",
            icon: "",
            width: "320px",
            hidden: false,
            wrapField: true
        }];

        for (const attr of attrNames) {
            const colId = `col_${attr}`;
            const meta = getColumnMeta(tagName, attr);
            let displayName = meta?.name || attr;
            if (attr === "status" || attr === "index-task") displayName = "状态";
            else if (attr === "priority") displayName = "优先级";
            else if (attr === "due" || attr === "due_date") displayName = "截止时间";
            else if (attr === "memo") displayName = "备注";

            avColumns.push({
                id: colId,
                name: displayName,
                type: meta?.type || "select",
                icon: "",
                width: "160px",
                hidden: false,
                wrapField: false,
                options: []
            });
        }

        const cleanTagName = (tagName || "").replace(/^#/, "").toLowerCase();
        return {
            id: avId,
            name: `supertag-${cleanTagName}`,
            viewID: viewId,
            viewType: "table",
            views: [{
                id: viewId,
                name: "表格",
                type: "table",
                icon: "iconTable",
                hideAttrViewName: false,
                pageSize: 50,
                showIcon: true,
                wrapField: false,
                filters: [],
                sorts: [],
                groups: []
            }],
            view: {
                id: viewId,
                name: "表格",
                type: "table",
                icon: "iconTable",
                hideAttrViewName: false,
                pageSize: 50,
                showIcon: true,
                wrapField: false,
                columns: avColumns,
                rows: [],
                rowCount: 0,
                filters: [],
                sorts: [],
                groups: []
            }
        };
    }

    /**
     * 【反向编辑回写】在 SQLite 中执行 SQL UPDATE，并根据设置判断是否即时回写块属性
     */
    public async handleAVCellUpdate(operation: any): Promise<void> {
        if (!operation || this.isSyncing) return;
        const avId = operation.avID || operation.avId;
        const keyId = operation.keyID || operation.keyId;
        const blockId = operation.rowID || operation.itemID || operation.rowId;
        const rawData = operation.data !== undefined ? operation.data : operation.value;

        const binding = this.bindings.get(avId);
        if (!binding || !keyId || !blockId) return;

        try {
            this.isSyncing = true;
            const cleanAttrName = keyId.replace(/^col_/, "");
            if (cleanAttrName === "primary_block") {
                this.isSyncing = false;
                return;
            }

            const cleanValue = this.extractCleanValue(rawData);
            const { db } = await getSqliteEngine();

            // 1. 在 SQLite 热表中执行 SQL UPDATE
            const updateSql = `UPDATE "${binding.tableName}" SET "${cleanAttrName}" = ?, _dirty = 1, _updated = ? WHERE id = ?;`;
            db.run(updateSql, [cleanValue, Date.now(), blockId]);

            // 2. 根据设置判断是否即时写回物理 Markdown 属性
            const syncMode = (settings.get("virtualAvSyncMode") as string) || "realtime";
            if (syncMode === "realtime") {
                const tag = binding.tagName;
                const attrKey = `custom-${tag}-${cleanAttrName}`;
                await post("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: {
                        [attrKey]: cleanValue
                    }
                });
            }

            // 3. 通知 Protyle 刷新表格显示
            setTimeout(() => {
                this.notifyFrontendToRerender(avId);
                this.isSyncing = false;
            }, 100);
        } catch (e) {
            console.error(`[SupertagAVProjector] handleAVCellUpdate 异常:`, e);
            this.isSyncing = false;
        }
    }

    /**
     * 通知当前前端编辑器即时重绘指定 AV 块 (无需手动刷新页面)
     */
    public notifyFrontendToRerender(avId: string, blockId?: string) {
        const cleanAvId = avId.trim();

        // 1. 精准遍历所有活动 Tab 与 Protyle 实例
        try {
            const editors = this.getAllActiveEditors();

            for (const ed of editors) {
                try {
                    const protyle = ed?.protyle || ed;
                    const wysiwygEl = protyle?.wysiwyg?.element || protyle?.element;
                    if (wysiwygEl) {
                        const avNodes = wysiwygEl.querySelectorAll(`div[data-type="NodeAttributeView"], .av[data-av-id="${cleanAvId}"]`);
                        avNodes.forEach((node: HTMLElement) => {
                            node.removeAttribute("data-render");
                            node.removeAttribute("data-rendering");
                        });
                    }

                    // ⚡ 直接向该 Protyle 的内置 WebSocket 模型派发原生 refreshAttributeView 事件
                    if (protyle?.ws?.ws) {
                        const msgPayload = JSON.stringify({
                            cmd: "refreshAttributeView",
                            data: { id: cleanAvId }
                        });
                        protyle.ws.ws.dispatchEvent(new MessageEvent("message", { data: msgPayload }));
                    }

                    if (typeof ed?.reload === "function") {
                        ed.reload(false);
                    } else if (typeof protyle?.reload === "function") {
                        protyle.reload(false);
                    }
                } catch (err) {
                    console.warn(`[SupertagAVProjector] 单个编辑器刷新异常:`, err);
                }
            }

            // 兜底检测全局 activeProtyleInstance
            const globalProtyle = (window as any).activeProtyleInstance;
            if (globalProtyle && !editors.includes(globalProtyle)) {
                try {
                    const wysiwygEl = globalProtyle?.wysiwyg?.element || globalProtyle?.element;
                    if (wysiwygEl) {
                        const avNodes = wysiwygEl.querySelectorAll(`div[data-type="NodeAttributeView"], .av[data-av-id="${cleanAvId}"]`);
                        avNodes.forEach((node: HTMLElement) => {
                            node.removeAttribute("data-render");
                            node.removeAttribute("data-rendering");
                        });
                    }
                    if (typeof globalProtyle.reload === "function") {
                        globalProtyle.reload(false);
                    }
                } catch (_) {}
            }
        } catch (layoutErr) {
            console.warn(`⚠️ [SupertagAVProjector] Layout 遍历触发异常:`, layoutErr);
        }

        // 2. 补充派发全局原生 WebSocket 广播事件
        try {
            const msgPayload = JSON.stringify({
                cmd: "refreshAttributeView",
                data: { id: cleanAvId }
            });

            const siyuanWs = (window as any).siyuan?.ws?.ws;
            if (siyuanWs) {
                siyuanWs.dispatchEvent(new MessageEvent("message", { data: msgPayload }));
            }
        } catch (_) {}

        // 3. 全局 DOM 补齐标记清理与轻量级 resize 事件广播
        try {
            const els = document.querySelectorAll(`div[data-type="NodeAttributeView"], .av`);
            els.forEach((el: any) => {
                const curAvId = el.getAttribute("data-av-id") || el.querySelector(".av")?.getAttribute("data-av-id") || el.getAttribute("data-node-id");
                if (curAvId === cleanAvId || (blockId && el.getAttribute("data-node-id") === blockId)) {
                    el.removeAttribute("data-render");
                    el.removeAttribute("data-rendering");
                }
            });
            window.dispatchEvent(new Event("resize"));
        } catch (_) {}

        // 4. 异步刷新切换按钮状态
        setTimeout(async () => {
            try {
                const { avProjectionToggle } = await import("./av-projection-toggle");
                avProjectionToggle.scanAndMountToggles();
            } catch (_) {}
        }, 50);
    }

    /**
     * 按照思源原生 getAllModels() 机制递归遍历所有挂载的活动 Protyle 编辑器实例
     */
    private getAllActiveEditors(): any[] {
        const editors: any[] = [];
        try {
            const siyuan = (window as any).siyuan;
            if (!siyuan) return editors;

            // 1. 遍历 Tab 树形布局 (window.siyuan.layout.layout)
            const getTabs = (layout: any) => {
                if (!layout || !layout.children) return;
                for (let i = 0; i < layout.children.length; i++) {
                    const item = layout.children[i];
                    if (item && item.model) {
                        if (item.model.editor) {
                            editors.push(item.model.editor);
                        }
                        if (item.model.editors?.edit) {
                            editors.push(item.model.editors.edit);
                        }
                    } else if (item) {
                        getTabs(item);
                    }
                }
            };

            if (siyuan.layout?.layout) {
                getTabs(siyuan.layout.layout);
            }

            // 2. 遍历浮动弹窗与面板 (dialogs & blockPanels)
            if (Array.isArray(siyuan.dialogs)) {
                siyuan.dialogs.forEach((d: any) => {
                    if (d.editors) {
                        Object.values(d.editors).forEach((e: any) => {
                            if (e) editors.push(e);
                        });
                    }
                });
            }

            if (Array.isArray(siyuan.blockPanels)) {
                siyuan.blockPanels.forEach((bp: any) => {
                    if (Array.isArray(bp.editors)) {
                        bp.editors.forEach((e: any) => {
                            if (e) editors.push(e);
                        });
                    }
                });
            }

            // 3. 移动端支持
            if (siyuan.mobile?.editor) {
                editors.push(siyuan.mobile.editor);
            }
            if (siyuan.mobile?.popEditor) {
                editors.push(siyuan.mobile.popEditor);
            }
        } catch (e) {
            console.warn("[SupertagAVProjector] getAllActiveEditors 异常:", e);
        }
        return editors;
    }

    private parseIALString(ial: string): Record<string, string> {
        const result: Record<string, string> = {};
        if (!ial) return result;
        const regex = /([\w\-]+)="((?:\\.|[^"\\])*)"/g;
        let match;
        while ((match = regex.exec(ial)) !== null) {
            const key = match[1];
            let val = match[2];
            val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            result[key] = val;
        }
        return result;
    }

    private extractCleanValue(data: any): string {
        if (data === null || data === undefined) return "";
        if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
            return String(data);
        }
        if (data.text?.content !== undefined) return String(data.text.content);
        if (Array.isArray(data.mSelect) && data.mSelect.length > 0) {
            return data.mSelect[0].name || data.mSelect[0].content || "";
        }
        if (data.select?.name) return data.select.name;
        if (data.checkbox?.checked !== undefined) return data.checkbox.checked ? "true" : "false";
        return JSON.stringify(data);
    }

    private persistBindings() {
        try {
            const obj: Record<string, VirtualAVBinding> = {};
            for (const [k, v] of this.bindings.entries()) {
                obj[k] = v;
            }
            localStorage.setItem("indexos_virtual_av_sql_bindings", JSON.stringify(obj));

            const modesObj: Record<string, boolean> = {};
            for (const [k, v] of this.projectionModes.entries()) {
                modesObj[k] = v;
            }
            localStorage.setItem("indexos_av_projection_modes", JSON.stringify(modesObj));
        } catch (e) {}
    }

    private loadPersistedBindings() {
        try {
            const raw = localStorage.getItem("indexos_virtual_av_sql_bindings");
            if (raw) {
                const obj = JSON.parse(raw);
                for (const [k, v] of Object.entries(obj)) {
                    this.bindings.set(k, v as VirtualAVBinding);
                    this.tagToAvMap.set((v as VirtualAVBinding).tagName, k);
                }
            }

            const rawModes = localStorage.getItem("indexos_av_projection_modes");
            if (rawModes) {
                const modesObj = JSON.parse(rawModes);
                for (const [k, v] of Object.entries(modesObj)) {
                    this.projectionModes.set(k, Boolean(v));
                }
            }
        } catch (e) {}
    }
}

export const supertagAVProjector = SupertagAVProjector.getInstance();
