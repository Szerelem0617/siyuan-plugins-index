import { client } from "../../shared/api-client";
import { getProcessedDocIcon } from "../../shared/utils/icon-utils";
import { stripMarkdownSyntax } from "../../shared/utils/markdown-utils";

// Constants
export const ATTR_INDEX = "custom-index-subdoc-id";
export const ATTR_OUTLINE = "custom-index-heading-id";
export const SEP_CHAR = "➖";
export const DEFAULT_ICON = "📄";

// API Helper
async function post(url: string, data: any) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    const res = await response.json();
    if (res.code !== 0) throw new Error(res.msg);
    return res.data;
}

export class IBlockProcessor {
    errors: string[];

    constructor(errors: string[]) {
        this.errors = errors;
    }

    async processSingleItem(listItemId: string, actionType: string, ctx: any) {
        const core = await this.getCoreContentInfo(listItemId);
        if (!core) return ctx.previousId;

        const containerAttrsRes = await client.getBlockAttrs({ id: core.containerId });
        const containerAttrs = containerAttrsRes.data;
        let resultId = ctx.previousId;

        switch (actionType) {
            case "PUSH_TO_DOC":
                resultId = await this.handlePushToDoc(core, containerAttrs, ctx);
                break;
            case "PUSH_TO_BOTTOM":
                resultId = await this.handlePushToBottom(core, containerAttrs, ctx);
                break;
        }
        return resultId || ctx.previousId;
    }

    async handlePushToBottom(core: any, containerAttrs: any, ctx: any) {
        let contentToPush = core.syncMd;
        if (!contentToPush) contentToPush = "Untitled";

        const prefix = "#".repeat(Math.min(ctx.level, 6));
        const titleContent = `${prefix} ${contentToPush}`; 
        
        const coreAttrsRes = await client.getBlockAttrs({ id: core.contentId });
        const stylesToKeep = this.filterSystemAttrs(coreAttrsRes.data);
        let targetId = containerAttrs[ATTR_OUTLINE];
        const previousTargetId = ctx.previousId;

        let targetExists = false;
        if (targetId) {
             const checkRes = await client.sql({ stmt: `SELECT id FROM blocks WHERE id = '${targetId}' LIMIT 1` });
             targetExists = !!checkRes.data[0];
        }

        if (!targetId || !targetExists) {
            let r;
            if (previousTargetId) {
                r = await client.insertBlock({ previousID: previousTargetId, dataType: "markdown", data: titleContent });
            } else {
                const rootIdRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${core.containerId}' LIMIT 1` });
                const rootId = rootIdRes.data[0]?.root_id;
                r = await client.appendBlock({ parentID: rootId, dataType: "markdown", data: titleContent });
            }
            
            targetId = r?.data?.[0]?.doOperations?.[0]?.id;
            if (targetId) {
                await client.setBlockAttrs({ id: core.containerId, attrs: { [ATTR_OUTLINE]: targetId } });
                if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: targetId, attrs: stylesToKeep });
            }
        } else {
            await client.updateBlock({ id: targetId, dataType: "markdown", data: titleContent });
            if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: targetId, attrs: stylesToKeep });
        }

        const finalMd = await this.constructListItemMarkdown(core.containerId, targetId, core.syncMd);
        await client.updateBlock({ id: core.contentId, dataType: "markdown", data: finalMd });
        if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep });

        return targetId;
    }

    async handlePushToDoc(core: any, containerAttrs: any, ctx: any) {
        const title = core.syncText;
        if (!title) return null;

        const coreAttrsRes = await client.getBlockAttrs({ id: core.contentId });
        const stylesToKeep = this.filterSystemAttrs(coreAttrsRes.data);
        let docId = containerAttrs[ATTR_INDEX];
        
        if (docId) {
            const checkRes = await client.sql({ stmt: `SELECT id FROM blocks WHERE id = '${docId}' LIMIT 1` });
            if (!checkRes.data[0]) {
                docId = null;
            }
        }

        if (docId) {
            try {
                const pathRes = await post("/api/filetree/getPathByID", { id: docId });
                if (pathRes) {
                    const { notebook, path } = pathRes;
                    await client.renameDoc({ notebook, path, title });
                    
                    const verifyRes = await client.getBlockAttrs({ id: docId });
                    const docIconRaw = verifyRes?.data?.icon || "";

                    if (core.currentIcon) {
                        const resolvedDocIcon = getProcessedDocIcon(docIconRaw, false); // Using utility
                        if (resolvedDocIcon !== core.currentIcon) {
                            const iconToSend = this.emojiToHex(core.currentIcon);
                            await client.setBlockAttrs({ id: docId, attrs: { icon: iconToSend } });
                        }
                    }
                }
            } catch (e) {
                console.error("[Sync] Rename/Icon Sync failed:", e);
            }
            
            const newMd = await this.constructListItemMarkdown(core.containerId, containerAttrs[ATTR_OUTLINE], core.syncMd);
            await client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd });
            if(Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep });
            return docId;
        }

        let notebook, path;
        if (ctx.parentId) {
            const parentPathRes = await post("/api/filetree/getPathByID", { id: ctx.parentId });
            const parentHPathRes = await post("/api/filetree/getHPathByID", { id: ctx.parentId });
            if (parentPathRes && parentHPathRes) {
                notebook = parentPathRes.notebook;
                path = `${parentHPathRes}/${title}`;
            }
        } 
        if (!notebook || !path) {
            const hPathRes = await post("/api/filetree/getHPathByID", { id: core.containerId });
            const pathRes = await post("/api/filetree/getPathByID", { id: core.containerId });
            notebook = pathRes.notebook;
            path = `${hPathRes}/${title}`;
        }

        const newIdRes = await client.createDocWithMd({ notebook, path, markdown: "" });
        const newId = newIdRes.data;

        if (newId) {
            await client.setBlockAttrs({ id: core.containerId, attrs: { [ATTR_INDEX]: newId } });
            
             if (core.currentIcon) {
                const iconToSend = this.emojiToHex(core.currentIcon);
                await client.setBlockAttrs({ id: newId, attrs: { icon: iconToSend } });
            }

            const newMd = await this.constructListItemMarkdown(core.containerId, containerAttrs[ATTR_OUTLINE], core.syncMd);
            await client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd });
            if(Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep });
            return newId;
        }
        return null;
    }

    emojiToHex(icon: string) {
         if (!icon) return "";
         if (icon.includes(".") || icon.includes("/")) return icon; 
         if (/[^\u0000-\u007F]/.test(icon)) {
             return Array.from(icon).map(c => c.codePointAt(0)?.toString(16)).join("-");
         }
         return icon;
    }

    async constructListItemMarkdown(containerId: string, headingId: string, syncText: string) {
        const parts = [];
        const containerAttrsRes = await client.getBlockAttrs({ id: containerId });
        const containerAttrs = containerAttrsRes.data;
        const docId = containerAttrs[ATTR_INDEX];
        
        if (docId) {
            let icon = DEFAULT_ICON;
            try {
                 const docInfoRes = await client.getBlockAttrs({ id: docId });
                 const rawIcon = docInfoRes.data.icon || DEFAULT_ICON;
                 icon = getProcessedDocIcon(rawIcon, false);
            } catch(e) {
                console.error("[Sync] Failed to get doc icon:", e);
            }
            parts.push(`[${icon}](siyuan://blocks/${docId})`);
        }

        if (headingId) {
            parts.push(`[${SEP_CHAR}](siyuan://blocks/${headingId})`);
        } else {
            parts.push(SEP_CHAR);
        }
        parts.push(syncText.trim());
        return parts.join(" ");
    }

    async getCoreContentInfo(listItemId: string) {
        const selfRes = await client.sql({ stmt: `SELECT type FROM blocks WHERE id = '${listItemId}' LIMIT 1` });
        if (!selfRes.data[0] || selfRes.data[0].type !== "i") return null;

        const childrenRes = await client.sql({
            stmt: `SELECT id, type, markdown, content FROM blocks WHERE parent_id = '${listItemId}' AND type = 'p' ORDER BY sort ASC`
        });
        const children = childrenRes.data;
        if (!children || children.length === 0) return null;

        const sepRegex = /(\[➖\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)|➖)/;
        const iconRegex = /\s*\[.*?\]\(siyuan:\/\/blocks\/.*?\)\s*/; 

        let targetBlock = children.find((child: any) => {
            const md = child.markdown || "";
            return sepRegex.test(md) || iconRegex.test(md);
        });
        if (!targetBlock) targetBlock = children[0];

        const contentId = targetBlock.id;
        const md = targetBlock.markdown || "";
        const content = targetBlock.content || "";
        
        let tempMd = md.replace(/\s*\{:[^}]+\}\s*$/, "");
        let hasSeparator = false;

        const docLinkRegex = /^\s*\[.*?\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)\s*/;
        if (docLinkRegex.test(tempMd)) {
            tempMd = tempMd.replace(docLinkRegex, "");
        }

        const sepLinkRegex = /^\s*(\[➖\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)|➖)\s*/;
        if (sepLinkRegex.test(tempMd)) {
            hasSeparator = true;
            tempMd = tempMd.replace(sepLinkRegex, "");
        }

        let currentIcon = null;
        const explicitIconRegex = /^(?:([\uD800-\uDBFF][\uDC00-\uDFFF])|(:[^:]+:)|\[(.*?)\]\(siyuan:\/\/blocks\/.*?\))\s*/;
        const iconMatch = tempMd.match(explicitIconRegex);
        
        if (iconMatch) {
            currentIcon = iconMatch[1] || iconMatch[2] || iconMatch[3];
        }

        let syncMd = tempMd.trim();
        let plain = stripMarkdownSyntax(syncMd);

        return {
            containerId: listItemId,
            contentId: contentId,
            hasSeparator,
            syncText: plain.trim(),
            syncMd,
            markdown: md, 
            content: content,
            currentIcon 
        };
    }

    filterSystemAttrs(attrs: any) {
        const validAttrs: any = {};
        const whitelist = new Set(["style", "class"]);
        for (const [key, val] of Object.entries(attrs)) {
            if (whitelist.has(key)) validAttrs[key] = val;
        }
        return validAttrs;
    }
}
