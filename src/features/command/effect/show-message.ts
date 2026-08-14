import { showMessage } from "siyuan";
import type { CommandContext } from "../dispatcher";

export async function triggerShowMessage(
    params: Record<string, any>,
    _context?: CommandContext
) {
    const message = params.message || "看到这条消息会有好运～";
    const timeout = params.timeout !== undefined && params.timeout !== "" ? Number(params.timeout) : 6000;
    const type = params.type || "info";
    const messageId = params.messageId || undefined;

    console.log(`[ShowMessageCmd] Executing custom command showMessage: message="${message}", timeout=${timeout}, type="${type}", messageId="${messageId}"`);
    showMessage(message, timeout, type, messageId);
}
