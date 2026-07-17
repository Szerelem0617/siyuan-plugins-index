import { getSqliteEngine } from "../../sqlite/sqlite-manager";

export async function getParamColKeyId(avId: string): Promise<string> {
    try {
        const { db } = await getSqliteEngine();
        const res = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name = 'Param Mapping' OR key_name = '参数映射')`, [avId]);
        if (res.length > 0 && res[0].values.length > 0) {
            return String(res[0].values[0][0]);
        }
        // Fallback: search for any column containing 'Param' or '参数'
        const fallbackRes = db.exec(`SELECT key_id FROM _av_schema WHERE av_id = ? AND (key_name LIKE '%Param%' OR key_name LIKE '%参数%')`, [avId]);
        if (fallbackRes.length > 0 && fallbackRes[0].values.length > 0) {
            return String(fallbackRes[0].values[0][0]);
        }
    } catch (_) { /* ignore */ }
    return "";
}
