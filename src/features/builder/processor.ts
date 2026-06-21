import { client } from "../../shared/api-client";
import { getProcessedDocIcon } from "../../shared/utils/icon-utils";

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
    avCache: Map<string, any> = new Map();

    constructor(errors: string[]) {
        this.errors = errors;
    }

    async getLinkedAVData(listItemId: string, itemAttrs: any, avId?: string) {
        if (!avId) {
            const parentRes = await client.sql({ stmt: `SELECT parent_id FROM blocks WHERE id = '${listItemId}'` });
            const parentId = parentRes.data?.[0]?.parent_id;
            if (!parentId) return null;

            const parentAttrsRes = await client.getBlockAttrs({ id: parentId });
            avId = parentAttrsRes.data?.[ATTR_LINKED_AV];
        }

        if (!avId) return null;

        const itemId = itemAttrs[ATTR_ITEM_ID];
        if (!itemId) return null;

        if (!this.avCache.has(avId)) {
            this.avCache.set(avId, await getColIDMap(avId));
        }
        const { nameToID, keyValues } = this.avCache.get(avId);

        const result: any = {};

        // 1. Fetch values from AV using row ID stored in ATTR_ITEM_ID
        const keyMap: any = {};
        ["icon", "title-img", "template"].forEach(name => {
            const kn = Object.keys(nameToID).find(k => k.toLowerCase() === name.toLowerCase());
            if (kn) keyMap[name] = nameToID[kn];
        });

        if (Object.keys(keyMap).length > 0) {
            for (const [name, keyId] of Object.entries(keyMap)) {
                const kv = keyValues.find((v: any) => v.key.id === keyId);
                if (kv && kv.values) {
                    const cellVal = kv.values.find((v: any) => v.blockID === itemId);
                    if (cellVal) {
                        let finalVal = null;
                        if (cellVal.type === "text") finalVal = cellVal.text?.content;
                        else if (cellVal.type === "mAsset") finalVal = cellVal.mAsset?.[0]?.content;
                        else if (cellVal.type === "template") finalVal = cellVal.template?.content;
                        else if (cellVal.type === "select") finalVal = cellVal.mOption?.[0]?.content;
                        else if (cellVal.type === "mSelect") finalVal = cellVal.mOption?.map((o: any) => o.content).join(",");
                        else if (cellVal.content) finalVal = cellVal.content;

                        result[name] = finalVal;
                        // Build tool expects raw ID for weak inheritance
                        result[keyId as string] = finalVal;
                    }
                }
            }
        }

        return result;
    }

    parseIAL(ial: string) {
        const itemAttrs: any = {};
        if (ial) {
            const matches = ial.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g);
            for (const m of matches) {
                itemAttrs[m[1]] = m[2];
            }
        }
        return itemAttrs;
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

        let existingDocIcon = "";
        if (docId) {
            const checkRes = await client.sql({ stmt: `SELECT id, icon FROM blocks WHERE id = '${docId}' LIMIT 1` });
            if (!checkRes.data[0]) {
                docId = null;
            } else {
                existingDocIcon = checkRes.data[0].icon || "";
            }
        }

        let isDocEmpty = false;
        if (docId) {
            const checkRes = await client.sql({ stmt: `SELECT id, type, content FROM blocks WHERE root_id = '${docId}' AND parent_id = '${docId}' ORDER BY sort ASC LIMIT 2` });
            if (!checkRes.data || checkRes.data.length === 0) {
                isDocEmpty = true;
            } else if (checkRes.data.length === 1) {
                const b = checkRes.data[0];
                if (b.type === 'p' && (!b.content || b.content.trim() === '')) {
                    isDocEmpty = true;
                }
            }
        }

        const linkedData = await this.getLinkedAVData(core.containerId, containerAttrs, ctx.avId);
        let targetIcon = linkedData?.icon ? (/[^\u0000-\u007F]/.test(linkedData.icon) ? this.emojiToHex(linkedData.icon) : linkedData.icon) : (core.currentIcon ? this.emojiToHex(core.currentIcon) : null);

        // USER REQUEST: Ignore default text emojis 📄 and 📑 completely, as well as the separator ➖.
        if (targetIcon === "📄" || targetIcon === "📑" || targetIcon === "➖") {
            // Also need to check hex representation of these:
            // 📄 is 1f4c4
            // 📑 is 1f4d1
            // ➖ is 2796
            targetIcon = null;
        }
        if (targetIcon === "1f4c4" || targetIcon === "1f4d1" || targetIcon === "2796") {
            targetIcon = null;
        }

        // USER REQUEST: Ignore dynamic icons and custom SVG images
        if (targetIcon && (targetIcon.startsWith("api/icon/") || targetIcon.includes("."))) {
            targetIcon = null;
        }

        // Prevent default fallback icons from overwriting actual custom document image aliases
        // (This original check is now mostly redundant but kept for safety if someone uses other fallbacks)
        if ((core.currentIcon === "📄" || core.currentIcon === "📑") && existingDocIcon && (existingDocIcon.includes(".") || existingDocIcon.includes("/"))) {
            targetIcon = null;
        }

        let targetImage = linkedData?.["title-img"] || null;

        // GET TEMPLATE IF WE ARE CREATING A NEW DOCUMENT OR IF EXISTING DOCUMENT IS EMPTY
        const templatePath = ((!docId || isDocEmpty) && linkedData?.template) ? linkedData.template : "";

        let finalMarkdown = "";
        if (templatePath) {
            // @ts-ignore
            const dataDir = window.siyuan?.config?.system?.dataDir;
            let absPath = templatePath;
            if (dataDir) {
                let relPath = templatePath.startsWith("/") ? templatePath : "/" + templatePath;
                if (!relPath.startsWith("/templates/")) relPath = "/templates" + relPath;
                const fullPath = relPath.endsWith(".md") ? relPath : relPath + ".md";
                absPath = (dataDir + fullPath).replace(/\//g, "\\").replace(/\\\\/g, "\\");
            }
            try {
                const renderRes = await post("/api/template/render", { id: core.containerId, path: absPath, preview: false });
                const dom = renderRes.content || renderRes.dom || "";
                if (dom) {
                    // @ts-ignore
                    const lute = window.Lute.New();
                    finalMarkdown = lute.BlockDOM2Md(dom);
                    if (isDocEmpty && docId) {
                        try {
                            const checkRs = await client.sql({
                                stmt: `SELECT id, type, content FROM blocks WHERE root_id = '${docId}' AND parent_id = '${docId}' ORDER BY sort ASC`
                            });
                            let emptyBlockId: string | undefined;
                            if (checkRs.data && checkRs.data.length === 1) {
                                const b = checkRs.data[0];
                                if (b.type === 'p' && (!b.content || b.content.trim() === '')) {
                                    emptyBlockId = b.id;
                                }
                            }
                            await client.prependBlock({
                                data: finalMarkdown,
                                dataType: 'markdown',
                                parentID: docId
                            });
                            if (emptyBlockId) {
                                await client.deleteBlock({ id: emptyBlockId });
                            }
                        } catch (e) { console.error("[Builder] Failed to apply template to empty doc", e); }
                    }
                }
            } catch (e) {
                console.error("[Builder] Template render failed", e);
            }
        }

        const applyInherited = async (id: string, existingDocAttrs: any = {}) => {
            const resultOverrides: any = {};
            if (!ctx.inheritedAttrs) return resultOverrides;
            const docAttrs: any = { ...existingDocAttrs };
            let nameMap: any = null;
            if (ctx.avId && this.avCache.has(ctx.avId)) {
                const cached = this.avCache.get(ctx.avId);
                nameMap = cached.nameToID ? Object.fromEntries(Object.entries(cached.nameToID).map(([n, id]) => [id, n])) : null;
            }

            for (const [colId, resolvedVal] of Object.entries(ctx.inheritedAttrs as any)) {
                let valStr = "";
                if (resolvedVal) {
                    if (typeof resolvedVal === 'string') valStr = resolvedVal;
                    else if ((resolvedVal as any).text) valStr = (resolvedVal as any).text.content;
                    else if ((resolvedVal as any).number) valStr = String((resolvedVal as any).number.content);
                    else if ((resolvedVal as any).mOption) valStr = (resolvedVal as any).mOption.map((o: any) => o.content).join(",");
                    else if ((resolvedVal as any).content) valStr = (resolvedVal as any).content;
                }

                if (valStr) {
                    let attrName = colId;
                    if (nameMap && nameMap[colId]) attrName = nameMap[colId];
                    const systemNames = ["icon", "title-img", "template"];
                    const lowerName = attrName.toLowerCase();
                    if (systemNames.includes(lowerName)) {
                        if (lowerName === "icon" && /[^\u0000-\u007F]/.test(valStr)) {
                            valStr = this.emojiToHex(valStr);
                        }
                        docAttrs[lowerName] = valStr;
                        if (lowerName === "icon") resultOverrides.icon = valStr;
                        if (lowerName === "title-img") resultOverrides.titleImg = valStr;
                        if (lowerName === "template") resultOverrides.template = valStr;
                    } else {
                        attrName = `custom-${attrName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}`;
                        docAttrs[attrName] = valStr;
                    }
                }
            }
            if (Object.keys(docAttrs).length > 0) {
                await client.setBlockAttrs({ id, attrs: docAttrs });
            }
            return resultOverrides;
        };

        if (docId) {
            let notebook, path, hpath;
            try {
                const pathRes = await post("/api/filetree/getPathByID", { id: docId });
                // console.log(`[Builder-Debug] getPathByID for docId ${docId} returned:`, pathRes);
                if (pathRes) {
                    notebook = pathRes.notebook;
                    path = pathRes.path;
                    hpath = await post("/api/filetree/getHPathByID", { id: docId });
                    await client.renameDoc({ notebook, path, title });

                    const existingDocAttrs: any = {};
                    existingDocAttrs.icon = targetIcon || "";
                    existingDocAttrs["title-img"] = targetImage || "";

                    const overrides = await applyInherited(docId, existingDocAttrs);
                    if (overrides.icon !== undefined) targetIcon = overrides.icon;
                    if (overrides.titleImg !== undefined) targetImage = overrides.titleImg;
                }
            } catch (e) {
                console.error(`[Builder-Debug] Error updating existing document ${docId}:`, e);
            }
            const displayIcon = getProcessedDocIcon(targetIcon || core.currentIcon || "", false);
            const newMd = await this.constructListItemMarkdown(containerAttrs, containerAttrs[ATTR_OUTLINE], core.syncMd, docId, displayIcon);
            await client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd });
            if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep });
            return { id: docId, notebook, path, hpath };
        }

        let notebook, path, hpath = "";
        if (ctx.parentInfo) {
            notebook = ctx.parentInfo.notebook;
            hpath = `${ctx.parentInfo.hpath}/${title}`;
            path = hpath;
        } else if (ctx.parentId) {
            const parentPathRes = await post("/api/filetree/getPathByID", { id: ctx.parentId });
            const parentHPathRes = await post("/api/filetree/getHPathByID", { id: ctx.parentId });
            if (parentPathRes && parentHPathRes) {
                notebook = parentPathRes.notebook;
                hpath = `${parentHPathRes}/${title}`;
                path = hpath;
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
            } catch (e) { }
            await client.setBlockAttrs({ id: core.containerId, attrs: { [ATTR_INDEX]: newId } });

            const existingDocAttrs: any = {};
            existingDocAttrs.icon = targetIcon || "";
            existingDocAttrs["title-img"] = targetImage || "";

            const overrides = await applyInherited(newId, existingDocAttrs);
            if (overrides.icon !== undefined) targetIcon = overrides.icon;
            if (overrides.titleImg !== undefined) targetImage = overrides.titleImg;

            const displayIcon = getProcessedDocIcon(targetIcon || core.currentIcon || "", false);
            const newMd = await this.constructListItemMarkdown(containerAttrs, containerAttrs[ATTR_OUTLINE], core.syncMd, newId, displayIcon);
            await client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd });
            if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep });
            return { id: newId, notebook, path: physicalPath, hpath: hpath || path };
        }
        return null;
    }

    emojiToHex(icon: string) {
        if (!icon) return "";
        if (icon.includes(".") || icon.includes("/")) return icon;
        if (/[^\u0000-\u007F]/.test(icon)) return Array.from(icon).map(c => c.codePointAt(0)?.toString(16)).join("-");
        return icon;
    }

    async constructListItemMarkdown(_containerAttrs: any, headingId: string, syncText: string, docId?: string, docIcon?: string) {
        // Builder items ALWAYS use plain text for the body to avoid redundant links and infinite update loops.
        // The icon already provides the navigation link to the document.
        
        const parts = [];
        if (docId) {
            const icon = docIcon || DEFAULT_ICON;
            parts.push(`[${icon}](siyuan://blocks/${docId})`);
        }
        
        if (headingId) {
            parts.push(`[${SEP_CHAR}](siyuan://blocks/${headingId})`);
        } else {
            parts.push(SEP_CHAR);
        }
        
        // syncText is already scrubbed in parseItemContent
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
        if (!children || children.length === 0) return null;

        const sepRegex = /(\[➖\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)|➖)/;
        const iconRegex = /\s*\[.*?\]\(siyuan:\/\/blocks\/.*?\)\s*/;
        let targetBlock = children.find((child: any) => {
            const md = child.markdown || "";
            return sepRegex.test(md) || iconRegex.test(md);
        });
        if (!targetBlock) targetBlock = children[0];

        if (!targetBlock) return null; // Additional safety check

        const contentId = targetBlock.id;
        const md = targetBlock.markdown || "";
        const content = targetBlock.content || "";
        let tempMd = md.replace(/\{:[^}]+\}/g, "").trim();
        let hasSeparator = false;
        let currentIcon = null;
        const docLinkRegex = /^\s*\[(.*?)\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)\s*/;
        const docMatch = tempMd.match(docLinkRegex);
        if (docMatch) {
            const anchor = docMatch[1];
            if (anchor !== SEP_CHAR) {
                if (anchor && anchor.length < 8) currentIcon = anchor;
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
                if (emojiTest.test(prefix)) currentIcon = prefix;
            }
            tempMd = tempMd.replace(sepLinkRegex, "");
        }
        let syncMd = tempMd.trim();
        // Derive syncText from SQL `content` field.
        // STRIP all MD markers (refs, links) to treat the body as pure text for unified builder logic.
        const sepCharIdx = content.indexOf("➖");
        let rawSyncText = sepCharIdx !== -1
            ? content.substring(sepCharIdx + 1).trim()
            : content.replace(/^(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|:[^:]+:)\s*/u, "").trim();
        
        // Strip all MD link/ref markers to maintain pure-text syncText.
        // This regex handles various anchor styles and multi-level escaping that might occur in the SQL 'content' field.
        const syncText = rawSyncText
            // 1. Remove block references with specific anchors ((id "anchor")) or just ((id))
            .replace(/\(\([a-zA-Z0-9-]{16,22}(?:\s+.*?)?\)\)/g, (match) => {
                // Extract inner anchor text if present
                const innerMatch = match.match(/\(\([a-zA-Z0-9-]{16,22}\s+(.*)\)\)/);
                if (innerMatch && innerMatch[1]) {
                    // Strip potential outer quotes (including escaped ones)
                    let anchor = innerMatch[1].trim();
                    anchor = anchor.replace(/^(['"]|&quot;|&apos;)(.*)\1$/, "$2");
                    return anchor;
                }
                return "";
            })
            // 2. Remove standard Markdown links [text](url) and SiYuan-style links
            .replace(/\[(.*?)\]\((?:siyuan:\/\/blocks\/[a-zA-Z0-9-]+|#.*?|.*?)\)/g, "$1")
            // 3. Cleanup HTML-like artifacts of Dynamic Ref Spans
            .replace(/<span data-type="block-ref".*?>(.*?)<\/span>/g, "$1")
            .trim();

        return { containerId: listItemId, contentId: contentId, hasSeparator, syncText, syncMd, markdown: md, content: content, currentIcon };
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
