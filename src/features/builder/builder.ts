import { client } from "../../shared/api-client";
import { IBlockProcessor, ATTR_INDEX, ATTR_OUTLINE } from "./processor";
import { ATTR_LINKED_AV, ATTR_LINKED_AV_BLOCK } from "../../shared/constants";
import { loadDbConfig } from "../data/av-setting/db-config";
import { buildAvHierarchy, getColIDMap } from "../../shared/utils/av-utils";

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
                ...ctx,
                previousId: ctx.previousId,
                parentId: (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") ? resultId : ctx.parentId,
                level: ctx.level + 1,
                parentInfo: ((actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") && result && typeof result === 'object') ? result : ctx.parentInfo
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
            let nextCtx = { ...ctx };
            const attrs = await client.getBlockAttrs({ id: blockId });

            if (attrs.data && attrs.data[ATTR_LINKED_AV]) {
                const avId = attrs.data[ATTR_LINKED_AV];
                const avBlockId = attrs.data[ATTR_LINKED_AV_BLOCK] || blockId;

                nextCtx.avId = avId;
                nextCtx.dbConfig = await loadDbConfig(avBlockId);
                const colInfo = await getColIDMap(avId);
                nextCtx.colIDMap = colInfo;
                nextCtx.parentMap = await buildAvHierarchy(colInfo.keyValues, colInfo.itemToBlock);
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

        const [sourceItemsRes, sourceContentRes] = await Promise.all([
            client.sql({ stmt: `SELECT id, ial FROM blocks WHERE id IN (${itemIds})` }),
            client.sql({ stmt: `SELECT parent_id, id, markdown, content FROM blocks WHERE parent_id IN (${itemIds}) AND type='p'` })
        ]);

        const sourceMap = new Map();
        sourceItemsRes.data?.forEach((i: any) => sourceMap.set(i.id, i));

        const contentMap = new Map();
        sourceContentRes.data?.forEach((p: any) => {
            if (!contentMap.has(p.parent_id)) contentMap.set(p.parent_id, []);
            contentMap.get(p.parent_id).push(p);
        });

        const targetIds = new Set<string>();
        sourceItemsRes.data?.forEach((i: any) => {
            const ial = i.ial || "";
            const docMatch = ial.match(new RegExp(`${ATTR_INDEX}="([^"]+)"`));
            if (docMatch) targetIds.add(`'${docMatch[1]}'`);
            const headingMatch = ial.match(new RegExp(`${ATTR_OUTLINE}="([^"]+)"`));
            if (headingMatch) targetIds.add(`'${headingMatch[1]}'`);
        });

        let targetMap = new Map();
        if (targetIds.size > 0) {
            const targetRes = await client.sql({
                stmt: `SELECT id, content, type, sort, ial, markdown, box, path, hpath FROM blocks WHERE id IN (${Array.from(targetIds).join(",")})`
            });
            targetRes.data?.forEach((t: any) => targetMap.set(t.id, t));
        }

        let docPaths: string[] = [];
        let notebookId: string | null = null;

        for (const child of children) {
            const sourceItem = sourceMap.get(child.id);
            const pBlocks = contentMap.get(child.id) || [];
            const core = this.ibp.parseItemContent(child.id, pBlocks);

            if (!core) {
                // console.log(`[Builder] Item ${child.id} could not be parsed. Skipping.`);
                continue;
            }

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

            // --- Database-Driven Inheritance ---
            // Inheritance is now fully handled in the database side (syncInheritanceToDb).
            // We simply serve what the database provides to the documents!
            let currentItemResolved: any = {};
            if (ctx.avId) {
                const itemAttrs = this.ibp.parseIAL(sourceItem?.ial);
                currentItemResolved = await this.ibp.getLinkedAVData(child.id, itemAttrs, ctx.avId) || {};
            }

            const itemCtx = {
                ...ctx,
                inheritedAttrs: currentItemResolved,
                itemResolvedAttrs: currentItemResolved
            };

            let needsUpdate = false;

            if (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") {
                if (!docTarget) {
                    console.log(`[Builder] Item ${child.id} has no target doc, PUSH needed.`);
                    needsUpdate = true;
                } else {
                    if (docTarget.content !== core.syncText) {
                        console.log(`[Builder] Item ${child.id} content mismatch: "${docTarget.content}" !== "${core.syncText}". Update needed.`);
                        needsUpdate = true;
                    } else {
                        const localValues = await this.ibp.getLinkedAVData(child.id, this.ibp.parseIAL(sourceItem?.ial), ctx.avId);

                        let desiredIcon = localValues?.icon ? (/[^\u0000-\u007F]/.test(localValues.icon) ? this.ibp.emojiToHex(localValues.icon) : localValues.icon) : (core.currentIcon ? this.ibp.emojiToHex(core.currentIcon) : "");

                        // USER REQUEST: Ignore default text emojis 📄, 📑 and separator ➖ to prevent infinite update loop.
                        if (desiredIcon === "📄" || desiredIcon === "📑" || desiredIcon === "➖" ||
                            desiredIcon === "1f4c4" || desiredIcon === "1f4d1" || desiredIcon === "2796") {
                            desiredIcon = "";
                        }

                        // USER REQUEST: Ignore dynamic icons and custom SVG images for target property inheritance.
                        if (desiredIcon.startsWith("api/icon/") || desiredIcon.includes(".")) {
                            desiredIcon = "";
                        }

                        const desiredImg = localValues?.["title-img"] || "";

                        const iconMatch = (docTarget.ial || "").match(/icon="([^"]+)"/);
                        const currentDocIcon = iconMatch ? iconMatch[1] : "";
                        const imgMatch = (docTarget.ial || "").match(/title-img="([^"]+)"/);
                        const currentDocImg = imgMatch ? imgMatch[1] : "";

                        if (currentDocIcon !== desiredIcon) {
                            console.log(`[Builder] Update needed due to Icon mismatch for ${child.id}: ${currentDocIcon} !== ${desiredIcon}`);
                            needsUpdate = true;
                        } else if (currentDocImg !== desiredImg) {
                            console.log(`[Builder] Update needed due to Image mismatch for ${child.id}: ${currentDocImg} !== ${desiredImg}`);
                            needsUpdate = true;
                        }
                    }
                }
            }

            if (actionType === "PUSH_TO_BOTTOM" || actionType === "PUSH_COMBINED") {
                if (!headingTarget) needsUpdate = true;
                else if (!headingTarget.content.includes(core.syncText)) needsUpdate = true;
            }

            let result = null;
            if (needsUpdate) {
                result = await this.processRecursive(child.id, "NodeListItem", actionType, itemCtx);
            } else {
                const combinedResult: any = {};
                if (docTarget) {
                    combinedResult.id = docTarget.id;
                    combinedResult.notebook = docTarget.box;
                    combinedResult.path = docTarget.path;
                    combinedResult.hpath = docTarget.hpath;
                }
                if (headingTarget) combinedResult.id = headingTarget.id;
                if (combinedResult.id) result = combinedResult;

                const resultId = (result && typeof result === 'object') ? result.id : result;
                if (resultId) ctx.previousId = resultId;

                const childCtx = {
                    ...ctx,
                    previousId: ctx.previousId,
                    parentId: (actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") ? resultId : ctx.parentId,
                    level: ctx.level + 1,
                    parentInfo: ((actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") && result && typeof result === 'object') ? result : ctx.parentInfo,
                    inheritedAttrs: currentItemResolved // Propagate inheritance to children even if skip update
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

            if ((actionType === "PUSH_TO_DOC" || actionType === "PUSH_COMBINED") && result && typeof result === 'object' && result.path) {
                docPaths.push(result.path);
                notebookId = result.notebook;
            }
        }

        if (docPaths.length > 0 && notebookId) {
            await changeSort(notebookId, docPaths);
        }
    }
}
