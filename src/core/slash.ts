import { Protyle } from "siyuan";
import { i18n, plugin, isMobile } from "../shared/utils";
import { insertAction } from "../features/insert-moc/index/action";
import { insertOutlineAction } from "../features/insert-moc/outline/action";
import { getInitSystemSlashCommand } from "../features/command/registration";
import { getInlineButtonSlashCommand } from "../features/command/global-registration/inline-button";

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

let dynamicSlashCommands: any[] = [];

export function updateDynamicSlashCommands(cmds: any[]) {
    dynamicSlashCommands = cmds;
    addSlash(); // rebuild the plugin.protyleSlash array
}

export function addSlash() {
    const protyleSlashContent: any[] = [{
        filter: ["insert index", "插入文档目录", "crawml"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.insertIndex}</span><span class="b3-list-item__meta">${isMobile ? "" : "Ctrl+Alt+I"}</span></div>`,
        id: "insertIndex",
        async callback(_protyle: Protyle) {
            const blockId = getCurrentBlockId();
            // NOTE: SiYuan clears the slash "/" text from the block BEFORE calling this callback.
            // Do NOT call protyle.insert("") here — it sends a redundant write that races with
            // our updateBlock call and can cause the index content to be lost on quick exit/file move.
            await insertAction(blockId);
        }
    }, {
        filter: ["insert outline", "插入文档大纲", "crawdg"],
        html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${i18n.insertoutline}</span><span class="b3-list-item__meta">${isMobile ? "" : "Ctrl+Alt+P"}</span></div>`,
        id: "insertOutline",
        async callback(_protyle: Protyle) {
            const blockId = getCurrentBlockId();
            await insertOutlineAction(blockId);
        }
    }];


    const initSysSlash = getInitSystemSlashCommand();
    if (initSysSlash) {
        protyleSlashContent.push(...initSysSlash);
    }

    const inlineBtnSlash = getInlineButtonSlashCommand();
    if (inlineBtnSlash) {
        protyleSlashContent.push(inlineBtnSlash);
    }

    // Append all dynamically injected commands (e.g., from DB-checked Inline Buttons)
    for (const dCmd of dynamicSlashCommands) {
        protyleSlashContent.push(dCmd);
    }

    plugin.protyleSlash = protyleSlashContent;
}