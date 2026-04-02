import { client } from "../../../shared/api-client";
import { escapeHtml } from "../../../shared/utils";
import { getProcessedDocIcon } from "../../../shared/utils/icon-utils";
import { IndexQueue, IndexQueueNode } from "../../../shared/utils/index-queue";
import { settings } from "../../../core/settings";
import { generateOutlineMarkdown } from "../outline/generator";
import { requestGetDocOutline, collectOutlineIds, getBlocksData } from "../../../shared/api-client/query";
import { StrategyRegistry, RenderContext } from "../../../shared/render/strategy";

export interface IndexConfig {
    depth?: number;
    listType?: string;
    linkType?: string;
    icon?: boolean;
}

export async function generateIndex(notebookId: any, ppath: any, pitem: IndexQueue, tab = 0, config?: IndexConfig) {
    const depth = config?.depth !== undefined ? config.depth : settings.get("depth");
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");
    const linkTypeSetting = config?.linkType !== undefined ? config.linkType : settings.get("linkType");
    const iconEnabled = config?.icon !== undefined ? config.icon : (settings.get("icon") ?? false);

    if (depth !== 0 && tab >= depth) return;

    let docs;
    try {
        docs = await client.listDocsByPath({
            notebook: notebookId,
            path: ppath
        });
    } catch (err) {
        console.error(`Failed to list docs for path "${ppath}":`, err);
        return;
    }

    if (!docs?.data?.files) return;

    const renderContext: RenderContext = {
        linkType: linkTypeSetting,
        iconEnabled: iconEnabled,
        listType: listTypeSetting as "unordered" | "ordered",
        isOutline: false
    };

    const strategy = StrategyRegistry.get(linkTypeSetting);
    tab++;

    for (let doc of docs.data.files) {
        const id = doc.id;
        const name = escapeHtml(doc.name.slice(0, -3));
        const subFileCount = doc.subFileCount;
        const path = doc.path;

        let indent = "";
        for (let n = 1; n < tab; n++) {
            indent += '    ';
        }

        const isTree = linkTypeSetting === "tree";
        let iconStr = (iconEnabled || isTree) ? getProcessedDocIcon(doc.icon, subFileCount != 0) : "";
        
        if (isTree && (!iconStr || (iconStr.startsWith(":") && iconStr.endsWith(":")))) {
            iconStr = subFileCount != 0 ? "📑" : "📄";
        }

        const renderItem = {
            id: id,
            text: name,
            anchor: iconStr || undefined
        };

        const markdown = strategy.render(renderItem, renderContext, indent) + "\n";
        
        let item = new IndexQueueNode(tab, markdown);
        pitem.push(item);

        if (subFileCount > 0) {
            await generateIndex(notebookId, path, item.children, tab, config);
        }
    }
}

export async function generateIndexAndOutline(notebookId: any, ppath: any, pitem: IndexQueue, tab = 0, config?: IndexConfig) {
    const depth = config?.depth !== undefined ? config.depth : settings.get("depth");
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");
    const linkTypeSetting = config?.linkType !== undefined ? config.linkType : settings.get("linkType");
    const iconEnabled = config?.icon !== undefined ? config.icon : (settings.get("icon") ?? false);

    if (depth !== 0 && tab >= depth) return;

    let docs;
    try {
        docs = await client.listDocsByPath({
            notebook: notebookId,
            path: ppath
        });
    } catch (err) {
        console.error(`Failed to list docs for path "${ppath}":`, err);
        return;
    }

    if (!docs?.data?.files?.length) return;

    const renderContext: RenderContext = {
        linkType: linkTypeSetting,
        iconEnabled: iconEnabled,
        listType: listTypeSetting as "unordered" | "ordered",
        isOutline: false
    };

    const strategy = StrategyRegistry.get(linkTypeSetting);
    tab++;

    for (let doc of docs.data.files) {
        try {
            const id = doc.id;
            const name = escapeHtml(doc.name.slice(0, -3));
            const subFileCount = doc.subFileCount;
            const path = doc.path;

            let indent = "";
            for (let n = 1; n < tab; n++) {
                indent += '    ';
            }

            const isTree = linkTypeSetting === "tree";
            let iconStr = (iconEnabled || isTree) ? getProcessedDocIcon(doc.icon, subFileCount != 0) : "";
            
            if (isTree && (!iconStr || (iconStr.startsWith(":") && iconStr.endsWith(":")))) {
                iconStr = subFileCount != 0 ? "📑" : "📄";
            }

            const renderItem = {
                id: id,
                text: name,
                anchor: iconStr || undefined
            };

            let markdown = strategy.render(renderItem, renderContext, indent) + "\n";

            const outlineData = await requestGetDocOutline(id);
            const outlineIds = collectOutlineIds(outlineData);
            const extraData = await getBlocksData(outlineIds);
            
            markdown += generateOutlineMarkdown(outlineData, tab, tab, extraData);

            let item = new IndexQueueNode(tab, markdown);
            pitem.push(item);

            if (subFileCount > 0) {
                await generateIndexAndOutline(notebookId, path, item.children, tab, config);
            }
        } catch (err) {
            console.error(`Failed to process document "${doc.id}"`, err);
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
