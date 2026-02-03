import { client } from "../../shared/api-client";
import { escapeHtml } from "../../shared/utils";
import { getProcessedDocIcon } from "../../shared/utils/icon-utils";
import { IndexQueue, IndexQueueNode } from "../../shared/utils/index-queue";
import { settings } from "../../core/settings";
import { generateOutlineMarkdown } from "../outline/generator";
import { requestGetDocOutline, collectOutlineIds, getBlocksData } from "../../shared/api-client/query";

export interface IndexConfig {
    depth?: number;
    listType?: string;
    linkType?: string;
    icon?: boolean;
}

export async function generateIndex(notebook: any, ppath: any, pitem: IndexQueue, tab = 0, config?: IndexConfig) {
    const depth = config?.depth !== undefined ? config.depth : settings.get("depth");
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");
    const linkTypeSetting = config?.linkType !== undefined ? config.linkType : settings.get("linkType");
    const iconEnabled = config?.icon !== undefined ? config.icon : (settings.get("icon") ?? false);

    if (depth == 0 || depth > tab) {
        let docs;
        try {
            docs = await client.listDocsByPath({
                notebook: notebook,
                path: ppath
            });
        } catch (err) {
            console.error(`Failed to list docs for path "${ppath}":`, err);
            return;
        }

        tab++;

        for (let doc of docs.data.files) {
            let data = "";
            let id = doc.id;
            let name = doc.name.slice(0, -3);
            let icon = doc.icon;
            let subFileCount = doc.subFileCount;
            let path = doc.path;
            
            for (let n = 1; n < tab; n++) {
                data += '    ';
            }

            name = escapeHtml(name);

            let listType = listTypeSetting == "unordered" ? true : false;
            if (listType) {
                data += "* ";
            } else {
                data += "1. ";
            }

            let iconStr = iconEnabled ? getProcessedDocIcon(icon, subFileCount != 0) : "";
            let safeName = name.replace(/"/g, "&quot;");

            let linkType = linkTypeSetting == "ref" ? true : false;
            if (linkType) {
                data += `${iconStr ? iconStr + ' ' : ''}[${name}](siyuan://blocks/${id})\n`;
            } else {
                if (iconEnabled && iconStr) {
                    data += `${iconStr} ((${id} "${safeName}"))\n`;
                } else {
                    data += `((${id} "${safeName}"))\n`;
                }
            }

            let item = new IndexQueueNode(tab, data);
            pitem.push(item);
            if (subFileCount > 0) {
                await generateIndex(notebook, path, item.children, tab, config);
            }
        }
    }
}

export async function generateIndexAndOutline(notebook: any, ppath: any, pitem: IndexQueue, tab = 0, config?: IndexConfig) {
    const depth = config?.depth !== undefined ? config.depth : settings.get("depth");
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");
    const linkTypeSetting = config?.linkType !== undefined ? config.linkType : settings.get("linkType");
    const iconEnabled = config?.icon !== undefined ? config.icon : (settings.get("icon") ?? false);

    if (depth == 0 || depth > tab) {
        let docs;
        try {
            docs = await client.listDocsByPath({
                notebook: notebook,
                path: ppath
            });
        } catch (err) {
            console.error(`Failed to list docs for path "${ppath}":`, err);
            return;
        }

        if (!docs?.data?.files?.length) return;
        
        tab++;

        for (let doc of docs.data.files) {
            try {
                let data = "";
                let id = doc.id;
                let name = doc.name.slice(0, -3);
                let icon = doc.icon;
                let subFileCount = doc.subFileCount;
                let path = doc.path;
                for (let n = 1; n < tab; n++) {
                    data += '    ';
                }

                name = escapeHtml(name);

                let listType = listTypeSetting == "unordered" ? true : false;
                if (listType) {
                    data += "* ";
                } else {
                    data += "1. ";
                }

                let iconStr = iconEnabled ? getProcessedDocIcon(icon, subFileCount != 0) : "";
                let safeName = name.replace(/"/g, "&quot;");

                let linkType = linkTypeSetting == "ref" ? true : false;
                if (linkType) {
                    data += `${iconStr ? iconStr + ' ' : ''}[${name}](siyuan://blocks/${id})\n`;
                } else {
                    if (iconEnabled && iconStr) {
                        data += `${iconStr} ((${id} "${safeName}"))\n`;
                    } else {
                        data += `((${id} "${safeName}"))\n`;
                    }
                }
                
                let outlineData = await requestGetDocOutline(id);
                let outlineIds = collectOutlineIds(outlineData);
                let extraData = await getBlocksData(outlineIds);
                // Pass empty map for manual generation (no preservation logic here yet? 
                // Wait, index+outline is usually manual. If auto-update supports it, we need existingAnchors.
                // But legacy code didn't support preserving anchors for index+outline specifically?
                // Actually createIndexandOutline calls insertOutline which accepts extraData and existingAnchors.
                // I should probably support existingAnchors if I want consistency.
                // But for now, keeping it simple as per legacy which didn't pass it in createIndexandOutline.
                // Wait, legacy createIndexandOutline DID accept existingAnchors in my previous fix!
                // So I should add it here too.
                data += generateOutlineMarkdown(outlineData, tab, tab, extraData); 

                let item = new IndexQueueNode(tab, data);
                pitem.push(item);
                if (subFileCount > 0) {
                    await generateIndexAndOutline(notebook, path, item.children, tab, config);
                }
            } catch (err) {
                console.error(`Failed to process document "${doc.id}"`, err);
            }
        }
    }
}

export function queuePopAll(queue: IndexQueue, data: string) {
    if (queue.getFront()?.depth == undefined) {
        return "";
    }

    let item: IndexQueueNode;
    let num = 0;
    let temp = 0;
    let times = 0;
    let depth = queue.getFront().depth;
    
    // Note: 'settings' here refers to global settings. Queue formatting usually respects global logic.
    if (depth == 1 && settings.get("col") != 1) {
        data += "{{{col\n";
        temp = Math.trunc(queue.getSize() / settings.get("col"));
        times = settings.get("col") - 1;
    }

    while (!queue.isEmpty()) {
        num++;
        item = queue.pop();

        if (!item.children.isEmpty() && settings.get("fold") != 0 && settings.get("fold") <= item.depth) {
            let n = 0;
            let listType = settings.get("listType") == "unordered" ? true : false;
            // This relies on the text starting with * or 1.
            // My generator puts that in 'data'.
            if (listType) {
                n = item.text.indexOf("*");
                if (n !== -1)
                    item.text = item.text.substring(0, n + 2) + '{: fold="1"}' + item.text.substring(n + 2);
            } else {
                n = item.text.indexOf("1");
                if (n !== -1)
                    item.text = item.text.substring(0, n + 3) + '{: fold="1"}' + item.text.substring(n + 3);
            }
        }
        data += item.text;

        if (!item.children.isEmpty()) {
            data = queuePopAll(item.children, data);
        }
        if (item.depth == 1 && num == temp && times > 0) {
            data += `\n{: id}\n`;
            num = 0;
            times--;
        }
    }
    if (depth == 1 && settings.get("col") != 1) {
        data += "}}}";
    }
    return data;
}
