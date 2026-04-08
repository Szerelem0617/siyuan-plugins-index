import { post } from "../api-client/request";

/**
 * 核心数据索引结构
 */
export interface AVIndex {
    nameToID: Record<string, string>;
    idToType: Record<string, string>;
    keyValues: any[];
    // 二级索引: blockID -> colID -> valueObject
    cellMap: Map<string, Map<string, any>>;
    // 层级缓存
    parentMap: Map<string, string>;
}

/**
 * 获取数据库列映射及数据并建立高效索引
 */
export async function getColIDMap(avID: string): Promise<AVIndex> {
    const avRawData = await post("/api/av/getAttributeView", { id: avID });
    const keyValues = (avRawData.av || avRawData).keyValues || [];
    
    const nameToID: Record<string, string> = {};
    const idToType: Record<string, string> = {};
    const cellMap = new Map<string, Map<string, any>>();

    keyValues.forEach((kv: any) => {
        const colId = kv.key.id;
        nameToID[kv.key.name] = colId;
        idToType[colId] = kv.key.type;

        if (kv.values) {
            kv.values.forEach((v: any) => {
                const bid = v.blockID || v.block_id || v.blockId || v.block?.id;
                if (!bid) return;

                if (!cellMap.has(bid)) {
                    cellMap.set(bid, new Map<string, any>());
                }
                cellMap.get(bid)!.set(colId, v);
            });
        }
    });

    return { 
        nameToID, 
        idToType, 
        keyValues, 
        cellMap,
        parentMap: new Map() 
    };
}

/**
 * 清理 AV Value 结构
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
 * 判断内容是否为空
 */
export function isValueEmpty(val: any) {
    if (!val) return true;
    const type = val.type;
    switch (type) {
        case "text": return !val.text?.content;
        case "number": return val.number?.content === undefined;
        case "mSelect": return !val.mSelect || val.mSelect.length === 0;
        case "url": return !val.url?.content;
        case "date": return !val.date?.content;
        case "block": return !val.block?.content;
        case "checkbox": return false;
        default: return !val.content;
    }
}

/**
 * Unicode 十六进制转表情
 */
export function hexToEmoji(hex: string): string {
    if (!hex) return "";
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
 * 构建层级关系
 */
export async function buildAvHierarchy(index: AVIndex) {
    const { cellMap, nameToID } = index;
    const parentMap = new Map<string, string>();
    const pathToBlockID = new Map<string, string>();

    const pathColID = nameToID["Path"] || nameToID["path"];
    const fatherColID = nameToID["Father"] || nameToID["father"];

    if (pathColID) {
        for (const [bid, row] of cellMap.entries()) {
            const pathValue = row.get(pathColID);
            const path = pathValue?.text?.content;
            if (path) {
                const purePath = path.replace(/\/\d{3}-/g, '/');
                pathToBlockID.set(purePath, bid);
            }
        }

        for (const [bid, row] of cellMap.entries()) {
            const path = row.get(pathColID)?.text?.content;
            if (path) {
                const purePath = path.replace(/\/\d{3}-/g, '/');
                const lastSlash = purePath.lastIndexOf("/");
                if (lastSlash > 0) {
                    const parentPath = purePath.substring(0, lastSlash);
                    const pbid = pathToBlockID.get(parentPath);
                    if (pbid) parentMap.set(bid, pbid);
                }
            }
        }
    }

    if (fatherColID) {
        for (const [bid, row] of cellMap.entries()) {
            if (parentMap.has(bid)) continue;
            const fatherVal = row.get(fatherColID);
            const pid = fatherVal?.text?.content || fatherVal?.relation?.blockIDs?.[0];
            if (pid) parentMap.set(bid, pid);
        }
    }

    index.parentMap = parentMap;
    return parentMap;
}

/**
 * 极速解析继承属性 (O(Depth))
 */
export function resolveInheritance(
    blockId: string,
    colId: string,
    mode: "none" | "weak" | "strong",
    index: AVIndex
) {
    const { cellMap, parentMap } = index;

    const getLocal = (bid: string) => {
        const cell = cellMap.get(bid)?.get(colId);
        return cell ? cleanValue(cell) : null;
    };

    const localVal = getLocal(blockId);
    if (!mode || mode === "none") return localVal;

    let curr = parentMap.get(blockId);
    let nearestAncestorVal = null;

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
