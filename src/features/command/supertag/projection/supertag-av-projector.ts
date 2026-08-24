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

import { post } from "../../../../shared/api-client/request";
import { getSqliteEngine } from "../../../sqlite/sqlite-manager";
import { settings } from "../../../../core/settings";
import { showMessage } from "siyuan";

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
                        reqBody = JSON.parse(init.body);
                    } else if (init?.body && typeof init.body === "object") {
                        reqBody = init.body;
                    }

                    const avId = reqBody?.id || reqBody?.avID;
                    if (avId && self.isVirtualProjection(avId)) {
                        const virtualData = await self.generateVirtualIAVFromSQLite(avId);
                        if (virtualData) {
                            return new Response(JSON.stringify({
                                code: 0,
                                msg: "",
                                data: virtualData
                            }), {
                                status: 200,
                                headers: { "Content-Type": "application/json" }
                            });
                        }
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
        return this.bindings.has(avId.trim());
    }

    public getBoundTag(avId: string): string | undefined {
        return this.bindings.get(avId.trim())?.tagName;
    }

    public getBinding(avId: string): VirtualAVBinding | undefined {
        return this.bindings.get(avId.trim());
    }

    /**
     * 触发对指定 AV 数据库的 Supertag 虚拟投影，并在 SQLite 中初始化热表
     */
    public async projectSupertagToAV(tagName: string, avId: string, blockId?: string): Promise<{ success: boolean; rowCount: number; message?: string }> {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const cleanAvId = avId.trim();
        const tableName = "proj_" + cleanAvId.replace(/[^a-zA-Z0-9_]/g, "_");

        const initRes = await this.initSQLiteTableForTag(cleanTag, tableName);
        if (!initRes.success) {
            return { success: false, rowCount: 0, message: initRes.message };
        }

        // 记录绑定信息
        const binding: VirtualAVBinding = {
            tagName: cleanTag,
            tableName,
            attrNames: initRes.attrNames,
            blockId,
            createdAt: Date.now()
        };
        this.bindings.set(cleanAvId, binding);
        this.tagToAvMap.set(cleanTag, cleanAvId);
        this.persistBindings();

        console.log(`🔗 虚拟投影已成功建立: AV(${cleanAvId}) ➔ #${cleanTag} (表 ${tableName}, ${initRes.rowCount} 行)`);

        // 即刻通知前端编辑器重新拉取数据就地重绘
        this.notifyFrontendToRerender(cleanAvId, blockId);

        return { success: true, rowCount: initRes.rowCount };
    }

    /**
     * 在内存 SQLite 引擎中动态构建并填充指定 Supertag 的热表
     */
    public async initSQLiteTableForTag(cleanTag: string, tableName: string): Promise<{ success: boolean; rowCount: number; attrNames: string[]; message?: string }> {
        try {
            // 1. 从思源主 SQLite 查询挂载该 Supertag 的所有块实体
            const sqlRes = await post("/api/query/sql", {
                stmt: `SELECT id, root_id, content, ial, updated, created FROM blocks WHERE ial LIKE '%${cleanTag}%' ORDER BY updated DESC LIMIT 500`
            });
            const rows: any[] = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);

            // 2. 收集解析所有的属性名
            const attrKeysSet = new Set<string>();
            const parsedRows: Array<{ id: string; content: string; root_id: string; updated: number; attrs: Record<string, string> }> = [];

            for (const row of rows) {
                const attrs = this.parseIALString(row.ial || "");
                parsedRows.push({
                    id: row.id,
                    content: row.content || "未命名项",
                    root_id: row.root_id || "",
                    updated: parseInt(row.updated || "0") || Date.now(),
                    attrs
                });

                for (const k of Object.keys(attrs)) {
                    if (k.startsWith("custom-") && k !== "custom-supertags" && k !== "custom-index-tags") {
                        const rawClean = k.replace(/^custom-/, "");
                        if (rawClean.startsWith(`${cleanTag}.`)) {
                            attrKeysSet.add(rawClean.replace(`${cleanTag}.`, ""));
                        } else if (rawClean.startsWith(`${cleanTag}_`)) {
                            attrKeysSet.add(rawClean.replace(`${cleanTag}_`, ""));
                        } else if (rawClean.startsWith(`${cleanTag}-`)) {
                            attrKeysSet.add(rawClean.replace(`${cleanTag}-`, ""));
                        } else if (!rawClean.includes(".") && !rawClean.includes("_") && !rawClean.includes("-")) {
                            // 全局共享列
                            attrKeysSet.add(rawClean);
                        }
                    } else if (["status", "priority", "due", "memo", "bookmark"].includes(k)) {
                        attrKeysSet.add(k);
                    }
                }
            }

            if (attrKeysSet.size === 0) {
                attrKeysSet.add("status");
            }

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
                                   r.attrs[`custom-${cleanTag}.${a}`] ||
                                   r.attrs[`custom-${cleanTag}_${a}`] ||
                                   r.attrs[`custom-${a}`] ||
                                   r.attrs[a] ||
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
                return null;
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

                let displayName = attr;
                if (attr === "status" || attr === "index-task") displayName = "状态";
                else if (attr === "priority") displayName = "优先级";
                else if (attr === "due" || attr === "due_date") displayName = "截止时间";
                else if (attr === "memo") displayName = "备注";

                avColumns.push({
                    id: colId,
                    name: displayName,
                    type: "select",
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
            const tableData = {
                id: avId,
                name: `Supertag 投影: #${binding.tagName}`,
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
        console.group(`🔄 [SupertagAVProjector] 触发即时重绘流水线: AV(${cleanAvId})`);

        let reloadedTabCount = 0;

        // 1. 精准遍历所有活动 Tab，直接调用官方 Protyle 的 reload(false) 就地无缝刷新
        try {
            const editors = this.getAllActiveEditors();
            console.log(`🎯 [SupertagAVProjector] 全局共探测到 ${editors.length} 个活动编辑器实例`);

            for (const ed of editors) {
                try {
                    const wysiwygEl = ed.protyle?.wysiwyg?.element;
                    if (wysiwygEl) {
                        wysiwygEl.querySelectorAll(`div[data-type="NodeAttributeView"]`).forEach((node: HTMLElement) => {
                            node.removeAttribute("data-render");
                            node.removeAttribute("data-rendering");
                        });
                    }

                    if (typeof ed.reload === "function") {
                        console.log(`🔄 [SupertagAVProjector] 正在就地刷新编辑器: rootID=${ed.protyle?.block?.rootID || "unknown"}`);
                        ed.reload(false);
                        reloadedTabCount++;
                    }
                } catch (err) {
                    console.warn(`[SupertagAVProjector] 单个编辑器刷新异常:`, err);
                }
            }
        } catch (layoutErr) {
            console.warn(`⚠️ [SupertagAVProjector] Layout 遍历触发异常:`, layoutErr);
        }

        // 2. 补充派发原生 refreshAttributeView 广播事件
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
            const els = document.querySelectorAll(`div[data-type="NodeAttributeView"]`);
            els.forEach((el: any) => {
                const curAvId = el.getAttribute("data-av-id") || el.querySelector(".av")?.getAttribute("data-av-id");
                if (curAvId === cleanAvId || (blockId && el.getAttribute("data-node-id") === blockId)) {
                    el.removeAttribute("data-render");
                    el.removeAttribute("data-rendering");
                }
            });
            window.dispatchEvent(new Event("resize"));
        } catch (_) {}

        console.log(`✅ [SupertagAVProjector] 重绘流水线执行完毕 (成功刷新 ${reloadedTabCount} 个活动编辑器 Tab)`);
        console.groupEnd();
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
        const regex = /([\w\-]+)="([^"]*)"/g;
        let match;
        while ((match = regex.exec(ial)) !== null) {
            result[match[1]] = match[2];
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
        } catch (e) {}
    }
}

export const supertagAVProjector = SupertagAVProjector.getInstance();
