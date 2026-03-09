async function run() {
    // 1. Prepend a list to a known notebook/doc
    // Need a valid rootId. I can get one from the recent files. Or just query blocks.
    try {
        const queryRes = await fetch("http://127.0.0.1:50598/api/query/sql", {
            method: "POST", body: JSON.stringify({ stmt: "SELECT root_id FROM blocks WHERE type='d' LIMIT 1" })
        });
        const queryData = await queryRes.json();
        const rootId = queryData.data[0].root_id;

        const md = "* [📄](siyuan://blocks/test1234) ➖ Test 1\n    * [📄](siyuan://blocks/test5678) ➖ Test 2";
        const insertRes = await fetch("http://127.0.0.1:50598/api/block/prependBlock", {
            method: "POST", body: JSON.stringify({ data: md, dataType: "markdown", parentID: rootId })
        });
        const insertData = await insertRes.json();
        const listId = insertData.data[0].doOperations[0].id;

        console.log("Inserted list:", listId);

        const domRes = await fetch("http://127.0.0.1:50598/api/block/getBlockDOM", {
            method: "POST", body: JSON.stringify({ id: listId })
        });
        const domData = await domRes.json();
        const domStr = domData.data.dom;
        console.log("DOM STRING LENGTH:", domStr.length);
        console.log("CONTAINS siyuan://blocks/test1234:", domStr.includes("siyuan://blocks/test1234"));
        console.log("CONTAINS NodeListItem:", domStr.includes("NodeListItem"));

        // Write the DOM to a file so we can inspect it
        const fs = require('fs');
        fs.writeFileSync('test-dom-output.html', domStr);
        console.log("Wrote to test-dom-output.html");

        // Clean up
        await fetch("http://127.0.0.1:50598/api/block/deleteBlock", {
            method: "POST", body: JSON.stringify({ id: listId })
        });
    } catch (e) {
        console.error(e);
    }
}
run();
