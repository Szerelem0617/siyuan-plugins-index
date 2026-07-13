import { showMessage } from "siyuan";

export async function triggerShowMessage(
    params: Record<string, any>,
    context: any
) {
    const message = params.message || "看到这条消息会有好运～";
    console.log(`[ShowMessageCmd] Executing custom command showMessage: "${message}"`);
    showMessage(message, 0, "info"); // Use timeout=0 for user manual close
}
