import { createDatabaseWithBlocks } from "./action";

export async function autoUpdateListAVs(listBlock: any) {
    if (!listBlock.id) return;
    try {
        console.log(`[Data] Auto-syncing List to bound DB for list ${listBlock.id}`);
        // Run the DB create/update process silently
        await createDatabaseWithBlocks([listBlock.id], null, true);
    } catch (e) {
        console.error("[Data] Auto-sync list AVs failed:", e);
    }
}
