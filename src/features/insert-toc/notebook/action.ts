import { generateIndex, queuePopAll, IndexConfig } from "../index/generator";
import { IndexQueue } from "../../../shared/utils/index-queue";
import { client } from "../../../shared/api-client";

export async function insertNotebookIndex(
    targetDocId: string,
    notebookId: string,
    config: IndexConfig
) {
    let indexQueue = new IndexQueue();
    // Path "/" for root of notebook
    await generateIndex(notebookId, "/", indexQueue, 0, config);
    let data = queuePopAll(indexQueue, "");

    if (data != '') {
        await client.prependBlock({
            data: data,
            dataType: 'markdown',
            parentID: targetDocId
        });
        return true;
    }
    return false;
}
