import { createDatabaseWithBlocks } from "./create-db";
import { ATTR_LAST_SYNC } from "../../../shared/constants";

export async function autoUpdateListAVs(listBlock: any) {
    if (!listBlock.id) return;
    try {
        const lastSync = listBlock.ial?.includes(ATTR_LAST_SYNC) 
            ? listBlock.ial.split(ATTR_LAST_SYNC + '="')[1]?.split('"')[0] 
            : null;

        // Skip if the block hasn't been modified since the last sync
        if (lastSync && listBlock.updated <= lastSync) {
            // console.log(`[Data] Incremental Skip: List ${listBlock.id} is up to date.`);
            return;
        }

        console.log(`[Data] Auto-syncing List to bound DB for list ${listBlock.id} (lastSync: ${lastSync}, updated: ${listBlock.updated})`);
        
        // Run the DB create/update process silently
        await createDatabaseWithBlocks([listBlock.id], true, true);
    } catch (e) {
        console.error("[Data] Auto-sync list AVs failed:", e);
    }
}
