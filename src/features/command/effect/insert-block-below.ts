/**
 * insert-block-below.ts
 * 在下方插入块命令 (plugin-index.command.insertBlockBelow) - Universal 多态实现
 *
 * 基于思源 3.7+ 官方核心 API 精准多态设计：
 * 1. 当目标是普通块 (type != 'd')：调用 /api/block/insertBlock + previousID，在同级正下方插入；
 * 2. 当目标是文档页面 (type == 'd')：
 *    - 默认策略 (pageInsertMode: bottom)：调用官方原生 /api/block/appendBlock + parentID，在页面最底部追加块；
 *    - 顶端策略 (pageInsertMode: top)：调用官方原生 /api/block/prependBlock + parentID，在页面顶部插入首行块；
 *    - 子页面策略 (pageInsertMode: child_doc 或 insertType: d)：调用 /api/filetree/createDocWithMd + parentID，在当前页面下精准建立子页面；
 * 3. 自动向上下文 pool (context.vars) 暴露 createdblock 出参供后续 Pipeline 步骤链引用。
 */

import { post } from "../../../shared/api-client/request";
import type { CommandContext, DispatchResult } from "../command-dispatcher";
import { getBlockId } from "../utils/context-extractor";
import { formatDate } from "../utils/template-engine";

export async function triggerInsertBlockBelow(
    resolvedParams: Record<string, unknown>,
    context: CommandContext
): Promise<DispatchResult> {
    const rawTargetId = String(
        resolvedParams.id || 
        context.vars?.block_id || 
        context.vars?.root_id || 
        getBlockId(context) || 
        ""
    ).trim();

    let dataContent = String(resolvedParams.data || "").trim();
    const insertType = String(resolvedParams.insertType || "p").trim().toLowerCase();
    const pageInsertMode = String(resolvedParams.pageInsertMode || "bottom").trim().toLowerCase();

    if (!rawTargetId) {
        console.warn("[InsertBlockBelow] 错误：无法找到有效 Target ID");
        return { success: false, method: "custom", detail: "Missing target ID" };
    }

    try {
        // 1. 预检 SQL：查询 targetId 是否存在及其物理节点类型 (type)
        const sqlResRaw = await post("/api/query/sql", {
            stmt: `SELECT id, type, box, path FROM blocks WHERE id = '${rawTargetId}' LIMIT 1`
        });

        const rows: any[] = Array.isArray(sqlResRaw) 
            ? sqlResRaw 
            : (Array.isArray(sqlResRaw?.data) ? sqlResRaw.data : []);

        if (rows.length === 0) {
            console.error(`[InsertBlockBelow] 目标 ID "${rawTargetId}" 在数据库中不存在`);
            return {
                success: false,
                method: "custom",
                detail: `Target ID ${rawTargetId} does not exist in SQLite database`
            };
        }

        const targetRow = rows[0];
        const nodeType = targetRow.type || "";
        const notebookBox = targetRow.box || "";

        // 2. 格式化 Markdown 内容 (安全防空)
        const safeMarkdown = formatMarkdownContent(dataContent, insertType);
        let createdId = "";

        // 3. 多态 API 派发
        if (nodeType === "d") {
            // ─── 目标为页面 (Doc Page) ───
            if (pageInsertMode === "child_doc" || insertType === "d" || insertType === "doc") {
                // 策略 A: 在当前页面下精准创建【子页面】
                // 关键 path 算式：当前页面的 path (如 /20260708105754-5cvrheu.sy) 去掉 .sy 后拼上 /子页面标题
                const docTitle = dataContent || `新页面-${formatDate(new Date())}`;
                const basePath = docPath ? docPath.replace(/\.sy$/, "") : "";
                const childPath = `${basePath}/${docTitle}`;

                const payload = {
                    notebook: notebookBox,
                    path: childPath,
                    parentID: rawTargetId,
                    markdown: "\u200B"
                };
                console.log(`[InsertBlockBelow] 在页面 ${rawTargetId} (${childPath}) 下精准创建子页面: "${docTitle}"`);
                const docRes = await post("/api/filetree/createDocWithMd", payload);
                createdId = typeof docRes === "string" ? docRes : (docRes?.data || docRes?.id || "");
            } else if (pageInsertMode === "top") {
                // 策略 B: 页面头部/首行插入 prependBlock
                const payload = {
                    parentID: rawTargetId,
                    dataType: "markdown",
                    data: safeMarkdown
                };
                const prepRes = await post("/api/block/prependBlock", payload);
                createdId = extractIdFromInsertRes(prepRes);
            } else {
                // 策略 C (默认): 页面底部追加 appendBlock
                const payload = {
                    parentID: rawTargetId,
                    dataType: "markdown",
                    data: safeMarkdown
                };
                const appRes = await post("/api/block/appendBlock", payload);
                createdId = extractIdFromInsertRes(appRes);
            }
        } else {
            // ─── 目标为普通内容块 (Content Block) ───
            const payload = {
                previousID: rawTargetId,
                dataType: "markdown",
                data: safeMarkdown
            };
            const insRes = await post("/api/block/insertBlock", payload);
            createdId = extractIdFromInsertRes(insRes);
        }

        if (createdId) {
            if (!context.vars) context.vars = {};
            context.vars.createdblock = createdId;
            context.vars.id = createdId;
            context.vars.last_id = createdId;
        }

        return {
            success: true,
            method: "custom",
            detail: `Successfully inserted below ${rawTargetId}`,
            value: createdId,
            id: createdId
        };
    } catch (error: any) {
        console.error("[InsertBlockBelow] 执行异常:", error);
        return {
            success: false,
            method: "custom",
            detail: error.message || String(error)
        };
    }
}

/** 辅助：格式化 Markdown 文本 */
function formatMarkdownContent(content: string, insertType: string): string {
    const rawText = (content || "").trim();
    const safeText = rawText || "\u200B";

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

/** 辅助：提取响应 ID */
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
