import { client } from "../../shared/api-client";
import { IBlockProcessor, ATTR_INDEX, ATTR_OUTLINE } from "./processor";
import { ATTR_LINKED_AV } from "../../shared/constants";

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
            // Standard single item processing (Fallback or for updates)
            const result = await this.ibp.processSingleItem(blockId, actionType, ctx);
            
            const resultId = (result && typeof result === 'object') ? result.id : result;
            if (resultId) ctx.previousId = resultId;

            const childCtx = {
                ...ctx,
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
            // Detect AV linkage on the list block itself to support inheritance/overrides
            let nextCtx = ctx;
            const attrs = await client.getBlockAttrs({ id: blockId });
            if (attrs.data && attrs.data[ATTR_LINKED_AV]) {
                nextCtx = { ...ctx, avId: attrs.data[ATTR_LINKED_AV] };
            }
            await this.processListBatch(blockId, actionType, nextCtx);
        }
    }

    async processListBatch(blockId: string, actionType: string, ctx: any) {
        let children: any[] = [];
        try {
            const response = await fetch("/api/block/getChildBlocks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: blockId })
            });
            const res = await response.json();
            if (res.code === 0 && res.data) {
                children = res.data;
            }
        } catch (e) {
            console.error("[Builder] Failed to get AST", e);
            return;
        }

        if (children.length === 0) return;

        const itemIds = children.map((c: any) => `'${c.id}'`).join(",");
        
        // 1. Batch Fetch Source Info
        const [sourceItemsRes, sourceContentRes] = await Promise.all([
            client.sql({ stmt: `SELECT id, ial FROM blocks WHERE id IN (${itemIds})` }),
            client.sql({ stmt: `SELECT parent_id, id, markdown, content FROM blocks WHERE parent_id IN (${itemIds}) AND type='p'` })
        ]);

        const sourceMap = new Map();
        sourceItemsRes.data?.forEach((i: any) => sourceMap.set(i.id, i));
        
        const contentMap = new Map(); // parent_id -> [p_block]
        sourceContentRes.data?.forEach((p: any) => {
            if (!contentMap.has(p.parent_id)) contentMap.set(p.parent_id, []);
            contentMap.get(p.parent_id).push(p);
        });

        // 2. Identify Targets
        const targetIds = new Set<string>();
        sourceItemsRes.data?.forEach((i: any) => {
            const ial = i.ial || "";
            const docMatch = ial.match(new RegExp(`${ATTR_INDEX}="([^"]+)"`));
            if (docMatch) targetIds.add(`'${docMatch[1]}'`);
            
            const headingMatch = ial.match(new RegExp(`${ATTR_OUTLINE}="([^"]+)"`));
            if (headingMatch) targetIds.add(`'${headingMatch[1]}'`);
        });

        // 3. Batch Fetch Targets
        let targetMap = new Map();
        if (targetIds.size > 0) {
            const targetRes = await client.sql({ 
                stmt: `SELECT id, content, type, sort, ial, markdown, box, path, hpath FROM blocks WHERE id IN (${Array.from(targetIds).join(",")})` 
            });
            targetRes.data?.forEach((t: any) => targetMap.set(t.id, t));
        }

        let docPaths: string[] = [];
        let notebookId: string | null = null;

        // 4. Differential Process
        for (const child of children) {
            const sourceItem = sourceMap.get(child.id);
            const pBlocks = contentMap.get(child.id) || [];
            
            // Parse Source
            const core = this.ibp.parseItemContent(child.id, pBlocks);
            
            // Get Bound Targets
            let docTargetId = null;
            let headingTargetId = null;
            if (sourceItem?.ial) {
                const dM = sourceItem.ial.match(new RegExp(`${ATTR_INDEX}="([^"]+)"`));
                if (dM) docTargetId = dM[1];
                const hM = sourceItem.ial.match(new RegExp(`${ATTR_OUTLINE}="([^"]+)"`));
                if (hM) headingTargetId = hM[1];
            }

            const docTarget = docTargetId ? targetMap.get(docTargetId) : null;
            const headingTarget = headingTargetId ? targetMap.get(headingTargetId) : null;

            let needsUpdate = false;

            // Diff Logic
            if (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") {
                if (!docTarget) {
                    needsUpdate = true;
                } else {
                    // Check Title (We don't have doc title in blocks table easily, use content?) 
                    // For docs, 'content' in blocks table is usually the title.
                    // Also check Icon. Icon is in 'ial'.
                    if (docTarget.content !== core.syncText) needsUpdate = true;
                    else {
                        const iconMatch = (docTarget.ial || "").match(/icon="([^"]+)"/);
                        const currentDocIcon = iconMatch ? iconMatch[1] : "";
                        const desiredIcon = core.currentIcon ? this.ibp.emojiToHex(core.currentIcon) : "";
                        // Simple comparison (might need normalization, but good enough for now)
                        if (currentDocIcon !== desiredIcon) needsUpdate = true;
                    }
                }
            }
            
            if (actionType === "PUSH_TO_BOTTOM" || actionType === "PUSH_COMBINED") {
                if (!headingTarget) {
                    needsUpdate = true;
                } else {
                    // Check Content
                    // Heading content in DB includes markdown syntax usually? 
                    // core.syncMd is "Text" or "Icon Text".
                    // The block content for heading is e.g. "### Title".
                    // We can check if it contains the syncText.
                    if (!headingTarget.content.includes(core.syncText)) needsUpdate = true;
                    // Also if icon changed (though icon is part of content for heading usually?)
                    // In previous logic, we put icon in parts for list item, not heading title.
                    // So heading is just text.
                }
            }

            let result = null;

            if (needsUpdate) {
                // Perform Update
                // console.log(`[Builder] Update needed for ${child.id}`);
                result = await this.processRecursive(child.id, "NodeListItem", actionType, ctx);
            } else {
                // Skip Update - Construct Result Context manually
                // console.log(`[Builder] Skipping ${child.id}`);
                
                const combinedResult: any = {};

                if (docTarget) {
                    // Optimization: Use cached path from SQL
                    combinedResult.id = docTarget.id;
                    combinedResult.notebook = docTarget.box;
                    combinedResult.path = docTarget.path;
                    combinedResult.hpath = docTarget.hpath;
                }
                
                if (headingTarget) {
                    // For Combined/Outline modes, ID must track the Heading for correct ordering
                    combinedResult.id = headingTarget.id;
                }

                if (combinedResult.id) {
                    result = combinedResult;
                }

                // Update Context
                const resultId = (result && typeof result === 'object') ? result.id : result;
                if (resultId) ctx.previousId = resultId;

                // Handle Sub-lists (Recursion)
                const childCtx = {
                    ...ctx,
                    previousId: ctx.previousId,
                    parentId: (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") ? resultId : ctx.parentId,
                    level: ctx.level + 1,
                    parentInfo: ( (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") && result && typeof result === 'object') ? result : ctx.parentInfo
                };

                let subListsRes = await client.sql({
                    stmt: `SELECT id, type, subtype FROM blocks WHERE parent_id = '${child.id}' AND type = 'l' ORDER BY sort ASC`
                });
                let subLists = subListsRes.data || [];

                for (const subList of subLists) {
                    await this.processRecursive(subList.id, "NodeList", actionType, childCtx);
                    ctx.previousId = childCtx.previousId;
                }
            }

            // Collect path for sorting
            if ((actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") && result && typeof result === 'object' && result.path) {
                docPaths.push(result.path);
                notebookId = result.notebook;
            }
        }

        if (docPaths.length > 0 && notebookId) {
            console.log(`[Builder] Sorting ${docPaths.length} items.`);
            await changeSort(notebookId, docPaths);
        }
    }
}
