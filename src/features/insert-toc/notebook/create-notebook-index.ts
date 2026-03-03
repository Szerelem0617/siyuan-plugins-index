import { Dialog } from "siyuan";
import { client } from "../../../shared/api-client";
import { i18n, getDocid } from "../../../shared/utils";
import NotebookDialog from "../../../ui/components/dialog/notebook-dialog.svelte"
import { settings } from "../../../core/settings";
import { insertNotebookIndex } from "./action";

/**
 * 创建配置模板
 * @returns void
 */
export async function onCreatenbiButton() {
    getNotebookDialog();
}

/**
 * 接收模板名弹窗
 */
function getNotebookDialog() {
    const settingsDialog = "index-get-notebook";

    const dialog = new Dialog({
        title: i18n.settingsTab.items.notebookDialog.dialogtitle,
        content: `<div id="${settingsDialog}" class="b3-dialog__content">`,
        width: "70%",
    });
    let div: HTMLDivElement = dialog.element.querySelector(`#${settingsDialog}`);

    new NotebookDialog({
        target: div,
        props: {
            onSave: () => { onCreate(dialog) }
        }
    });
}

/**
 * 保存模板
 * @param dialog 弹窗
 * @returns void
 */
async function onCreate(dialog: Dialog) {

    //载入配置
    //寻找当前编辑的文档的id
    let parentId = getDocid();
    if (parentId == null) {
        client.pushErrMsg({
            msg: i18n.errorMsg_empty,
            timeout: 3000
        });
        return;
    }

    let el: HTMLInputElement = dialog.element.querySelector("#notebook-get");

    // Use new action from src
    const success = await insertNotebookIndex(parentId, el.value, {
        depth: settings.get("depthNotebook"),
        listType: settings.get("listTypeNotebook"),
        linkType: settings.get("linkTypeNotebook"),
        icon: settings.get("iconNotebook")
    });

    if (success) {
        client.pushMsg({
            msg: i18n.msg_success,
            timeout: 3000
        });
    } else {
        client.pushErrMsg({
            msg: i18n.errorMsg_miss,
            timeout: 3000
        });
    }

    dialog.destroy();
}