import { post } from "../../../shared/api-client/request";
import { runQuery } from "../../sqlite/sqlite-manager";
import { showMessage } from "siyuan";
import type { CommandContext } from "../command-dispatcher";

export async function triggerTurnIntoTask(
    params: Record<string, unknown>,
    context: CommandContext
): Promise<void> {
    const blockEl = context.blockEl;
    if (!blockEl) {
        showMessage("❌ 转换为任务失败：未提供有效的目标块", 5000, "error");
        return;
    }

    const blockId = blockEl.getAttribute("data-node-id");
    if (!blockId) {
        showMessage("❌ 转换为任务失败：无法获取块 ID", 5000, "error");
        return;
    }

    // 1. 查询块的属性 (type, parent_id, subtype, markdown)
    const blockRes = await runQuery(`SELECT type, subtype, parent_id, markdown FROM blocks WHERE id = '${blockId}' LIMIT 1`);
    if (!blockRes || !blockRes.values || blockRes.values.length === 0) {
        showMessage("❌ 转换为任务失败：未找到该块的数据库记录", 5000, "error");
        return;
    }

    let [type, subtype, parentId, markdown] = blockRes.values[0];
    console.log(`[TurnIntoTask] Target block type: "${type}", subtype: "${subtype}", parentId: "${parentId}"`);

    // 黑名单校验 (只读、非文本等不可转换的块类型)
    const blacklistedTypes = ["t", "code", "m", "html", "widget", "iframe", "audio", "video", "query_embed", "d"];
    if (blacklistedTypes.includes(type)) {
        showMessage(`⚠️ 该块类型 (${type}) 无法转换为任务列表`, 5000, "info");
        return;
    }

    // 2. 路由分支：如果是列表项 NodeListItem ('i')，重路由至其父级列表 NodeList ('l')
    let targetId = blockId;
    if (type === "i" && parentId) {
        const parentRes = await runQuery(`SELECT type, subtype FROM blocks WHERE id = '${parentId}' LIMIT 1`);
        if (parentRes && parentRes.values && parentRes.values.length > 0) {
            const [parentType, parentSubtype] = parentRes.values[0];
            if (parentType === "l") {
                type = "l";
                subtype = parentSubtype;
                targetId = parentId;
                console.log(`[TurnIntoTask] Re-routing turn-into action from ListItem (${blockId}) to parent List (${parentId})`);
            }
        }
    }

    // 3. 判断是否已经是任务列表了（避免重复转换）
    if (type === "l" && subtype === "t") {
        showMessage("💡 目标已是任务列表，无需转换", 5000, "info");
        return;
    }

    // 4. 执行转换路径
    const protyle = (context as any).protyle || (window as any).siyuan?.ws?.protyle || null;
    
    if (protyle && typeof protyle.turnIntoTransaction === "function") {
        // --- 路线 A: 前台编辑器事务 (保留撤销/重做历史) ---
        console.log("[TurnIntoTask] Executing via active editor (Protyle) transaction");
        try {
            const editorEl = protyle.wysiwyg.element;
            let targetEl = editorEl.querySelector(`[data-node-id="${targetId}"]`) as HTMLElement;
            if (!targetEl) {
                targetEl = blockEl;
            }

            if (type === "l") {
                const sub = targetEl.getAttribute("data-subtype") || "u";
                const transType = sub === "o" ? "OL2TL" : "UL2TL";
                // @ts-ignore
                protyle.turnIntoTransaction(targetEl, transType);
            } else {
                // @ts-ignore
                protyle.turnIntoTransaction(targetEl, "Blocks2TLs");
            }
            showMessage("✨ 已成功转换为任务列表");
            return;
        } catch (e: any) {
            console.warn("[TurnIntoTask] Failed to convert via editor transaction, falling back to backend API:", e);
        }
    }

    // --- 路线 B: 后台/静默无界面执行 (Fallback API) ---
    console.log("[TurnIntoTask] Executing via backend API fallback");
    try {
        if (type === "l") {
            // 查出该 List 下所有直属子 ListItem 的 Markdown 内容
            const itemsRes = await runQuery(`SELECT id, markdown FROM blocks WHERE parent_id = '${targetId}' AND type = 'i' ORDER BY sort ASC`);
            if (!itemsRes || !itemsRes.values || itemsRes.values.length === 0) {
                showMessage("❌ 转换为任务失败：列表内未找到列表项", 5000, "error");
                return;
            }

            // 对每一项重新做 markdown 包装为 task list item 格式
            const newMarkdownList = itemsRes.values.map(([_, md]: [string, string]) => {
                let cleanText = md.replace(/^([\s\t]*)([*+-]|\d+\.)\s+/, "");
                cleanText = cleanText.replace(/^\[[ xX]\]\s+/, "");
                return `* [ ] ${cleanText}`;
            }).join("\n");

            console.log(`[TurnIntoTask] Formatted markdown for list ${targetId}:`, newMarkdownList);

            const res = await post("/api/block/updateBlock", {
                id: targetId,
                dataType: "markdown",
                data: newMarkdownList
            });

            if (res.code === 0) {
                showMessage("✨ 已成功转换为任务列表 (全部列表项)");
            } else {
                showMessage(`❌ 转换失败: ${res.msg || "未知内核错误"}`, 5000, "error");
            }
        } else {
            // 普通段落、标题等
            let cleanText = markdown || "";
            cleanText = cleanText.replace(/^\[[ xX]\]\s+/, "");
            const newMarkdown = `* [ ] ${cleanText}`;

            const res = await post("/api/block/updateBlock", {
                id: targetId,
                dataType: "markdown",
                data: newMarkdown
            });

            if (res.code === 0) {
                showMessage("✨ 已成功转换为任务列表");
            } else {
                showMessage(`❌ 转换失败: ${res.msg || "未知内核错误"}`, 5000, "error");
            }
        }
    } catch (err: any) {
        console.error("[TurnIntoTask] Fallback execution error:", err);
        showMessage(`❌ 转换出错: ${err.message}`, 5000, "error");
    }
}
