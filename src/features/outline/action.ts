import { client, BlockService } from "../../shared/api-client";
import { getBlocksData, collectOutlineIds, requestGetDocOutline } from "../../shared/api-client/query";
import { getDocid, i18n, plugin, confirmDialog, getAttrFromIAL } from "../../shared/utils";
import { extractAnchors, isValidSeparator } from "../../shared/utils/anchor-utils";
import { settings, CONFIG } from "../../core/settings";
import { generateOutlineMarkdown } from "./generator";
import { bindTreeAttributes } from "../transformation/transformation";

export async function insertOutlineAction(targetBlockId?: string) {
    await settings.load();

    let parentId = getDocid();
    if (parentId == null) {
        console.error("No doc ID found");
        return;
    }

    // Check for existing outline (Manual Insert/Update)
    console.log("[IndexPlugin] Checking for existing outline...");
    let rs = await client.sql({
        stmt: `SELECT * FROM blocks WHERE root_id = '${parentId}' AND ial like '%custom-outline-create%' order by updated desc limit 1`
    });

    if (rs.data[0]?.id != undefined) {
        console.log("[IndexPlugin] Found existing outline:", rs.data[0].id);
        let ial = await client.getBlockAttrs({ id: rs.data[0].id });
        let str = ial.data["custom-outline-create"];
        let localSettings: any = {};
        try {
            localSettings = JSON.parse(str);
            console.log("[IndexPlugin] Local Outline settings:", localSettings);
        } catch (e) {
            console.error("[IndexPlugin] Error parsing settings", e);
        }

        const keysToCheck = ["outlineType", "listTypeOutline", "iconOutline"];
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
                    console.log("[IndexPlugin] User confirmed update to Global (Outline)");
                    resolve();
                }, () => {
                    console.log("[IndexPlugin] User kept Local settings (Outline)");
                    settings.loadSettingsforOutline(localSettings);
                    resolve();
                }, i18n.update, i18n.keep);
            });
        }
    } else {
        console.log("[IndexPlugin] No existing outline found.");
    }

    let outlineData = await requestGetDocOutline(parentId);
    let ids = collectOutlineIds(outlineData);
    let extraData = await getBlocksData(ids);

    // Manual insert: Pass empty map to reset anchors
    let data = generateOutlineMarkdown(outlineData, 0, 0, extraData, new Map<string, string>());

    if (data != '') {
        const isTree = settings.get("outlineType") === "tree";
        const attrName = isTree ? "custom-tree-create" : "custom-outline-create";
        const config = isTree ? { treeType: "heading-tree", builderAutoUpdate: true } : plugin.data[CONFIG];

        const result = await BlockService.insertOrUpdate(
            parentId,
            data,
            attrName,
            config,
            "outline",
            targetBlockId
        );

        if (isTree && result && result.success && result.id) {
            await bindTreeAttributes(result.id, "custom-index-heading-id");
        }
    } else {
        client.pushMsg({ msg: i18n.msg_no_outline, timeout: 3000 });
        // error
    }
}

export async function autoUpdateOutline(parentId: string, existingBlock?: any) {
    // await settings.load();
    console.log("[IndexPlugin] Auto-updating outline for doc:", parentId);

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

        // Check if local outlineAutoUpdate is enabled
        if (localSettings.outlineAutoUpdate === false) {
            console.log("[IndexPlugin] Local outlineAutoUpdate is disabled. Skipping.");
            return;
        }

        // Auto-update always uses local settings without prompting
        settings.loadSettingsforOutline(localSettings);

        if (!settings.get("outlineAutoUpdate")) return;

        let outlineData = await requestGetDocOutline(parentId);
        let ids = collectOutlineIds(outlineData);
        let extraData = await getBlocksData(ids);

        let data = generateOutlineMarkdown(outlineData, 0, 0, extraData, existingAnchors);

        if (data != '') {
            await BlockService.insertOrUpdate(
                parentId,
                data,
                "custom-outline-create",
                plugin.data[CONFIG],
                "outline",
                undefined,
                existingBlock // Pass existing block info
            );
        }
    }
}
