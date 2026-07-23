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


    let rs = await client.sql({
        stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND ial like '%custom-index-create%' order by updated desc limit 1`
    });

    if (rs.data[0]?.id != undefined) {
        let ial = await client.getBlockAttrs({ id: rs.data[0].id });
        let str = ial.data["custom-index-create"];

        let localSettings: any = {};
        try {
            localSettings = JSON.parse(str);
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
                mismatch = true;
                break;
            }
        }

        if (mismatch) {
            await new Promise<void>((resolve) => {
                confirmDialog(i18n.confirmDialog.title, i18n.confirmDialog.content, () => {
                    resolve();
                }, () => {
                    // Use local configuration only for THIS operation
                    forceLocalConfig = settings.getMergedConfig(localSettings);
                    resolve();
                }, i18n.update, i18n.keep);
            });
        }

    }

    let block = await client.getBlockInfo({ id: parentId });
    if (!block.data) return;

    let indexQueue = new IndexQueue();
    // Use the forced local config if available, otherwise use global/merged defaults
    const currentConfig = forceLocalConfig || settings.getMergedConfig({});
    
    // 适配 3.7.3 顶层笔记本文档：顶层笔记本文档的 rootID 就是 notebookID (box)，即 block.data.rootID === block.data.box。
    // 在顶层笔记本文档中，listDocsByPath 需要传 "/" 才能获取到笔记本根层的一级子文档。
    const isNotebookDoc = block.data.rootID === block.data.box || block.data.path === `/${block.data.box}.sy`;
    const targetPath = isNotebookDoc ? "/" : block.data.path;

    await generateIndex(block.data.box, targetPath, indexQueue, 0, currentConfig);
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
            return;
        }

        // Get merged configuration snapshot (migrated) without side effects
        const localConfig = settings.getMergedConfig(localSettings);

        // Check if final effective autoUpdate is enabled
        if (!localConfig.autoUpdate) return;

        let indexQueue = new IndexQueue();
        
        // 适配 3.7.3 顶层笔记本文档：顶层笔记本文档的 path 为 /<boxID>.sy 或 /
        const targetPath = path === `/${notebookId}.sy` ? "/" : path;

        await generateIndex(notebookId, targetPath, indexQueue, 0, localConfig);
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
