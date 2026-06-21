import { settings } from "../../../core/settings";
import { getDocid, i18n, confirmDialog, getAttrFromIAL } from "../../../shared/utils";
import { BlockService, client } from "../../../shared/api-client";
import { IndexQueue } from "../../../shared/utils/index-queue";
import { generateIndex, queuePopAll } from "./generator";

export async function insertAction(targetBlockId?: string) {
    await settings.load();
    let forceLocalConfig: any = null;


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
        // console.log("[IndexPlugin] Found existing index:", rs.data[0].id);
        let ial = await client.getBlockAttrs({ id: rs.data[0].id });
        let str = ial.data["custom-index-create"];

        let localSettings: any = {};
        try {
            localSettings = JSON.parse(str);
            // console.log("[IndexPlugin] Local settings:", localSettings);
        } catch (e) {
            console.error("[IndexPlugin] Error parsing settings", e);
        }

        // Migrate old local settings values (ref→link, embed→reference, useDynamicAnchor→dynamic-ref)
        if (localSettings.linkType === "ref") localSettings.linkType = "link";
        if (localSettings.linkType === "embed") localSettings.linkType = "reference";
        if (localSettings.useDynamicAnchor === true && localSettings.linkType !== "dynamic-ref") localSettings.linkType = "dynamic-ref";
        delete localSettings.useDynamicAnchor;

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
                    // console.log("[IndexPlugin] User confirmed update to Global");
                    resolve();
                }, () => {
                    // console.log("[IndexPlugin] User kept Local settings");
                    // Use local configuration only for THIS operation
                    forceLocalConfig = settings.getMergedConfig(localSettings);
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
    // Use the forced local config if available, otherwise use global/merged defaults
    const currentConfig = forceLocalConfig || settings.getMergedConfig({});
    


    await generateIndex(block.data.box, block.data.path, indexQueue, 0, currentConfig);
    let data = queuePopAll(indexQueue, "", currentConfig);

    if (data != '') {
        await BlockService.insertOrUpdate(
            parentId,
            data,
            "custom-index-create",
            currentConfig,
            "index",
            targetBlockId
        );
        // client.pushMsg({ msg: i18n.msg_success });
    } else {
        client.pushMsg({ msg: i18n.msg_no_index, timeout: 3000 });
        // client.pushErrMsg
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

        // Get merged configuration snapshot (migrated) without side effects
        const localConfig = settings.getMergedConfig(localSettings);

        // Check if final effective autoUpdate is enabled
        if (!localConfig.autoUpdate) return;

        let indexQueue = new IndexQueue();
        await generateIndex(notebookId, path, indexQueue, 0, localConfig);
        let data = queuePopAll(indexQueue, "", localConfig);

        if (data != '') {
            // Write back the MIGRATED local settings to preserve per-block config
            await BlockService.insertOrUpdate(
                parentId,
                data,
                "custom-index-create",
                localConfig,
                "index",
                undefined,
                existingBlock // Pass existing block info to skip SQL in BlockService
            );
        }
    }
}
