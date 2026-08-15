import { showMessage } from "siyuan";
import { post } from "../../../shared/api-client/request";
import type { CommandContext, DispatchResult } from "../dispatcher";

function getIpcRenderer(): any {
    try {
        if ((window as any)?.ipcRenderer) return (window as any).ipcRenderer;
        if ((window as any)?.siyuan?.ipcRenderer) return (window as any).siyuan.ipcRenderer;
        const nodeRequire = (window as any)?.["require"] || (globalThis as any)?.["require"];
        if (typeof nodeRequire === "function") {
            const electron = nodeRequire("electron");
            if (electron?.ipcRenderer) return electron.ipcRenderer;
            if (electron?.send) return electron;
        }
    } catch (_) {}
    return null;
}

function sendMobileNotification(title: string, body: string): boolean {
    try {
        const w = window as any;
        if (w?.JSAndroid?.sendNotification) {
            w.JSAndroid.sendNotification("SiYuan Notifications", title, body, 0);
            return true;
        }
        if (w?.JSHarmony?.sendNotification) {
            w.JSHarmony.sendNotification("SiYuan Notifications", title, body, 0);
            return true;
        }
        if (w?.webkit?.messageHandlers?.sendNotification?.postMessage) {
            w.webkit.messageHandlers.sendNotification.postMessage({ title, body, delay: 0 });
            return true;
        }
    } catch (_) {}
    return false;
}

// 维护当前处于活跃展示期的消息内容集合，实现优雅的内容防刷去重
const g_activeMessages = new Set<string>();

export async function triggerShowMessage(
    params: {
        message?: string;
        preventDuplicate?: boolean | string;
        channel?: "auto" | "toast" | "system" | string;
        enableLog?: boolean | string;
        timeout?: number | string;
    },
    _context?: CommandContext
): Promise<DispatchResult> {
    const rawMsg = params?.message !== undefined && String(params.message).trim() !== ""
        ? String(params.message)
        : "IndexOS 消息通知";
    const channel = String(params?.channel || "auto").toLowerCase();
    const enableLog = params?.enableLog !== false && String(params?.enableLog) !== "false";
    const timeout = params?.timeout !== undefined && params?.timeout !== "" ? Number(params.timeout) : 6000;
    const preventDuplicate = params?.preventDuplicate === true || String(params?.preventDuplicate) === "true";

    // 1. 防重复提示拦截（若开启 preventDuplicate 且相同内容正在展示，则直接静默跳过）
    if (preventDuplicate && g_activeMessages.has(rawMsg)) {
        if (enableLog) {
            console.info(`[IndexOS Notification][deduplicated]`, rawMsg);
        }
        return {
            success: true,
            method: "custom",
            detail: `[deduplicated] ${rawMsg}`,
            value: {
                message: rawMsg,
                channel: "deduplicated"
            }
        };
    }

    // 2. 结构化审计日志输出
    if (enableLog) {
        console.info(`[IndexOS Notification][${channel}]`, rawMsg);
    }

    const isBackground = typeof document === "undefined" || document.visibilityState === "hidden" || !document.hasFocus();
    let methodUsed = "toast";

    // 3. 智能/指定分发系统原生通知 (OS Native Notification)
    if (channel === "system" || (channel === "auto" && isBackground)) {
        let osNotified = false;

        // 通道 A: Electron 桌面端原生 IPC (macOS / Windows / Linux 系统通知中心)
        const ipc = getIpcRenderer();
        if (ipc && typeof ipc.send === "function") {
            try {
                ipc.send("siyuan-cmd", {
                    cmd: "notification",
                    title: "IndexOS",
                    body: rawMsg,
                    timeoutType: "default"
                });
                osNotified = true;
                methodUsed = "electron_notification";
            } catch (_) {}
        }

        // 通道 B: 移动端原生桥接 (Android / iOS / HarmonyOS)
        if (!osNotified && sendMobileNotification("IndexOS", rawMsg)) {
            osNotified = true;
            methodUsed = "mobile_notification";
        }

        // 通道 C: Web 标准 Notification API
        if (!osNotified && typeof Notification !== "undefined") {
            try {
                if (Notification.permission === "granted") {
                    new Notification("IndexOS", { body: rawMsg });
                    osNotified = true;
                    methodUsed = "web_notification";
                } else if (Notification.permission !== "denied") {
                    Notification.requestPermission().then((perm) => {
                        if (perm === "granted") {
                            new Notification("IndexOS", { body: rawMsg });
                        }
                    });
                }
            } catch (_) {}
        }

        // 通道 D: 兜底调用思源内核广播或界面 Toast
        if (!osNotified) {
            try {
                await post("/api/notification/pushMsg", { msg: rawMsg, timeout });
                methodUsed = "kernel_push";
            } catch (_) {
                showMessage(rawMsg, timeout, "info");
            }
        }
    } else {
        // 4. 前台思源 Toast 气泡
        showMessage(rawMsg, timeout, "info");
    }

    // 4. 登记防重复活跃期
    if (preventDuplicate) {
        g_activeMessages.add(rawMsg);
        setTimeout(() => {
            g_activeMessages.delete(rawMsg);
        }, timeout);
    }

    return {
        success: true,
        method: "custom",
        detail: `[${methodUsed}] ${rawMsg}`,
        value: {
            message: rawMsg,
            channel: methodUsed
        }
    };
}
