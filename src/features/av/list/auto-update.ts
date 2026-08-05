import { createDatabaseWithBlocks } from "./create-db";
import { ATTR_LAST_SYNC, ATTR_LINKED_AV, ATTR_LINKED_AV_BLOCK } from "../../../shared/constants";
import { loadDbConfig, syncInheritanceToDb } from "../av-setting/db-config";

export async function autoUpdateListAVs(listBlock: any) {
    if (!listBlock.id) return;
    try {
        const ial = listBlock.ial || "";
        const avId = ial.includes(ATTR_LINKED_AV + '="') 
            ? ial.split(ATTR_LINKED_AV + '="')[1]?.split('"')[0] 
            : null;
        const avBlockId = ial.includes(ATTR_LINKED_AV_BLOCK + '="') 
            ? ial.split(ATTR_LINKED_AV_BLOCK + '="')[1]?.split('"')[0] 
            : null;

        // --- 1. 继承回填 (独立逻辑) ---
        // 只要存在绑定关系，每次激活页签都尝试进行轻量级的继承同步（内部有 dirty check）
        if (avId && avBlockId) {
            const config = await loadDbConfig(avBlockId);
            if (config && config.inheritanceRules && config.inheritanceRules.length > 0) {
                await syncInheritanceToDb(avId, config, avBlockId);
            }
        }

        // --- 2. 物理同步 (Builder 逻辑，仅在列表有改动时执行) ---
        const lastSync = ial.includes(ATTR_LAST_SYNC + '="') 
            ? ial.split(ATTR_LAST_SYNC + '="')[1]?.split('"')[0] 
            : null;

        if (lastSync && listBlock.updated <= lastSync) {
            // console.log(`[Auto-Update] Builder sync skipped for ${listBlock.id} (No changes).`);
            return;
        }

        console.log(`[Auto-Update] List content changed. Triggering Builder sync: ${listBlock.id}`);
        await createDatabaseWithBlocks([listBlock.id], true, true);

    } catch (e) {
        console.error("[Auto-Update] Failed:", e);
    }
}
