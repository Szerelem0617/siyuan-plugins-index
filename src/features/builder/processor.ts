import { client } from "../../shared/api-client";
import { getProcessedDocIcon } from "../../shared/utils/icon-utils";
import { stripMarkdownSyntax } from "../../shared/utils/markdown-utils";
import { ATTR_LINKED_AV, ATTR_ITEM_ID } from "../../shared/constants";
import { getColIDMap } from "../../shared/utils/av-utils";

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
    avCache: Map<string, any> = new Map(); // Cache for AV data to support "all data" logic

    constructor(errors: string[]) {
        this.errors = errors;
    }

    async getLinkedAVData(listItemId: string, itemAttrs: any, avId?: string) {
        if (!avId) {
            // 1. Get Parent to find AV ID
            const parentRes = await client.sql({ stmt: `SELECT parent_id FROM blocks WHERE id = '${listItemId}'` });
            const parentId = parentRes.data?.[0]?.parent_id;
            if (!parentId) return null;

            const parentAttrsRes = await client.getBlockAttrs({ id: parentId });
            avId = parentAttrsRes.data?.[ATTR_LINKED_AV];
        }

        if (!avId) return null;

        const itemId = itemAttrs[ATTR_ITEM_ID];
        if (!itemId) return null;

        // 2. Use cached full AV data
        if (!this.avCache.has(avId)) {
            this.avCache.set(avId, await getColIDMap(avId));
        }
        const { nameToID, keyValues } = this.avCache.get(avId);

        const result: any = {};

        // Return standard raw data keyed by ColID
        if (keyValues) {
            for (const kv of keyValues) {
                const colId = kv.key.id;
                const cellVal = kv.values.find((v: any) => v.blockID === itemId);
                if (cellVal) {
                    if (cellVal.type === "text") result[colId] = cellVal.text?.content;
                    else if (cellVal.type === "mAsset") result[colId] = cellVal.mAsset?.[0]?.content;
                    else if (cellVal.type === "template") result[colId] = cellVal.template?.content;
                    // selects
                    else if (cellVal.type === "select") result[colId] = cellVal.mOption?.[0]?.content;
                    else if (cellVal.type === "mSelect") result[colId] = cellVal.mOption?.map((o: any) => o.content).join(",");

                    else if (cellVal.content) result[colId] = cellVal.content;
                }
            }
        }

        // Map named properties (legacy support and for specific logic)
        ["icon", "title-img", "template"].forEach(name => {
            const kn = Object.keys(nameToID).find(k => k.toLowerCase() === name.toLowerCase());
            if (kn) {
                const colId = nameToID[kn];
                if (result[colId]) result[name] = result[colId];
            }
        });

        return result;
    }

    async processSingleItem(listItemId: string, actionType: string, ctx: any) {
        const core = await this.getCoreContentInfo(listItemId);
        if (!core) return ctx.previousId;

        const containerAttrsRes = await client.getBlockAttrs({ id: core.containerId });
        const containerAttrs = containerAttrsRes.data;
        let result = ctx.previousId;

        switch (actionType) {
            case "PUSH_TO_DOC":
                result = await this.handlePushToDoc(core, containerAttrs, ctx);
                break;
            case "PUSH_TO_BOTTOM":
                result = await this.handlePushToBottom(core, containerAttrs, ctx);
                break;
            case "PUSH_COMBINED":
                const docResult = await this.handlePushToDoc(core, containerAttrs, ctx);
                const headingId = await this.handlePushToBottom(core, containerAttrs, ctx);
                result = { ...docResult, id: headingId };
                break;
        }
        return result || ctx.previousId;
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
                const promises = [];
                promises.push(client.setBlockAttrs({ id: core.containerId, attrs: { [ATTR_OUTLINE]: targetId } }));
                if (Object.keys(stylesToKeep).length > 0) promises.push(client.setBlockAttrs({ id: targetId, attrs: stylesToKeep }));
                await Promise.all(promises);
            }
        } else {
            await client.updateBlock({ id: targetId, dataType: "markdown", data: titleContent });
            if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: targetId, attrs: stylesToKeep });
        }

        const finalMd = await this.constructListItemMarkdown(containerAttrs, targetId, core.syncMd, undefined, core.currentIcon);
        const updatePromises = [];
        updatePromises.push(client.updateBlock({ id: core.contentId, dataType: "markdown", data: finalMd }));
        if (Object.keys(stylesToKeep).length > 0) updatePromises.push(client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep }));
        await Promise.all(updatePromises);

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

        // Fetch Linked AV Data
        const linkedData = await this.getLinkedAVData(core.containerId, containerAttrs, ctx.avId);
        const targetIcon = linkedData?.icon ? (/[^\u0000-\u007F]/.test(linkedData.icon) ? this.emojiToHex(linkedData.icon) : linkedData.icon) : (core.currentIcon ? this.emojiToHex(core.currentIcon) : null);

        // Revert to direct assignment as complex styles (like gradients) are already formatted in DB
        const targetImage = linkedData?.["title-img"] || null;

        const templatePath = linkedData?.template || "";

        let finalMarkdown = "";
        if (templatePath) {
            // @ts-ignore
            const dataDir = window.siyuan?.config?.system?.dataDir;
            let absPath = templatePath;

            if (dataDir) {
                let relPath = templatePath.startsWith("/") ? templatePath : "/" + templatePath;
                // SiYuan templates are always stored in the 'templates' subfolder of the data directory.
                // If the stored path doesn't include it, we must prepend it.
                if (!relPath.startsWith("/templates/")) {
                    relPath = "/templates" + relPath;
                }
                const fullPath = relPath.endsWith(".md") ? relPath : relPath + ".md";

                // Construct absolute path and normalize to Windows backslashes
                absPath = (dataDir + fullPath).replace(/\//g, "\\").replace(/\\\\/g, "\\");
            }

            console.log("[Builder] Rendering template with absolute path:", absPath);
            try {
                const renderRes = await post("/api/template/render", {
                    id: core.containerId,
                    path: absPath,
                    preview: false
                });
                const dom = renderRes.content || renderRes.dom || "";
                if (dom) {
                    // Convert Protyle DOM to Markdown using Lute
                    // @ts-ignore
                    const lute = window.Lute.New();
                    finalMarkdown = lute.BlockDOM2Md(dom);
                }
            } catch (e) {
                console.error("[Builder] Template render failed for path:", absPath, e);
            }
        }

        if (docId) {
            let notebook, path, hpath;
            try {
                const pathRes = await post("/api/filetree/getPathByID", { id: docId });
                if (pathRes) {
                    notebook = pathRes.notebook;
                    path = pathRes.path;
                    hpath = await post("/api/filetree/getHPathByID", { id: docId });

                    await client.renameDoc({ notebook, path, title });

                    const docAttrs: any = {};
                    if (targetIcon) docAttrs.icon = targetIcon;
                    if (targetImage) docAttrs["title-img"] = targetImage;

                    // Apply Inherited Attributes for Existing Doc
                    if (ctx.inheritedAttrs) {
                        let nameMap: any = null;
                        if (ctx.avId && this.avCache.has(ctx.avId)) {
                            const cached = this.avCache.get(ctx.avId);
                            nameMap = {};
                            // @ts-ignore
                            for (const [name, id] of Object.entries(cached.nameToID)) {
                                // @ts-ignore
                                nameMap[id] = name;
                            }
                        }

                        for (const [colId, rule] of Object.entries(ctx.inheritedAttrs as any)) {
                            const valStr = (rule as any).value;
                            const mode = (rule as any).mode;

                            let attrName = colId;
                            if (nameMap && nameMap[colId]) attrName = nameMap[colId];
                            attrName = attrName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
                            attrName = `custom-${attrName}`;

                            // For existing doc, we might want to check existence for Weak mode.
                            // For simplicity/performance in this iteration, we treat Weak as Strong (overwrite).
                            // Optimization: In future, fetch doc attrs to check.

                            if (mode === 'strong' || mode === 'weak') {
                                docAttrs[attrName] = valStr;
                            }
                        }
                    }

                    if (Object.keys(docAttrs).length > 0) {
                        await client.setBlockAttrs({ id: docId, attrs: docAttrs });
                    }
                }
            } catch (e) {
                console.error("[Sync] Rename/Icon Sync failed:", e);
            }

            const displayIcon = getProcessedDocIcon(targetIcon || core.currentIcon || "", false);
            const newMd = await this.constructListItemMarkdown(containerAttrs, containerAttrs[ATTR_OUTLINE], core.syncMd, docId, displayIcon);
            const updatePromises = [];
            updatePromises.push(client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd }));
            if (Object.keys(stylesToKeep).length > 0) updatePromises.push(client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep }));
            await Promise.all(updatePromises);
            return { id: docId, notebook, path, hpath };
        }

        let notebook, path;
        let hpath = "";

        if (ctx.parentInfo) {
            notebook = ctx.parentInfo.notebook;
            hpath = `${ctx.parentInfo.hpath}/${title}`;
            path = hpath;
        }

        if (!notebook || !path) {
            if (ctx.parentId) {
                const parentPathRes = await post("/api/filetree/getPathByID", { id: ctx.parentId });
                const parentHPathRes = await post("/api/filetree/getHPathByID", { id: ctx.parentId });
                if (parentPathRes && parentHPathRes) {
                    notebook = parentPathRes.notebook;
                    hpath = `${parentHPathRes}/${title}`;
                    path = hpath;
                }
            }
        }

        if (!notebook || !path) {
            const hPathRes = await post("/api/filetree/getHPathByID", { id: core.containerId });
            const pathRes = await post("/api/filetree/getPathByID", { id: core.containerId });
            notebook = pathRes.notebook;
            hpath = `${hPathRes}/${title}`;
            path = hpath;
        }

        const newIdRes = await client.createDocWithMd({ notebook, path, markdown: finalMarkdown });
        const newId = newIdRes.data;

        if (newId) {
            let physicalPath = null;
            try {
                const pRes = await post("/api/filetree/getPathByID", { id: newId });
                if (pRes) physicalPath = pRes.path;
            } catch (e) {
                console.error("Failed to get physical path for new doc", e);
            }

            const promises = [];
            promises.push(client.setBlockAttrs({ id: core.containerId, attrs: { [ATTR_INDEX]: newId } }));

            const docAttrs: any = {};
            if (targetIcon) docAttrs.icon = targetIcon;
            if (targetImage) docAttrs["title-img"] = targetImage;

            if (Object.keys(docAttrs).length > 0) {
                promises.push(client.setBlockAttrs({ id: newId, attrs: docAttrs }));
            }

            // Apply Inherited Attributes for New Doc
            if (ctx.inheritedAttrs) {
                const inherited: any = {};
                let nameMap: any = null;
                if (ctx.avId && this.avCache.has(ctx.avId)) {
                    const cached = this.avCache.get(ctx.avId);
                    nameMap = {};
                    // @ts-ignore
                    for (const [name, id] of Object.entries(cached.nameToID)) {
                        // @ts-ignore
                        nameMap[id] = name;
                    }
                }

                for (const [colId, rule] of Object.entries(ctx.inheritedAttrs as any)) {
                    const valStr = (rule as any).value;
                    // For New Doc, Weak and Strong are mostly same (Doc is empty), unless default attrs exist.
                    // We just set it.

                    let attrName = colId;
                    if (nameMap && nameMap[colId]) attrName = nameMap[colId];
                    attrName = attrName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
                    attrName = `custom-${attrName}`;

                    inherited[attrName] = valStr;
                }

                if (Object.keys(inherited).length > 0) {
                    promises.push(client.setBlockAttrs({ id: newId, attrs: inherited }));
                }
            }

            await Promise.all(promises);

            const displayIcon = getProcessedDocIcon(targetIcon || core.currentIcon || "", false);
            const newMd = await this.constructListItemMarkdown(containerAttrs, containerAttrs[ATTR_OUTLINE], core.syncMd, newId, displayIcon);
            const updatePromises = [];
            updatePromises.push(client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd }));
            if (Object.keys(stylesToKeep).length > 0) updatePromises.push(client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep }));
            await Promise.all(updatePromises);

            return { id: newId, notebook, path: physicalPath, hpath: hpath || path };
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

    async constructListItemMarkdown(containerAttrs: any, headingId: string, syncText: string, docId?: string, docIcon?: string) {
        const parts = [];

        if (!docId) docId = containerAttrs[ATTR_INDEX];

        if (docId) {
            let icon = docIcon || DEFAULT_ICON;
            if (!docIcon) {
                try {
                    const docInfoRes = await client.getBlockAttrs({ id: docId });
                    const rawIcon = docInfoRes.data.icon || DEFAULT_ICON;
                    icon = getProcessedDocIcon(rawIcon, false);
                } catch (e) {
                }
            }
            parts.push(`[${icon}](siyuan://blocks/${docId})`);
        } else if (docIcon) {
            parts.push(docIcon);
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

        return this.parseItemContent(listItemId, children);
    }

    parseItemContent(listItemId: string, children: any[]) {
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
        let currentIcon = null;

        const docLinkRegex = /^\s*\[(.*?)\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)\s*/;
        const docMatch = tempMd.match(docLinkRegex);
        if (docMatch) {
            const anchor = docMatch[1];
            if (anchor !== SEP_CHAR) {
                if (anchor && anchor.length < 8) {
                    currentIcon = anchor;
                }
                tempMd = tempMd.replace(docLinkRegex, "");
            }
        } else {
            const explicitIconRegex = /^\s*(?:(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation})|(:[^:]+:))\s*/u;
            const iconMatch = tempMd.match(explicitIconRegex);
            if (iconMatch) {
                currentIcon = iconMatch[1] || iconMatch[2];
                tempMd = tempMd.replace(explicitIconRegex, "");
            }
        }

        const sepLinkRegex = /^(.*?)(\[➖\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)|➖)\s*/u;
        const sepMatch = tempMd.match(sepLinkRegex);
        if (sepMatch) {
            hasSeparator = true;
            const prefix = sepMatch[1].trim();
            if (!currentIcon && prefix) {
                const emojiTest = /^(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|:[^:]+:)$/u;
                if (emojiTest.test(prefix)) {
                    currentIcon = prefix;
                }
            }
            tempMd = tempMd.replace(sepLinkRegex, "");
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