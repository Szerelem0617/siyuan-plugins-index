import { client } from "../../shared/api-client";
import { IBlockProcessor } from "./processor";

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
        
        const shouldReverse = actionType === "PUSH_TO_DOC";

        if (type === "NodeListItem" || type === "i") {
            const resultId = await this.ibp.processSingleItem(blockId, actionType, ctx);
            if (resultId) ctx.previousId = resultId;

            const childCtx = {
                previousId: ctx.previousId,
                parentId: (actionType === "PUSH_TO_DOC") ? resultId : ctx.parentId,
                level: ctx.level + 1
            };

            let childrenRes = await client.sql({
                stmt: `SELECT id, type, subtype FROM blocks WHERE parent_id = '${blockId}' AND type = 'l' ORDER BY sort ASC`
            });
            let children = childrenRes.data || [];
            if (shouldReverse) children = children.reverse();

            for (const child of children) {
                await this.processRecursive(child.id, "NodeList", actionType, childCtx);
                ctx.previousId = childCtx.previousId;
            }
            return resultId;

        } else if (type === "NodeList" || type === "l") { 
            let childrenRes = await client.sql({
                stmt: `SELECT id, type FROM blocks WHERE parent_id = '${blockId}' AND type = 'i' ORDER BY sort ASC`
            });
            let children = childrenRes.data || [];
            if (shouldReverse) children = children.reverse();
            
            for (const child of children) {
                await this.processRecursive(child.id, "NodeListItem", actionType, ctx);
            }
        }
    }
}
