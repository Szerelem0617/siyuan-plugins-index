import { getSqliteEngine } from "../../sqlite/sqlite-manager";

export async function getInputColKeyId(avId: string): Promise<string> {
    try {
        const { db } = await getSqliteEngine();
        const res = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name = 'Input' OR key_name = 'Input Mapping' OR key_name = '入参映射')`, [avId]);
        if (res.length > 0 && res[0].values.length > 0) {
            return String(res[0].values[0][0]);
        }
        // Fallback search
        const fallbackRes = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name LIKE '%Input%' OR key_name LIKE '%入参%' OR key_name LIKE '%Param%')`, [avId]);
        if (fallbackRes.length > 0 && fallbackRes[0].values.length > 0) {
            return String(fallbackRes[0].values[0][0]);
        }
    } catch (_) { /* ignore */ }
    return "";
}

export async function getOutputColKeyId(avId: string): Promise<string> {
    try {
        const { db } = await getSqliteEngine();
        const res = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name = 'Output' OR key_name = 'Output Mapping' OR key_name = '出参映射')`, [avId]);
        if (res.length > 0 && res[0].values.length > 0) {
            return String(res[0].values[0][0]);
        }
        // Fallback search
        const fallbackRes = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name LIKE '%Output%' OR key_name LIKE '%出参%')`, [avId]);
        if (fallbackRes.length > 0 && fallbackRes[0].values.length > 0) {
            return String(fallbackRes[0].values[0][0]);
        }
    } catch (_) { /* ignore */ }
    return "";
}

/** 兼容导出 */
export const getParamColKeyId = getInputColKeyId;

