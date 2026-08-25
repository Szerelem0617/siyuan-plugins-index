/**
 * fetch-interceptor.ts
 *
 * 网络与事务拦截网关
 * 负责 Hook window.fetch，拦截 /api/av/renderAttributeView (从热 SQLite 表合成虚拟 IAV) 与 /api/transactions (拦截虚拟表操作防后端报错)
 */

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
                        if ((op.action === "updateAttrViewCell" || op.action === "updateAttrViewCells" || op.action === "setAttrViewCell") && handler.isVirtualProjection(op.avID)) {
                            hasVirtualAvOp = true;
                            await handler.handleAVCellUpdate(op);
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
