import { post } from "../api-client/request";

/**
 * 获取数据库列映射及数据
 */
export async function getColIDMap(avID: string) {
    const avRawData = await post("/api/av/getAttributeView", { id: avID });
    const keyValues = (avRawData.av || avRawData).keyValues || [];
    const nameToID: Record<string, string> = {};
    const idToType: Record<string, string> = {};

    // Build row ID to Siyuan Block ID mappings
    const itemToBlock = new Map<string, string>();
    const blockToItem = new Map<string, string>();

    keyValues.forEach((kv: any) => {
        nameToID[kv.key.name] = kv.key.id;
        idToType[kv.key.id] = kv.key.type;

        if (kv.values) {
            kv.values.forEach((v: any) => {
                // Robust ID detection: try multiple possible property names
                const rowId = v.itemID || v.itemId || v.id;
                const bid = v.block?.id || v.blockID || v.block_id || v.blockId || (v.type === 'block' ? v.content : null);

                if (rowId && bid) {
                    itemToBlock.set(rowId, bid);
                    blockToItem.set(bid, rowId);
                }
            });
        }
    });

    if (itemToBlock.size === 0 && keyValues.length > 0) {
        console.warn("[AV Utils] Found 0 mappings. Sample cell data:", keyValues[0]?.values?.[0]);
    } else {
        console.log(`[AV Utils] getColIDMap for ${avID}: Found ${itemToBlock.size} mappings.`);
    }

    return { nameToID, idToType, keyValues, itemToBlock, blockToItem };
}

/**
 * 清理 AV Value 结构，仅保留核心数据字段
 */
export function cleanValue(val: any) {
    if (!val) return null;
    const res: any = { type: val.type };
    const fields = ["text", "number", "mSelect", "mAsset", "block", "url", "phone", "email", "template", "checkbox", "relation", "rollup", "date"];
    fields.forEach(f => {
        if (val[f] !== undefined) res[f] = JSON.parse(JSON.stringify(val[f]));
    });
    return res;
}

/**
 * 判断 AV 单元格值是否为空
 */
export function isValueEmpty(val: any) {
    if (val === undefined || val === null) return true;
    if (typeof val === "string") return val.trim() === "";
    if (typeof val === "number") return false;

    const type = val.type;
    switch (type) {
        case "text": return !val.text?.content;
        case "number": return val.number?.content === undefined;
        case "select": return !val.mOption || val.mOption.length === 0;
        case "mSelect": return !val.mOption || val.mOption.length === 0;
        case "url": return !val.url?.content;
        case "email": return !val.email?.content;
        case "phone": return !val.phone?.content;
        case "date": return !val.date?.content;
        case "checkbox": return false;
        case "block": return !val.block?.id;
        case "mAsset": return !val.mAsset || val.mAsset.length === 0;
        default: return !val.content;
    }
}

export function hexToEmoji(hex: string): string {
    if (!hex) return "";

    // Hex sequence regex (only hex chars and hyphens)
    const hexPattern = /^[0-9a-fA-F-]+$/;

    if (hexPattern.test(hex)) {
        try {
            return hex.split("-").map(item => String.fromCodePoint(parseInt(item, 16))).join("");
        } catch (e) {
            return hex;
        }
    }
    return hex;
}
/**
 * 构建 AV 层级关系 (parentMap)
 */
export async function buildAvHierarchy(keyValues: any[], itemToBlock: Map<string, string>) {
    const parentMap = new Map<string, string>();
    const blockIDToPath = new Map<string, string>();
    const pathToBlockID = new Map<string, string>();

    // 1. 尝试使用 Path 列
    const pathKV = keyValues.find(kv => kv.key.name.toLowerCase() === "path");
    if (pathKV && pathKV.values) {
        pathKV.values.forEach((v: any) => {
            const rowId = v.itemID || v.itemId || v.id;
            const bid = v.blockID || v.block_id || v.blockId || itemToBlock.get(rowId);
            const path = v.text?.content;
            if (bid && path) {
                blockIDToPath.set(bid, path);
                const purePath = path.replace(/\/\d+-/g, '/');
                pathToBlockID.set(purePath, bid);
            }
        });

        for (const [bid, path] of blockIDToPath.entries()) {
            const purePath = path.replace(/\/\d+-/g, '/');
            const lastSlash = purePath.lastIndexOf("/");
            if (lastSlash > 0) {
                const parentPath = purePath.substring(0, lastSlash);
                const pbid = pathToBlockID.get(parentPath);
                if (pbid) {
                    parentMap.set(bid, pbid);
                }
            }
        }
    }

    // 2. 尝试使用 Father 列 (如果 parentMap 为空或不完整)
    const fatherKV = keyValues.find(kv => kv.key.name.toLowerCase() === "father");
    if (fatherKV && fatherKV.values) {
        fatherKV.values.forEach((v: any) => {
            const rowId = v.itemID || v.itemId || v.id;
            const bid = v.blockID || v.block_id || v.blockId || itemToBlock.get(rowId);
            const pid = v.text?.content || v.relation?.blockIDs?.[0] || "";
            if (bid && pid && !parentMap.has(bid)) {
                parentMap.set(bid, pid);
            }
        });
    }

    return parentMap;
}

/**
 * 解析继承后的属性值
 */
export function resolveInheritance(
    blockId: string,
    colId: string,
    mode: "none" | "weak" | "strong",
    keyValues: any[],
    parentMap: Map<string, string>,
    blockToItem: Map<string, string>
) {
    const getLocal = (bid: string) => {
        const kv = keyValues.find(v => v.key.id === colId);
        if (!kv || !kv.values) return null;

        const rowId = blockToItem.get(bid);
        const cell = kv.values.find((v: any) => {
            const vRowId = v.itemID || v.itemId || v.id;
            const vBlockId = v.blockID || v.block_id || v.blockId || (v.block?.id);
            return (vBlockId === bid || (rowId && vRowId === rowId));
        });
        return cell ? cleanValue(cell) : null;
    };

    const localVal = getLocal(blockId);
    if (mode === "none" || !mode) return localVal;

    let nearestAncestorVal = null;
    let curr = parentMap.get(blockId);

    // console.log(`[Inheritance Resolve] Resolving ${blockId} for Col ${colId}. Local exists: ${!isValueEmpty(localVal)}`);

    while (curr) {
        const val = getLocal(curr);
        if (!isValueEmpty(val)) {
            nearestAncestorVal = val;
            break;
        }
        curr = parentMap.get(curr);
    }

    if (mode === "weak") {
        return !isValueEmpty(localVal) ? localVal : nearestAncestorVal;
    } else if (mode === "strong") {
        return !isValueEmpty(nearestAncestorVal) ? nearestAncestorVal : localVal;
    }

    return localVal;
}
