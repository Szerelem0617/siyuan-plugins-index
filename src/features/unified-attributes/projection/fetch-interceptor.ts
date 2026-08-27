import { showMessage } from "siyuan";

export interface FetchInterceptorHandler {
    isVirtualProjection: (avId: string) => boolean;
    generateVirtualIAVFromSQLite: (avId: string) => Promise<any | null>;
    handleAVCellUpdate: (operation: any) => Promise<void>;
}

let isHookInstalled = false;

/**
 * 安装 window.fetch 拦截器网关
 */
export function installFetchInterceptor(handler: FetchInterceptorHandler) {
    if (isHookInstalled || typeof window === "undefined") return;
    isHookInstalled = true;

    const originalFetch = window.fetch;

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
                const isVirtual = avId ? handler.isVirtualProjection(avId) : false;

                if (avId && isVirtual) {
                    const virtualData = await handler.generateVirtualIAVFromSQLite(avId);
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

            // 2. 拦截虚拟 AV 的操作事务 (单元格编辑写回 + 实体强绑定防穿透保护)
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
                        if (op.avID && handler.isVirtualProjection(op.avID)) {
                            hasVirtualAvOp = true;
                            if (op.action === "updateAttrViewCell" || op.action === "updateAttrViewCells" || op.action === "setAttrViewCell") {
                                await handler.handleAVCellUpdate(op);
                            } else if (op.action?.includes("Item") || op.action?.includes("Block") || op.action?.includes("Row") || op.action?.includes("Col")) {
                                showMessage("🏷️ 当前为 Supertag 虚拟投影视图，为笔记块打上标签即可自动呈现在此；如需管理物理结构，请切换至原生物理数据视图", 4000, "info");
                            }
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
            console.error(`[FetchInterceptor] 拦截请求处理异常:`, err);
        }

        return originalFetch.apply(this, arguments as any);
    };

    console.log(`🚀 [FetchInterceptor] 热 SQLite 拦截网关已就绪 (SQL驱动 + 零磁盘双存)`);
}
