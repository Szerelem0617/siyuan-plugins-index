import { client } from "../../shared/api-client";

const ATTR_LINKED_AV = "custom-index-linkedav";

// API Helper
async function post(url: string, data: any) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    const res = await response.json();
    return res;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function createDatabase(listBlockId: string) {
    try {
        // 1. Check existence and Duplicate
        const listBlockRes = await client.getBlockAttrs({ id: listBlockId });
        if (!listBlockRes.data) return;

        const linkedAvId = listBlockRes.data[ATTR_LINKED_AV];
        if (linkedAvId) {
            // Verify if it still exists
            const checkRes = await client.sql({ stmt: `SELECT id FROM blocks WHERE id = '${linkedAvId}' LIMIT 1` });
            if (checkRes.data && checkRes.data.length > 0) {
                // @ts-ignore
                client.pushMsg({ msg: "⚠️ 已关联数据库，请勿重复创建 (Linked Database exists)", timeout: 3000 });
                return;
            }
        }

        // 2. Create Attribute View Block with a name
        const createRes = await client.insertBlock({
            dataType: "markdown",
            data: `<div data-type="NodeAttributeView" data-av-type="table" data-av-name="列表数据"></div>`,
            previousID: listBlockId
        });
        
        const avBlockId = createRes.data[0].doOperations[0].id;
        if (!avBlockId) throw new Error("Failed to create AV block");

        // Bind attribute immediately
        await client.setBlockAttrs({ 
            id: listBlockId, 
            attrs: { [ATTR_LINKED_AV]: avBlockId } 
        });

        // 3. Initialize View and Set Name explicitly
        const renderRes = await post("/api/av/renderAttributeView", { id: avBlockId });
        const viewID = renderRes.data?.viewID;
        
        await post("/api/av/setAttributeViewName", { id: avBlockId, name: "列表数据" });
        
        // 4. Configure Schema - Add "Level" column
        const addKeyRes = await post("/api/av/addAttributeViewKey", {
            avID: avBlockId,
            keyName: "Level",
            keyType: "select"
        });
        
        // Wait for schema update to propagate
        await sleep(1000);

        // 5. Traverse List & Collect Items (Recursive)
        const items = await collectListItems(listBlockId, 1);
        
        if (items.length === 0) {
            // @ts-ignore
            client.pushMsg({ msg: "List is empty, no items added to database.", timeout: 3000 });
            return;
        }

        // 6. Add items to AV (Batch)
        // Simplify srcs to just ID and isDetached flag
        const srcs = items.map(item => ({ 
            id: item.id, 
            isDetached: false 
        }));
        
        const addBlocksRes = await post("/api/av/addAttributeViewBlocks", {
            avID: avBlockId,
            srcs: srcs
        });
        console.log("[Data] addAttributeViewBlocks res:", JSON.stringify(addBlocksRes));
        
        // 7. Update Level attributes (Batch)
        // Retrieve keys to find "Level" keyID or fallback to default Select column
        const keysRes = await post("/api/av/getAttributeViewKeysByAvID", { avID: avBlockId });
        let targetKey = keysRes.data?.find((k: any) => k.name === "Level");
        
        if (!targetKey) {
            targetKey = keysRes.data?.find((k: any) => k.type === "select");
        }
        
        if (targetKey) {
            const values = items.map(item => ({
                keyID: targetKey.id,
                itemID: item.id,
                value: { 
                    type: "select", 
                    mSelect: [{ content: String(item.level) }] 
                }
            }));
            
            await post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID: avBlockId,
                values: values
            });
        }
        
        // Debug: Verify rows exist
        const rowsRes = await post("/api/av/getAttributeViewPrimaryKeyValues", { id: avBlockId, page: 1, pageSize: 10 });
        console.log("[Data] Final Row Check:", JSON.stringify(rowsRes));

        // Refresh View
        if (viewID) {
             await post("/api/av/renderAttributeView", { id: avBlockId, viewID: viewID });
        }
        
        // @ts-ignore
        client.pushMsg({ msg: "Database created successfully!", timeout: 3000 });

    } catch (e) {
        console.error("[Data] Create Database failed", e);
        // @ts-ignore
        client.pushErrMsg({ msg: "Failed to create database", timeout: 3000 });
    }
}

async function collectListItems(blockId: string, level: number) {
    const results: any[] = [];
    
    // Get direct children of the list (NodeList items)
    const res = await post("/api/block/getChildBlocks", { id: blockId });
    // console.log(`[Data] getChildBlocks(${blockId}) res:`, JSON.stringify(res));

    if (!res.data) {
        console.warn(`[Data] No data returned for ${blockId}`);
        return [];
    }
    
    for (const child of res.data) {
        // console.log(`[Data] Processing child ${child.id} type=${child.type}`);
        
        if (child.type === "NodeListItem" || child.type === "i") {
             // Add current item with full metadata
             results.push({ 
                 ...child, 
                 level: level 
             });
             
             // Recursively check for nested lists within this item
             const subChildrenRes = await post("/api/block/getChildBlocks", { id: child.id });
             if (subChildrenRes.data) {
                 for (const subChild of subChildrenRes.data) {
                     // console.log(`[Data]   Subchild ${subChild.id} type=${subChild.type}`);
                     if (subChild.type === "NodeList" || subChild.type === "l") {
                         const subItems = await collectListItems(subChild.id, level + 1);
                         results.push(...subItems);
                     }
                 }
             }
        }
    }
    return results;
}
