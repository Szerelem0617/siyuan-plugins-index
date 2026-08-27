/**
 * insert-block-below.ts
 * 在下方插入块命令 (index.insertBlockBelow) - Universal 真实写逻辑与防 Panic 版
 *
 * 核心机制：
 * 1. 🛡️ 严格 Block ID 正则校验 (SIYUAN_ID_REGEX) + 活动 Protyle 环境探针自动修复 ID；
 * 2. 🧱 普通内容块 (type != 'd')：调用 /api/block/insertBlock + previousID 在同级正下方插入；
 * 3. 📄 文档页面 (type == 'd')：
 *    - child_doc 策略：获取父页面 HPath (如 /目录/父页面)，拼出 /目录/父页面/新子页面 发送给 createDocWithMd + parentID，精准生成子页面；
 *    - bottom 策略 (默认)：SQL 查出页面底层最后一个内容块 (lastBlockId)，以 insertBlock + previousID 安全追加（规避 appendBlock 的内核 panic）；若为空页面则用 insertBlock + parentID 挂载；
 *    - top 策略：调用 /api/block/prependBlock + parentID 首行插入；
 * 4. 自动向 context.vars 暴露 createdblock / id / last_id 出参。
 */

import { post } from "../../../shared/api-client/request";
import type { CommandContext, DispatchResult } from "../command-dispatcher";
import { getBlockId } from "../utils/context-extractor";
import { formatDate } from "../utils/template-engine";

/** 匹配思源 14 位标准 Block ID 格式 (例如 20260708105754-5cvrheu) */
const SIYUAN_ID_REGEX = /^\d{14}-[a-z0-9]{7}$/;

export async function triggerInsertBlockBelow(
    resolvedParams: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    console.group(`⚡ [InsertBlockBelow] 触发执行在下方插入块命令`);
    console.log("👉 原始参数 (resolvedParams):", JSON.parse(JSON.stringify(resolvedParams || {})));

    let rawTargetId = String(
        resolvedParams.id || 
        context.vars?.block_id || 
        context.vars?.root_id || 
        getBlockId(context) || 
        ""
    ).trim();

    console.log(`🔍 初始提取 TargetID: "${rawTargetId}"`);

    // 1. ID 正则校验与活动环境探针自动修补
    if (!SIYUAN_ID_REGEX.test(rawTargetId)) {
        console.warn(`⚠️ 提取的 ID "${rawTargetId}" 不符合标准 14 位 Block ID 格式，启动环境探针自动修复...`);
        const activeProtyle = (window as any).activeProtyleInstance || (window as any).siyuan?.ws?.protyle;
        const fallbackId = activeProtyle?.block?.rootID || activeProtyle?.block?.id || activeProtyle?.blockId;

        if (fallbackId && SIYUAN_ID_REGEX.test(String(fallbackId))) {
            rawTargetId = String(fallbackId);
            console.log(`✅ 环境探针修复成功，获得活动页面 ID: "${rawTargetId}"`);
        } else {
            console.error(`🛑 无法获得合法的思源 Block ID，终止写操作以防内核 Panic`);
            console.groupEnd();
            return {
                success: false,
                method: "custom",
                detail: `Invalid or missing Siyuan Block ID: "${rawTargetId}"`
            };
        }
    }

    const dataContent = String(resolvedParams.data || "").trim();
    const insertType = String(resolvedParams.insertType || "p").trim().toLowerCase();
    const pageInsertMode = String(resolvedParams.pageInsertMode || "bottom").trim().toLowerCase();

    console.log(`📌 确认 TargetID: "${rawTargetId}" | 块类型: "${insertType}" | 页面策略: "${pageInsertMode}"`);

    try {
        // 2. 节点元数据探测：优先查 SQL，若处于新创块未索引态则从 DOM 智能推断
        let nodeType = "";
        let notebookBox = "";

        const sqlResRaw = await post("/api/query/sql", {
            stmt: `SELECT id, type, box, path FROM blocks WHERE id = '${rawTargetId}' LIMIT 1`
        });

        const rows: any[] = Array.isArray(sqlResRaw) 
            ? sqlResRaw 
            : (Array.isArray(sqlResRaw?.data) ? sqlResRaw.data : []);

        if (rows.length > 0) {
            nodeType = rows[0].type || "";
            notebookBox = rows[0].box || "";
            console.log(`✅ SQL 节点确认成功: nodeType="${nodeType}", notebook="${notebookBox}"`);
        } else {
            // SQLite 尚未建立索引（新创块/刚输入的块）：从活动 DOM 或上下文探针识别
            const targetEl = context.blockEl || document.querySelector(`[data-node-id="${rawTargetId}"]`);
            if (targetEl) {
                const isDoc = targetEl.classList.contains("protyle-title") || targetEl.getAttribute("data-type") === "NodeDocument";
                nodeType = isDoc ? "d" : (targetEl.getAttribute("data-type") || "p");
                console.log(`ℹ️ [InsertBlockBelow] SQLite 暂未完成索引，从 DOM 识别节点类型: "${nodeType}"`);
            } else {
                nodeType = "p";
                console.log(`ℹ️ [InsertBlockBelow] 按标准内容块执行: TargetID="${rawTargetId}"`);
            }
        }

        // 3. 格式化 Markdown 内容 (防空)
        const safeMarkdown = formatMarkdownContent(dataContent, insertType);
        let createdId = "";

        // 4. 多态派发写入
        if (nodeType === "d") {
            // ─── 目标为页面 (Doc Page, type = 'd') ───
            if (pageInsertMode === "child_doc") {
                // 策略 A: 创建【真正的子页面】
                let parentHPath = "";
                try {
                    const hpathRes = await post("/api/filetree/getHPathByID", { id: rawTargetId });
                    parentHPath = typeof hpathRes === "string" ? hpathRes : (hpathRes?.data || "");
                } catch (e) {
                    console.warn("[InsertBlockBelow] 获取父页面 HPath 警告", e);
                }

                const docTitle = dataContent || `新页面-${formatDate(new Date())}`;
                const childHPath = parentHPath ? `${parentHPath}/${docTitle}` : `/${docTitle}`;

                const payload = {
                    notebook: notebookBox,
                    path: childHPath,
                    parentID: rawTargetId,
                    markdown: "\u200B"
                };
                console.log(`📄 [API 提交] /api/filetree/createDocWithMd (HPath: "${childHPath}")`, payload);
                const docRes = await post("/api/filetree/createDocWithMd", payload);
                createdId = typeof docRes === "string" ? docRes : (docRes?.data || docRes?.id || "");
            } else if (pageInsertMode === "top") {
                // 策略 B: 页面头部插入 prependBlock
                const payload = {
                    parentID: rawTargetId,
                    dataType: "markdown",
                    data: safeMarkdown
                };
                console.log("📄 [API 提交] /api/block/prependBlock Payload:", payload);
                const prepRes = await post("/api/block/prependBlock", payload);
                createdId = extractIdFromInsertRes(prepRes);
            } else {
                // 策略 C (默认): 在页面底部追加块 (安全挂载机制，防护内核 Panic)
                console.log(`🔍 检索页面 ${rawTargetId} 下现有的最后一个内容块...`);
                const lastBlockRes = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE root_id = '${rawTargetId}' AND parent_id = '${rawTargetId}' AND type != 'd' ORDER BY sort DESC, created DESC LIMIT 1`
                });

                const lastRows: any[] = Array.isArray(lastBlockRes) 
                    ? lastBlockRes 
                    : (Array.isArray(lastBlockRes?.data) ? lastBlockRes.data : []);
                let lastBlockId = lastRows.length > 0 ? lastRows[0].id : "";

                let appRes: any;
                if (lastBlockId && lastBlockId !== rawTargetId) {
                    // 页面已有块：用 insertBlock + previousID 在最后一个块下方追加（极其稳定）
                    const payload = {
                        previousID: lastBlockId,
                        dataType: "markdown",
                        data: safeMarkdown
                    };
                    console.log(`📄 [API 提交] /api/block/insertBlock (基于页面末尾块 ${lastBlockId} 追加)`, payload);
                    appRes = await post("/api/block/insertBlock", payload);
                } else {
                    // 空页面：用 insertBlock + parentID 挂载
                    const payload = {
                        parentID: rawTargetId,
                        dataType: "markdown",
                        data: safeMarkdown
                    };
                    console.log(`📄 [API 提交] /api/block/insertBlock (空页面 parentID 挂载)`, payload);
                    appRes = await post("/api/block/insertBlock", payload);
                }
                createdId = extractIdFromInsertRes(appRes);
            }
        } else {
            // ─── 目标为普通内容块 (Content Block) ───
            const payload = {
                previousID: rawTargetId,
                dataType: "markdown",
                data: safeMarkdown
            };
            console.log(`🧱 [API 提交] /api/block/insertBlock (同级块下方挂载)`, payload);
            const insRes = await post("/api/block/insertBlock", payload);
            createdId = extractIdFromInsertRes(insRes);
        }

        if (createdId) {
            console.log(`🎉 [InsertBlockBelow] 写入成功，新建 Block ID: "${createdId}"`);
        }

        console.groupEnd();
        return {
            success: true,
            method: "custom",
            detail: `Successfully inserted below ${rawTargetId}`,
            value: createdId,
            id: createdId
        };
    } catch (error: any) {
        console.error("💥 [InsertBlockBelow] 运行时异常捕获:", error);
        console.groupEnd();
        return {
            success: false,
            method: "custom",
            detail: error.message || String(error)
        };
    }
}

/** 辅助：格式化 Markdown 文本并安全防空 */
function formatMarkdownContent(content: string, insertType: string): string {
    const rawText = (content || "").trim();
    const safeText = rawText || "新节点";

    switch (insertType) {
        case "h":
        case "heading":
        case "h1":
            return `# ${safeText}`;
        case "h2":
            return `## ${safeText}`;
        case "h3":
            return `### ${safeText}`;
        case "c":
        case "code":
            return `\`\`\`\n${safeText}\n\`\`\``;
        case "b":
        case "blockquote":
            return `> ${safeText}`;
        case "l":
        case "list":
            return `* ${safeText}`;
        case "t":
        case "table":
            return `| ${safeText} |\n| --- |\n|  |`;
        case "tb":
            return `---`;
        case "p":
        case "paragraph":
        default:
            return safeText;
    }
}

/** 辅助：提取响应中的 ID */
function extractIdFromInsertRes(res: any): string {
    if (!res) return "";
    if (typeof res === "string") return res;
    if (Array.isArray(res)) {
        return res[0]?.doOperations?.[0]?.id || res[0]?.id || "";
    }
    if (typeof res === "object") {
        return res.data?.[0]?.doOperations?.[0]?.id || res.data?.id || res.id || "";
    }
    return "";
}
