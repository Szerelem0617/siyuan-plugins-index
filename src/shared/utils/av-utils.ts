import { post } from "../api-client/request";

/**
 * 获取数据库列映射
 */
export async function getColIDMap(avID: string) {
    const avRawData = await post("/api/av/getAttributeView", { id: avID });
    const keyValues = (avRawData.av || avRawData).keyValues || [];
    const nameToID: Record<string, string> = {};
    const idToType: Record<string, string> = {};
    keyValues.forEach((kv: any) => {
        nameToID[kv.key.name] = kv.key.id;
        idToType[kv.key.id] = kv.key.type;
    });
    return { nameToID, idToType, keyValues };
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
    if (!val) return true;
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

/**
 * 构建 AV 层级关系 (parentMap)
 */
export async function buildAvHierarchy(keyValues: any[]) {
    const parentMap = new Map<string, string>();
    
    // 1. 尝试使用 Path 列
    const pathKV = keyValues.find(kv => kv.key.name.toLowerCase() === "path");
    if (pathKV && pathKV.values) {
        const blockPathMap = new Map<string, string>();
        pathKV.values.forEach((v: any) => {
            if (v.blockID && v.text?.content) blockPathMap.set(v.blockID, v.text.content);
        });
        
        for (const [bid, path] of blockPathMap.entries()) {
            const lastSlash = path.lastIndexOf("/");
            if (lastSlash > 0) {
                const parentPath = path.substring(0, lastSlash);
                for (const [pbid, ppath] of blockPathMap.entries()) {
                    if (ppath === parentPath) {
                        parentMap.set(bid, pbid);
                        break;
                    }
                }
            }
        }
    }
    
    // 2. 尝试使用 Father 列 (如果 parentMap 为空或不完整)
    const fatherKV = keyValues.find(kv => kv.key.name.toLowerCase() === "father");
    if (fatherKV && fatherKV.values) {
        fatherKV.values.forEach((v: any) => {
            const pid = v.text?.content || v.relation?.blockIDs?.[0] || "";
            if (v.blockID && pid && !parentMap.has(v.blockID)) {
                parentMap.set(v.blockID, pid);
            }
        });
    }

    return parentMap;
}

/**
 * 解析继承后的属性值
 * 弱继承：如果当前为空，则继承祖先
 * 强继承：优先继承祖先不为空的属性
 */
export function resolveInheritance(
    blockId: string,
    colId: string,
    mode: "none" | "weak" | "strong",
    keyValues: any[],
    parentMap: Map<string, string>
) {
    const getLocal = (bid: string) => {
        const kv = keyValues.find(v => v.key.id === colId);
        if (!kv || !kv.values) return null;
        const cell = kv.values.find((v: any) => v.blockID === bid);
        return cell ? cleanValue(cell) : null;
    };

    const localVal = getLocal(blockId);
    if (mode === "none" || !mode) return localVal;

    // 寻找最近的非空祖先值
    let nearestAncestorVal = null;
    let curr = parentMap.get(blockId);
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
