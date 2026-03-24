import { Protyle } from "siyuan";
import { i18n, plugin, isMobile } from "../shared/utils";
import { insertAction } from "../features/insert-toc/index/action";
import { insertOutlineAction } from "../features/insert-toc/outline/action";
import { getInitSystemSlashCommand } from "../features/command/registration";
import { getInlineButtonSlashCommand } from "../features/command/global-registration/inline-button";
// import { insert, insertDocButton } from "./creater/createIndex";

function getCurrentBlockId(): string | null {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return null;
    let node = selection.anchorNode;
    // Walk up the DOM tree from the text node to the element
    if (node.nodeType !== Node.ELEMENT_NODE) {
        node = node.parentElement;
    }
    // Find the closest ancestor with data-node-id
    const element = node as HTMLElement;
    const block = element.closest('[data-node-id]');
    return block ? block.getAttribute('data-node-id') : null;
}

export function addSlash() {
    const protyleSlashContent: any[] = [{
        filter: ["insert index", "插入文档目录", "crawml"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.insertIndex}</span><span class="b3-list-item__meta">${isMobile ? "" : "Ctrl+Alt+I"}</span></div>`,
        id: "insertIndex",
        callback(protyle: Protyle) {
            const blockId = getCurrentBlockId();
            console.log("[IndexPlugin] Slash insertIndex - blockId found:", blockId);
            protyle.insert("");
            insertAction(blockId);
        }
    }, {
        filter: ["insert outline", "插入文档大纲", "crawdg"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.insertoutline}</span><span class="b3-list-item__meta">${isMobile ? "" : "Ctrl+Alt+P"}</span></div>`,
        id: "insertOutline",
        callback(protyle: Protyle) {
            const blockId = getCurrentBlockId();
            console.log("[IndexPlugin] Slash insertOutline - blockId found:", blockId);
            protyle.insert("");
            insertOutlineAction(blockId);
        }
    }];

    const initSysSlash = getInitSystemSlashCommand();
    if (initSysSlash) {
        protyleSlashContent.push(initSysSlash);
    }

    protyleSlashContent.push(getInlineButtonSlashCommand());

    plugin.protyleSlash = protyleSlashContent;
}