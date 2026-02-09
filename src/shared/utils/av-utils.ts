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
