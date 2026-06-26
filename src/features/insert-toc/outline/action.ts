import { client, BlockService } from "../../../shared/api-client";
import { getBlocksData, collectOutlineIds, requestGetDocOutline } from "../../../shared/api-client/query";
import { getDocid, i18n, confirmDialog, getAttrFromIAL } from "../../../shared/utils";
import { extractAnchors, isValidSeparator } from "../../../shared/utils/anchor-utils";
import { settings } from "../../../core/settings";
import { generateOutlineMarkdown } from "./generator";


export async function insertOutlineAction(targetBlockId?: string) {
    await settings.load();
    let forceLocalConfig: any = null;

    let parentId = getDocid();
    if (parentId == null) {
        console.error("No doc ID found");
        return;
    }


    let rs = await client.sql({
        stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND ial like '%custom-outline-create%' order by updated desc limit 1`
    });

    if (rs.data[0]?.id != undefined) {
        let ial = await client.getBlockAttrs({ id: rs.data[0].id });
        let str = ial.data["custom-outline-create"];
        let localSettings: any = {};
        try {
            localSettings = JSON.parse(str);
        } catch (e) {
            console.error("[IndexPlugin] Error parsing settings", e);
        }

        // Migrate old local settings values
        if (localSettings.outlineType === "ref") localSettings.outlineType = "link";
        if (localSettings.outlineType === "embed") localSettings.outlineType = "reference";
        if (localSettings.useDynamicAnchorOutline === true && localSettings.outlineType !== "dynamic-ref") localSettings.outlineType = "dynamic-ref";
        delete localSettings.useDynamicAnchorOutline;

        const keysToCheck = ["outlineType", "listTypeOutline", "iconOutline"];
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
                    forceLocalConfig = settings.getMergedConfigForOutline(localSettings);
                    resolve();
                }, i18n.update, i18n.keep);
            });
        }

    }

    let outlineData = await requestGetDocOutline(parentId);
    let ids = collectOutlineIds(outlineData);
    let extraData = await getBlocksData(ids);

    const currentConfig = forceLocalConfig || settings.getMergedConfigForOutline({});

    // Manual insert: Pass empty map to reset anchors
    let data = generateOutlineMarkdown(outlineData, 0, 0, extraData, new Map<string, string>(), currentConfig);

    if (data != '') {
        await BlockService.insertOrUpdate(
            parentId,
            data,
            "custom-outline-create",
            currentConfig,
            "outline",
            targetBlockId
        );
    } else {
        client.pushMsg({ msg: i18n.msg_no_outline, timeout: 3000 });
        // error
    }
}

export async function autoUpdateOutline(parentId: string, existingBlock?: any) {


    let id, ialStr, markdown;

    if (existingBlock) {
        id = existingBlock.id;
        ialStr = existingBlock.ial;
        markdown = existingBlock.markdown;
    } else {
        let rs = await client.sql({
            stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND ial like '%custom-outline-create%' order by updated desc limit 1`
        });
        if (rs.data[0]?.id != undefined) {
            existingBlock = rs.data[0];
            id = rs.data[0].id;
            ialStr = rs.data[0].ial;
            markdown = rs.data[0].markdown;
        }
    }

    if (id != undefined) {
        let existingAnchors = new Map<string, string>();
        if (markdown) {
            existingAnchors = extractAnchors(markdown);
            for (const [id, anchor] of existingAnchors) {
                if (!isValidSeparator(anchor)) {
                    existingAnchors.delete(id);
                }
            }
        }

        let str = getAttrFromIAL(ialStr, "custom-outline-create");
        let localSettings: any = {};
        try {
            if (str) localSettings = JSON.parse(str);
        } catch (e) {
            console.error("Failed to parse settings", e);
        }

        if (localSettings.outlineAutoUpdate === false) {
            return;
        }

        // Get merged configuration snapshot (migrated) without side effects
        const localConfig = settings.getMergedConfigForOutline(localSettings);

        // Check if effective autoUpdate is enabled
        if (!localConfig.outlineAutoUpdate) return;

        let outlineData = await requestGetDocOutline(parentId);
        let ids = collectOutlineIds(outlineData);
        let extraData = await getBlocksData(ids);

        let data = generateOutlineMarkdown(outlineData, 0, 0, extraData, existingAnchors, localConfig);

        if (data != '') {
            // Write back the MIGRATED local settings to preserve per-block config
            await BlockService.insertOrUpdate(
                parentId,
                data,
                "custom-outline-create",
                localConfig,
                "outline",
                undefined,
                existingBlock // Pass existing block info
            );
        }
    }
}
