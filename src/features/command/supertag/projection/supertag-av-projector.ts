/**
 * supertag-av-projector.ts
 *
 * Supertag ➔ 思源原生 AV (Attribute View) 纯内存虚拟动态投影引擎 (Approach A)
 *
 * 核心能力：
 * 1. 【0 磁盘物理双存】通过 Hook 拦截前端 /api/av/renderAttributeView 请求，直接由 SQLite 内存生成标准的 IAV 结构体返回给前端。
 * 2. 【事务拦截防报错】拦截 /api/transactions 中的 updateAttrViewCell 事务，在内存中直接回写物理块 custom-* 属性，避免 Go 后端因找不到虚拟表抛出“操作失败”。
 * 3. 【就地即时渲染】建立/关闭绑定时，自动向前端派发轻量虚拟事务通知，无需重启思源即可在当前视口即时渲染/卸载。
 * 4. 【开闭状态自适应】支持一键开启/关闭虚拟投影，动态切换菜单状态。
 */

import { post } from "../../../../shared/api-client/request";
import { showMessage } from "siyuan";

export class SupertagAVProjector {
    private static instance: SupertagAVProjector | null = null;
    /** 记录虚拟投影绑定关系: avId -> tagName */
    private avToTagMap = new Map<string, string>();
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

                // 1. 拦截 AV 渲染请求 -> 纯内存组装虚拟 IAV
                if (url.includes("/api/av/renderAttributeView")) {
                    let reqBody: any = null;
                    if (typeof init?.body === "string") {
                        reqBody = JSON.parse(init.body);
                    } else if (init?.body && typeof init.body === "object") {
                        reqBody = init.body;
                    }

                    const avId = reqBody?.id || reqBody?.avID;
                    if (avId && self.isVirtualProjection(avId)) {
                        console.log(`⚡ [SupertagAVProjector] 拦截到虚拟 AV 渲染请求: ${avId}`);
                        const virtualData = await self.generateVirtualIAV(avId);
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

                // 2. 拦截虚拟 AV 的单元格编辑事务 -> 直接在前端完成回写并返回成功，防止 Go 后端报错“操作失败”
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
                        // 拦截成功，返回合成成功的事务响应，阻止后端报错
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

        console.log(`🚀 [SupertagAVProjector] Fetch 渲染拦截网关已就绪 (虚拟视图 + 事务拦截防报错)`);
    }

    /**
     * 绑定 Supertag ➔ 指定的 AV 数据库块
     */
    public bindTagToAV(tagName: string, avId: string) {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const cleanAvId = avId.trim();
        this.avToTagMap.set(cleanAvId, cleanTag);
        this.tagToAvMap.set(cleanTag, cleanAvId);
        this.persistBindings();
        console.log(`[SupertagAVProjector] 🔗 成功建立虚拟投影绑定: AV(${cleanAvId}) ➔ #${cleanTag}`);
    }

    /**
     * 关闭/解绑虚拟投影
     */
    public unbindTagFromAV(avId: string) {
        const cleanAvId = avId.trim();
        const tag = this.avToTagMap.get(cleanAvId);
        this.avToTagMap.delete(cleanAvId);
        if (tag) {
            this.tagToAvMap.delete(tag);
        }
        this.persistBindings();
        this.notifyFrontendToRerender(cleanAvId);
        console.log(`[SupertagAVProjector] 🛑 已关闭虚拟投影绑定: AV(${cleanAvId})`);
    }

    public isVirtualProjection(avId: string): boolean {
        return this.avToTagMap.has(avId.trim());
    }

    public getBoundTag(avId: string): string | undefined {
        return this.avToTagMap.get(avId.trim());
    }

    /**
     * 触发对指定 AV 数据库的 Supertag 虚拟投影
     */
    public async projectSupertagToAV(tagName: string, avId: string, blockId?: string): Promise<{ success: boolean; rowCount: number; message?: string }> {
        const cleanTag = tagName.replace(/^#/, "").trim();
        const cleanAvId = avId.trim();
        this.bindTagToAV(cleanTag, cleanAvId);

        // 即刻通知前端所有打开的 Protyle 视图重新渲染该 AV 块
        this.notifyFrontendToRerender(cleanAvId, blockId);

        // 查询当前挂载数作为反馈
        const countRes = await post("/api/query/sql", {
            stmt: `SELECT count(1) as total FROM blocks WHERE ial LIKE '%${cleanTag}%'`
        });
        const total = (Array.isArray(countRes) ? countRes[0]?.total : countRes?.data?.[0]?.total) || 0;

        return { success: true, rowCount: total };
    }

    /**
     * 通知当前前端编辑器即时重绘指定 AV 块 (无需重启思源)
     */
    public notifyFrontendToRerender(avId: string, blockId?: string) {
        // 1. 派发 WebSocket 事务模拟事件，唤醒所有 open Protyle 内部的 refreshAV
        try {
            window.dispatchEvent(new CustomEvent("ws-main", {
                detail: {
                    cmd: "transactions",
                    data: [{
                        doOperations: [{
                            action: "updateAttrView",
                            avID: avId,
                            id: blockId || ""
                        }]
                    }]
                }
            }));
        } catch (e) {}

        // 2. 清理 DOM 上的旧缓存容器，促使 Protyle 重新发起 fetchSyncPost
        try {
            const els = document.querySelectorAll(`div[data-type="NodeAttributeView"]`);
            els.forEach((el: any) => {
                const curAvId = el.getAttribute("data-av-id") || el.querySelector(".av")?.getAttribute("data-av-id");
                if (curAvId === avId || (blockId && el.getAttribute("data-node-id") === blockId)) {
                    const container = el.querySelector(".av__container");
                    if (container) {
                        container.remove();
                    }
                    el.removeAttribute("data-render");
                }
            });
        } catch (e) {}
    }

    /**
     * 【核心纯内存生成器】从 SQLite 动态组装前端渲染所需的 IAV 结构体
     */
    public async generateVirtualIAV(avId: string): Promise<any | null> {
        const tagName = this.avToTagMap.get(avId);
        if (!tagName) return null;

        console.group(`✨ [SupertagAVProjector] 纯内存组装虚拟 IAV 视图: #${tagName}`);

        // 1. 从 SQLite 查询所有实体块
        const sqlRes = await post("/api/query/sql", {
            stmt: `SELECT id, root_id, content, ial, updated, created FROM blocks WHERE ial LIKE '%${tagName}%' ORDER BY updated DESC LIMIT 500`
        });
        const rows: any[] = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
        console.log(`📋 找到 ${rows.length} 个实体块`);

        // 2. 收集解析所有的属性名，动态推导列
        const attrKeysSet = new Set<string>();
        const parsedRows: Array<{ id: string; content: string; attrs: Record<string, string> }> = [];

        for (const row of rows) {
            const attrs = this.parseIALString(row.ial || "");
            parsedRows.push({
                id: row.id,
                content: row.content || "未命名项",
                attrs
            });

            for (const k of Object.keys(attrs)) {
                if (k.startsWith("custom-") && k !== "custom-supertags" && k !== "custom-index-tags") {
                    attrKeysSet.add(k.replace(/^custom-/, ""));
                } else if (["status", "priority", "due", "memo", "bookmark"].includes(k)) {
                    attrKeysSet.add(k);
                }
            }
        }

        // 如果没有其他属性，默认放一个 status 状态列
        if (attrKeysSet.size === 0) {
            attrKeysSet.add("status");
        }

        // 3. 构建列定义 (Columns)
        const columns: any[] = [];

        // 首列：主键 (Block)
        const primaryColId = "col_primary_block";
        columns.push({
            id: primaryColId,
            name: "标题",
            type: "block",
            icon: "",
            width: "320px",
            hidden: false,
            wrapField: true
        });

        // 收集各属性列的所有候选值，用于为 select 生成 options
        for (const attrName of attrKeysSet) {
            const colId = `col_${attrName}`;
            const optSet = new Set<string>();

            for (const r of parsedRows) {
                const val = r.attrs[`custom-${attrName}`] || r.attrs[attrName];
                if (val) optSet.add(val);
            }

            const options = Array.from(optSet).map((optName, idx) => ({
                id: `opt_${attrName}_${optName}`,
                name: optName,
                color: String((idx % 8) + 1)
            }));

            // 属性列名中英文映射
            let displayName = attrName;
            if (attrName === "status" || attrName === "index-task") displayName = "状态";
            else if (attrName === "priority") displayName = "优先级";
            else if (attrName === "due" || attrName === "due_date") displayName = "截止时间";
            else if (attrName === "memo") displayName = "备注";

            columns.push({
                id: colId,
                name: displayName,
                type: "select",
                icon: "",
                width: "160px",
                hidden: false,
                wrapField: false,
                options: options
            });
        }

        // 4. 构建数据行与单元格 (Rows & Cells)
        const avRows: any[] = [];

        for (const r of parsedRows) {
            const cells: any[] = [];

            // 主键单元格 (必须包含 keyID 且与 columns[0].id 一致)
            cells.push({
                id: `${r.id}_${primaryColId}`,
                color: "",
                bgColor: "",
                valueType: "block",
                value: {
                    id: `${r.id}_${primaryColId}`,
                    keyID: primaryColId,
                    blockID: r.id,
                    type: "block",
                    block: {
                        id: r.id,
                        content: r.content,
                        icon: ""
                    }
                }
            });

            // 属性单元格
            for (const attrName of attrKeysSet) {
                const colId = `col_${attrName}`;
                const val = r.attrs[`custom-${attrName}`] || r.attrs[attrName] || "";

                const selectItem = val ? [{
                    id: `opt_${attrName}_${val}`,
                    content: val,
                    name: val,
                    color: "1"
                }] : [];

                cells.push({
                    id: `${r.id}_${colId}`,
                    color: "",
                    bgColor: "",
                    valueType: "select",
                    value: {
                        id: `${r.id}_${colId}`,
                        keyID: colId,
                        blockID: r.id,
                        type: "select",
                        mSelect: selectItem
                    }
                });
            }

            avRows.push({
                id: r.id,
                cells: cells
            });
        }

        // 5. 组装标准 IAV 数据载荷
        const viewId = "view_virtual_table";
        const tableData = {
            id: avId,
            name: `Supertag 投影: #${tagName}`,
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
                columns: columns,
                rows: avRows,
                rowCount: avRows.length,
                filters: [],
                sorts: [],
                groups: []
            }
        };

        console.log(`✅ [SupertagAVProjector] 成功生成虚拟 IAV: ${avRows.length} 行, ${columns.length} 列`);
        console.groupEnd();

        return tableData;
    }

    /**
     * 【反向回写】处理用户在前端编辑单元格时的事务回写
     */
    public async handleAVCellUpdate(operation: any): Promise<void> {
        if (!operation || this.isSyncing) return;
        const avId = operation.avID || operation.avId;
        const keyId = operation.keyID || operation.keyId;
        const blockId = operation.rowID || operation.itemID || operation.rowId;
        const rawData = operation.data !== undefined ? operation.data : operation.value;

        if (!avId || !keyId || !blockId || !this.isVirtualProjection(avId)) return;

        try {
            this.isSyncing = true;
            // 从 keyId (如 "col_status") 提取出实际属性名 "status"
            const cleanAttrName = keyId.replace(/^col_/, "");
            if (cleanAttrName === "primary_block") {
                this.isSyncing = false;
                return;
            }

            const cleanValue = this.extractCleanValue(rawData);
            const attrKey = `custom-${cleanAttrName}`;

            console.log(`🔄 [SupertagAVProjector] 捕获虚拟 AV 编辑: 实体(${blockId}) ➔ ${attrKey} = "${cleanValue}"`);

            await post("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: {
                    [attrKey]: cleanValue
                }
            });

            // 触发通知 Protyle 重新拉取虚拟视图
            setTimeout(() => {
                this.notifyFrontendToRerender(avId);
                this.isSyncing = false;
            }, 100);
        } catch (e) {
            console.error(`[SupertagAVProjector] 反向回写失败:`, e);
            this.isSyncing = false;
        }
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
            const obj: Record<string, string> = {};
            for (const [k, v] of this.avToTagMap.entries()) {
                obj[k] = v;
            }
            localStorage.setItem("indexos_virtual_av_bindings", JSON.stringify(obj));
        } catch (e) {}
    }

    private loadPersistedBindings() {
        try {
            const raw = localStorage.getItem("indexos_virtual_av_bindings");
            if (raw) {
                const obj = JSON.parse(raw);
                for (const [k, v] of Object.entries(obj)) {
                    this.avToTagMap.set(k, String(v));
                    this.tagToAvMap.set(String(v), k);
                }
            }
        } catch (e) {}
    }
}

export const supertagAVProjector = SupertagAVProjector.getInstance();
