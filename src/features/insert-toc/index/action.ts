import { settings, CONFIG } from "../../../core/settings";
import { getDocid, i18n, plugin, confirmDialog, getAttrFromIAL } from "../../../shared/utils";
import { BlockService, client } from "../../../shared/api-client";
import { IndexQueue } from "../../../shared/utils/index-queue";
import { generateIndex, generateIndexAndOutline, queuePopAll } from "./generator";
import { onCreatenbiButton } from "../notebook/create-notebook-index";
import { bindTreeAttributes } from "../../../shared/utils/transformation-utils";

export async function insertAction(targetBlockId?: string) {
    await settings.load();
    const mode = settings.get("insertionMode");

    if (mode === "index_outline") {
        await insertIndexAndOutlineAction(targetBlockId);
        return;
    } else if (mode === "notebook") {
        // Use new notebook feature
        await onCreatenbiButton();
        return;
    } else if (mode === "tree") {
        await insertStaticTreeAction(targetBlockId);
        return;
    }

    let parentId = getDocid();
    if (!parentId) {
        // console.error("No doc ID"); 
        // Should show error msg
        return;
    }

    // Check for existing index to compare settings (Manual Insert/Update)
    console.log("[IndexPlugin] Checking for existing index...");
    let rs = await client.sql({
        stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND ial like '%custom-index-create%' order by updated desc limit 1`
    });

    if (rs.data[0]?.id != undefined) {
        console.log("[IndexPlugin] Found existing index:", rs.data[0].id);
        let ial = await client.getBlockAttrs({ id: rs.data[0].id });
        let str = ial.data["custom-index-create"];

        let localSettings: any = {};
        try {
            localSettings = JSON.parse(str);
            console.log("[IndexPlugin] Local settings:", localSettings);
        } catch (e) {
            console.error("[IndexPlugin] Error parsing settings", e);
        }

        const keysToCheck = ["depth", "listType", "linkType", "fold", "col", "icon"];
        let mismatch = false;
        for (const key of keysToCheck) {
            if (localSettings[key] !== settings.get(key)) {
                console.log(`[IndexPlugin] Mismatch on ${key}: Local=${localSettings[key]}, Global=${settings.get(key)}`);
                mismatch = true;
                break;
            }
        }

        if (mismatch) {
            await new Promise<void>((resolve) => {
                confirmDialog(i18n.confirmDialog.title, i18n.confirmDialog.content, () => {
                    console.log("[IndexPlugin] User confirmed update to Global");
                    resolve();
                }, () => {
                    console.log("[IndexPlugin] User kept Local settings");
                    settings.loadSettings(localSettings);
                    resolve();
                }, i18n.update, i18n.keep);
            });
        }
    } else {
        console.log("[IndexPlugin] No existing index found, creating new.");
    }

    let block = await client.getBlockInfo({ id: parentId });
    if (!block.data) return;

    let indexQueue = new IndexQueue();
    await generateIndex(block.data.box, block.data.path, indexQueue);
    let data = queuePopAll(indexQueue, "");

    if (data != '') {
        await BlockService.insertOrUpdate(
            parentId,
            data,
            "custom-index-create",
            plugin.data[CONFIG],
            "index",
            targetBlockId
        );
        // client.pushMsg({ msg: i18n.msg_success });
    } else {
        client.pushMsg({ msg: i18n.msg_no_index, timeout: 3000 });
        // client.pushErrMsg
    }
}

export async function insertIndexAndOutlineAction(targetBlockId?: string) {
    let parentId = getDocid();
    if (!parentId) return;

    let block = await client.getBlockInfo({ id: parentId });
    if (!block.data) return;

    let indexQueue = new IndexQueue();
    await generateIndexAndOutline(block.data.box, block.data.path, indexQueue);
    let data = queuePopAll(indexQueue, "");

    if (data != '') {
        // Legacy insertButton used insertDataSimple (Prepend, No Attr).
        // If we want to support Slash replacement, we should use BlockService but maybe without Attr?
        // Or just use prependBlock directly if we don't want to save "custom-index-create" for this mode?
        // Legacy behavior: No auto-update for Index+Outline.
        // So we just insert.

        if (targetBlockId) {
            await client.updateBlock({ data: data, dataType: "markdown", id: targetBlockId });
        } else {
            await client.prependBlock({ data: data, dataType: "markdown", parentID: parentId });
        }
        // client.pushMsg({ msg: i18n.msg_success });
    } else {
        client.pushMsg({ msg: i18n.msg_no_index, timeout: 3000 });
    }
}

export async function insertStaticTreeAction(targetBlockId?: string) {
    let parentId = getDocid();
    if (!parentId) return;

    let block = await client.getBlockInfo({ id: parentId });
    if (!block.data) return;

    // We force the generation logic to use "tree" mode regardless of other settings
    let indexQueue = new IndexQueue();
    await generateIndex(block.data.box, block.data.path, indexQueue, 0, { linkType: "tree" });
    let data = queuePopAll(indexQueue, "");

    if (data != '') {
        const treeConfig = {
            treeType: "doc-tree",
            // Keep builder disabled temporarily while we bind attributes to prevent concurrent indexing triggers
            builderAutoUpdate: false
        };

        const result = await BlockService.insertOrUpdate(
            parentId,
            data,
            "custom-tree-create",
            treeConfig,
            "index",
            targetBlockId
        );

        if (result && result.success && result.id) {
            // Bind all target document IDs to the list items synchronously from Memory DOM
            await bindTreeAttributes(result.id, "custom-index-subdoc-id");

            // Now safely enable the auto-update flag on the root container
            treeConfig.builderAutoUpdate = true;
            await client.setBlockAttrs({
                id: result.id,
                attrs: { "custom-tree-create": JSON.stringify(treeConfig) }
            });
        }
    } else {
        client.pushMsg({ msg: i18n.msg_no_index, timeout: 3000 });
    }
}

export async function autoUpdateIndex(notebookId: string, path: string, parentId: string, existingBlock?: any) {
    // await settings.load();
    console.log("[IndexPlugin] Auto-updating index for doc:", parentId);

    let id, ialStr;

    if (existingBlock) {
        id = existingBlock.id;
        ialStr = existingBlock.ial;
    } else {
        let rs = await client.sql({
            stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND ial like '%custom-index-create%' order by updated desc limit 1`
        });
        if (rs.data[0]?.id != undefined) {
            existingBlock = rs.data[0];
            id = rs.data[0].id;
            ialStr = rs.data[0].ial;
        }
    }

    if (id != undefined) {
        let str = getAttrFromIAL(ialStr, "custom-index-create");

        let localSettings: any = {};
        try {
            if (str) localSettings = JSON.parse(str);
        } catch (e) {
            console.error("Error parsing settings", e);
        }

        // Check if local autoUpdate is enabled
        if (localSettings.autoUpdate === false) {
            console.log("[IndexPlugin] Local autoUpdate is disabled. Skipping.");
            return;
        }

        // Auto-update always uses local settings without prompting
        settings.loadSettings(localSettings);

        if (!settings.get("autoUpdate")) return;

        let indexQueue = new IndexQueue();
        await generateIndex(notebookId, path, indexQueue);
        let data = queuePopAll(indexQueue, "");

        if (data != '') {
            await BlockService.insertOrUpdate(
                parentId,
                data,
                "custom-index-create",
                plugin.data[CONFIG],
                "index",
                undefined,
                existingBlock // Pass existing block info to skip SQL in BlockService
            );
        }
    }
}
