/**
 * trigger/rule-query.ts
 *
 * 超级标签规则脚本查询器 (SQLite AV Schema 与 Seed 常量)
 */

import { getTypeAvId } from "../../../command/registration";
import { getSqliteEngine } from "../../../sqlite/sqlite-manager";
import { getSeedConditionalScript } from "../../../command/indexos/seed-data";

export async function querySupertagRuleScript(cleanTag: string): Promise<string> {
    let conditionalVal = "";
    const typeAvId = getTypeAvId();

    if (typeAvId) {
        try {
            const tableName = `av_${typeAvId.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const { db } = await getSqliteEngine();
            
            const schemaCols = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND key_type = 'block'`, [typeAvId]);
            let supertagColName = "supertag";
            if (schemaCols.length > 0 && schemaCols[0].values.length > 0) {
                supertagColName = String(schemaCols[0].values[0][0]);
            }

            const schemaConditional = db.exec(`SELECT col_name FROM _av_schema WHERE av_id = ? AND (key_name = 'Auto' OR key_name = 'Conditional' OR key_name = '触发器' OR key_name = 'On Create' OR key_name = '创建时')`, [typeAvId]);
            let conditionalColName = "Auto";
            if (schemaConditional.length > 0 && schemaConditional[0].values.length > 0) {
                conditionalColName = String(schemaConditional[0].values[0][0]);
            }

            const typeDbRes = db.exec(`SELECT "${conditionalColName}" FROM ${tableName} WHERE LOWER("${supertagColName}") = '#${cleanTag.toLowerCase()}' OR LOWER("${supertagColName}") = '${cleanTag.toLowerCase()}'`);

            if (typeDbRes && typeDbRes.length > 0 && typeDbRes[0].values.length > 0) {
                conditionalVal = String(typeDbRes[0].values[0][0] || "").trim();
            }
        } catch (dbErr) {
            console.warn("[Supertag-Trigger] Failed to query SQLite for conditional script:", dbErr);
        }
    }

    if (!conditionalVal || conditionalVal === "Conditional" || conditionalVal === "Auto") {
        conditionalVal = getSeedConditionalScript(cleanTag);
    } else if (cleanTag.toLowerCase() === "project" && !conditionalVal.includes("block_content_changed")) {
        conditionalVal = getSeedConditionalScript(cleanTag);
    }

    return conditionalVal;
}
