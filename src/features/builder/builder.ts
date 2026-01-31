import { client } from "../../shared/api-client";
import { IBlockProcessor } from "./processor";
import { stripMarkdownSyntax } from "../../shared/utils/markdown-utils";

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
                const childResult = await this.processRecursive(child.id, "NodeList", actionType, childCtx);
                ctx.previousId = childCtx.previousId;
            }
            return result;

        } else if (type === "NodeList" || type === "l") { 
            let childrenRes = await client.sql({
                stmt: `SELECT id, type, previous_id, next_id, content, sort FROM blocks WHERE parent_id = '${blockId}' AND type = 'i'`
            });
            let children = childrenRes.data || [];
            
            // Debug: Log raw chain data
            console.log(`[Builder] Raw Chain Data:`, children.map((c: any) => ({
                id: c.id,
                prev: c.previous_id,
                next: c.next_id,
                sort: c.sort
            })));

            // Sort by linked list (visual order)
            if (children.length > 0) {
                const map = new Map();
                let first = null;
                children.forEach((c: any) => {
                    map.set(c.id, c);
                });
                
                // Find head: has no previous_id or previous_id not in this set
                children.forEach((c: any) => {
                    if (!c.previous_id || !map.has(c.previous_id)) {
                        first = c;
                    }
                });

                const sorted = [];
                let curr = first;
                while (curr) {
                    sorted.push(curr);
                    curr = map.get(curr.next_id);
                }
                
                if (sorted.length !== children.length) {
                    console.warn(`[Builder] Linked list broken. Sorted: ${sorted.length}, Total: ${children.length}`);
                } else {
                    children = sorted;
                }
            }
            
            // Debug: fetch text for items to verify order
            if (children.length > 0) {
                try {
                    const ids = children.map((c:any) => `'${c.id}'`).join(",");
                    const textRes = await client.sql({
                        stmt: `SELECT parent_id, content FROM blocks WHERE parent_id IN (${ids}) AND type='p'`
                    });
                    const textMap = new Map();
                    textRes.data?.forEach((r:any) => textMap.set(r.parent_id, stripMarkdownSyntax(r.content)));
                    console.log(`[Builder] List Order (Text):`, children.map((c: any) => textMap.get(c.id) || "N/A"));
                } catch(e) {
                    console.error("[Builder] Failed to debug list order", e);
                }
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
