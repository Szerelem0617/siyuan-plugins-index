import { Dialog } from "siyuan";
import EntryConfigDialog from "./EntryConfigDialog.svelte";

export function openEntryConfigDialog(): void {
    const dialog = new Dialog({
        title: "入口配置",
        content: `<div id="entry-config-container" style="height: 100%;"></div>`,
        width: "720px",
        height: "600px"
    });
    dialog.element.classList.add("indexos-dialog");
    new EntryConfigDialog({
        target: dialog.element.querySelector("#entry-config-container")!,
        props: { dialog }
    });
}
