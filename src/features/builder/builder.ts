import { client } from "../../shared/api-client";
import { IBlockProcessor } from "./processor";


async function changeSort(notebook: string, paths: string[]) {
    try {
        await fetch("/api/filetree/changeSort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notebook, paths })
        });
    } catch (e) {
        console.error("Failed to sort docs", e);
    }
}



export class ListProcessor {
    errors: string[] = [];
    ibp: IBlockProcessor;

    constructor() {
        this.ibp = new IBlockProcessor(this.errors);
    }

    async processRecursive(blockId: string, type: string, actionType: string, ctx: any = null) {
        if (!ctx) {
            ctx = { previousId: null, parentId: null, level: 1 };
        }
        
        if (type === "NodeListItem" || type === "i") {
            const result = await this.ibp.processSingleItem(blockId, actionType, ctx);
            
            const resultId = (result && typeof result === 'object') ? result.id : result;
            if (resultId) ctx.previousId = resultId;

            const childCtx = {
                previousId: ctx.previousId,
                parentId: (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") ? resultId : ctx.parentId,
                level: ctx.level + 1,
                parentInfo: ( (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") && result && typeof result === 'object') ? result : ctx.parentInfo
            };

            let childrenRes = await client.sql({
                stmt: `SELECT id, type, subtype FROM blocks WHERE parent_id = '${blockId}' AND type = 'l' ORDER BY sort ASC`
            });
            let children = childrenRes.data || [];

            for (const child of children) {
                await this.processRecursive(child.id, "NodeList", actionType, childCtx);
                ctx.previousId = childCtx.previousId;
            }
            return result;

        } else if (type === "NodeList" || type === "l") { 
            let children: any[] = [];
            try {
                // Use getChildBlocks API which loads AST and traverses the linked list in memory
                // This guarantees the children are returned in correct visual order.
                const response = await fetch("/api/block/getChildBlocks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: blockId })
                });
                const res = await response.json();
                
                // Debug: Print API response and key info
                if (res.code === 0 && res.data) {
                    console.log(`[Builder] getChildBlocks for ${blockId}:`, JSON.stringify(res.data));
                    children = res.data;
                    console.log(`[Builder] Retrieved ${children.length} children via AST. IDs:`, children.map((c: any) => c.id));
                } else {
                    console.warn(`[Builder] Failed to get children for ${blockId}`, res);
                }
            } catch (e) {
                console.error("[Builder] Failed to get children for list", e);
            }

            let docPaths: string[] = [];
            let notebookId: string | null = null;

            for (const child of children) {
                const childResult = await this.processRecursive(child.id, "NodeListItem", actionType, ctx);
                
                if ((actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") && childResult && typeof childResult === 'object' && (childResult.path || childResult.hpath)) {
                    // Collect path
                    const path = childResult.path || childResult.hpath;
                    docPaths.push(path);
                    notebookId = childResult.notebook;
                }
            }

            if (docPaths.length > 0 && notebookId) {
                console.log(`[Builder] Sorting ${docPaths.length} items. Desired Order:`, docPaths);
                await changeSort(notebookId, docPaths);
            }
        }
    }
}
