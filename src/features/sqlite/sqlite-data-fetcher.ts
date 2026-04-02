import { post } from "../../shared/api-client/request";

/**
 * Interface for Attribute View metadata
 */
export interface AttributeViewInfo {
    blockID: string;
    avID: string;
    title: string;
}

/**
 * Discovery mode: Combine SQL active blocks + Filesystem storage scan
 */
export async function getAllAttributeViews(): Promise<AttributeViewInfo[]> {
    const results: Map<string, AttributeViewInfo> = new Map();

    // 1. Filesystem Scan: data/storage/av (Finds ALL, even orphaned)
    try {
        const dirRes = await post("/api/file/readDir", { path: "/data/storage/av" });
        if (dirRes && Array.isArray(dirRes)) {
            dirRes.forEach((file: any) => {
                if (file.name.endsWith(".json")) {
                    const avID = file.name.replace(".json", "");
                    results.set(avID, {
                        blockID: "", // Orphaned databases don't have a primary block
                        avID: avID,
                        title: `DB: ${avID.substring(0, 8)}`
                    });
                }
            });
            console.log(`[SQLiteDiscovery] Found ${dirRes.length} databases in storage.`);
        }
    } catch (e) {
        console.warn("[SQLiteDiscovery] Storage scan failed:", e);
    }

    // 2. SQL Scan: active blocks (Resolves titles and block associations)
    const sql = "SELECT id, content, ial FROM blocks WHERE type = 'av' LIMIT 1000";
    const blocks = await post("/api/query/sql", { stmt: sql });
    
    if (Array.isArray(blocks)) {
        for (const block of blocks) {
            // Priority: custom-index-linked-av -> data-av-id -> custom-avs
            const matches = block.ial.match(/(?:custom-index-linked-av|data-av-id|custom-avs)="([^"]+)"/);
            const avID = matches ? matches[1].split(",")[0] : block.id;
            
            let title = block.content || "";
            title = title.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[#*`[\]()]/g, "").trim();
            if (!title) title = `AV-${block.id.substring(0, 8)}`;

            results.set(avID, {
                blockID: block.id,
                avID: avID,
                title: title
            });
            console.log(`[SQLiteDiscovery] Active Block ${block.id} linked to ${avID}`);
        }
    }
    
    return Array.from(results.values());
}

/**
 * Fetch data for a specific AV and prepare it for SQLite insertion
 */
export async function getAVData(idOrBlockID: string) {
    console.log(`[SQLiteData] Requesting render for: ${idOrBlockID}`);
    // api/av/renderAttributeView implementation in SiYuan:
    // It accepts BOTH blockID and avID. If blockID is provided, it resolves the AV.
    const data = await post("/api/av/renderAttributeView", { 
        id: idOrBlockID, // Try as AV ID first
        blockID: idOrBlockID, // Also provide as blockID just in case
        pageSize: 1000 
    });
    
    if (!data || (!data.view && !data.rows)) {
        console.error(`[SQLiteData] Render failed or empty for ${idOrBlockID}`);
        return null;
    }

    // Capture the true AV ID from response
    const realAvID = data.id || idOrBlockID; 
    const view = data.view || data;
    const columns = view.columns || [];
    const rows = view.rows || [];
    
    console.log(`[SQLiteData] Result for ${realAvID}: ${columns.length} cols, ${rows.length} rows`);

    if (columns.length === 0) return null;

    // Map columns to SQLite-friendly names (and types if needed)
    const columnDefinitions = columns.map((col: any) => ({
        id: col.id,
        name: col.name || col.keyName || `col_${col.id}`,
        type: String(col.type || "")
    }));

    // Map rows to data objects
    // Map rows to data objects
    const rowData = rows.map((row: any) => {
        const item: Record<string, any> = {
            _block_id: row.blockID // Hidden column for the primary block reference
        };
        
        row.cells.forEach((cell: any, index: number) => {
            const col = columnDefinitions[index];
            if (col && cell.value) {
                const v = cell.value;
                let value: any = "";
                
                // SiYuan's complex cell value extraction
                if (v.text) value = v.text.content;
                else if (v.mText) value = v.mText.content;
                else if (v.number) value = v.number.isNotEmpty ? (v.number.formattedContent || v.number.content) : "";
                else if (v.checkbox) value = v.checkbox.checked ? "Checked" : "Unchecked";
                else if (v.select) value = (v.select || []).map((s: any) => s.content).join(", ");
                else if (v.mSelect) value = (v.mSelect || []).map((s: any) => s.content).join(", ");
                else if (v.date) value = v.date.isNotEmpty ? (v.date.formattedContent || v.date.content) : "";
                else if (v.block) value = v.block.content || "";
                else if (v.relation) value = (v.relation.contents || []).map((c: any) => c.content || c.blockID).join(", ");
                else if (v.template) value = v.template.content || "";
                else if (v.created) value = v.created.formattedContent || "";
                else if (v.updated) value = v.updated.formattedContent || "";
                else if (typeof v === 'string') value = v;
                else value = JSON.stringify(v); // Last resort for debugging

                item[col.name] = value === undefined || value === null ? "" : String(value);
            } else if (col) {
                item[col.name] = "";
            }
        });
        return item;
    });

    return {
        avID: realAvID,
        columns: columnDefinitions,
        rows: rowData
    };
}
