/**
 * iav-builder.ts
 *
 * 思源原生 IAV (Attribute View) 协议组装器
 * 负责将 SQLite 热表中的数据行与列转换组装为思源前端能够直接渲染的完整 AttributeView JSON 数据结构
 */

import { getColumnMeta } from "./types";

/**
 * 从 SQLite 热表结果集组装标准的 IAV 视图对象
 */
export function buildVirtualIAVFromSQL(
    avId: string,
    tagName: string,
    tableName: string,
    columnsList: string[],
    valuesList: any[][],
    db: any
): any {
    // 1. 区分主键列与自定义属性列
    const attrCols = columnsList.filter((c: string) => c !== "id" && c !== "title" && !c.startsWith("_"));

    // 2. 构建列定义 (Columns)
    const avColumns: any[] = [];
    const primaryColId = "col_primary_block";

    // 主键列
    avColumns.push({
        id: primaryColId,
        name: "标题",
        type: "block",
        icon: "",
        width: "320px",
        hidden: false,
        wrapField: true
    });

    // 自定义属性列
    for (const attr of attrCols) {
        const colId = `col_${attr}`;

        // 从 SQLite 查询当前列的所有去重枚举值用于构建 select options
        const optRes = db.exec(`SELECT DISTINCT "${attr}" FROM "${tableName}" WHERE "${attr}" IS NOT NULL AND "${attr}" != '';`);
        const options: Array<{ id: string; name: string; color: string }> = [];

        if (optRes && optRes.length > 0) {
            optRes[0].values.forEach((valArr: any[], idx: number) => {
                const optVal = String(valArr[0]);
                options.push({
                    id: `opt_${attr}_${optVal}`,
                    name: optVal,
                    color: String((idx % 8) + 1)
                });
            });
        }

        const meta = getColumnMeta(tagName, attr);
        let displayName = meta?.name || attr;
        if (attr === "status" || attr === "index-task") displayName = "状态";
        else if (attr === "priority") displayName = "优先级";
        else if (attr === "due" || attr === "due_date") displayName = "截止时间";
        else if (attr === "memo") displayName = "备注";

        avColumns.push({
            id: colId,
            name: displayName,
            type: meta?.type || "select",
            icon: "",
            width: "160px",
            hidden: false,
            wrapField: false,
            options
        });
    }

    // 3. 构建数据行 (Rows & Cells)
    const idIdx = columnsList.indexOf("id");
    const titleIdx = columnsList.indexOf("title");

    const avRows = valuesList.map((rowArr: any[]) => {
        const rowId = String(rowArr[idIdx]);
        const rowTitle = String(rowArr[titleIdx] || "未命名项");
        const cells: any[] = [];

        // 主键单元格
        cells.push({
            id: `${rowId}_${primaryColId}`,
            color: "",
            bgColor: "",
            valueType: "block",
            value: {
                id: `${rowId}_${primaryColId}`,
                keyID: primaryColId,
                blockID: rowId,
                type: "block",
                block: {
                    id: rowId,
                    content: rowTitle,
                    icon: ""
                }
            }
        });

        // 各属性单元格
        for (const attr of attrCols) {
            const colId = `col_${attr}`;
            const aIdx = columnsList.indexOf(attr);
            const val = aIdx !== -1 && rowArr[aIdx] !== null && rowArr[aIdx] !== undefined ? String(rowArr[aIdx]) : "";

            const selectItems = val ? [{
                id: `opt_${attr}_${val}`,
                content: val,
                name: val,
                color: "1"
            }] : [];

            cells.push({
                id: `${rowId}_${colId}`,
                color: "",
                bgColor: "",
                valueType: "select",
                value: {
                    id: `${rowId}_${colId}`,
                    keyID: colId,
                    blockID: rowId,
                    type: "select",
                    mSelect: selectItems
                }
            });
        }

        return {
            id: rowId,
            cells
        };
    });

    // 4. 组装标准 IAV 数据对象
    const viewId = "view_sql_table";
    const cleanTagName = (tagName || "").replace(/^#/, "").toLowerCase();
    
    return {
        id: avId,
        name: `supertag-${cleanTagName}`,
        viewID: viewId,
        viewType: "table",
        views: [
            {
                id: viewId,
                name: "表格",
                type: "table",
                icon: "iconTable",
                hideAttrViewName: false,
                pageSize: 50,
                showIcon: true,
                wrapField: false,
                filters: [],
                sorts: [],
                groups: []
            }
        ],
        view: {
            id: viewId,
            name: "表格",
            type: "table",
            icon: "iconTable",
            hideAttrViewName: false,
            pageSize: 50,
            showIcon: true,
            wrapField: false,
            columns: avColumns,
            rows: avRows,
            rowCount: avRows.length,
            filters: [],
            sorts: [],
            groups: []
        }
    };
}

/**
 * 构造空虚拟 IAV 视图对象
 */
export function buildEmptyIAV(avId: string, tagName: string, attrNames: string[]): any {
    const viewId = "view_sql_table";
    const primaryColId = "col_primary_block";
    const avColumns: any[] = [{
        id: primaryColId,
        name: "标题",
        type: "block",
        icon: "",
        width: "320px",
        hidden: false,
        wrapField: true
    }];

    for (const attr of attrNames) {
        const colId = `col_${attr}`;
        const meta = getColumnMeta(tagName, attr);
        let displayName = meta?.name || attr;
        if (attr === "status" || attr === "index-task") displayName = "状态";
        else if (attr === "priority") displayName = "优先级";
        else if (attr === "due" || attr === "due_date") displayName = "截止时间";
        else if (attr === "memo") displayName = "备注";

        avColumns.push({
            id: colId,
            name: displayName,
            type: meta?.type || "select",
            icon: "",
            width: "160px",
            hidden: false,
            wrapField: false,
            options: []
        });
    }

    const cleanTagName = (tagName || "").replace(/^#/, "").toLowerCase();
    return {
        id: avId,
        name: `supertag-${cleanTagName}`,
        viewID: viewId,
        viewType: "table",
        views: [{
            id: viewId,
            name: "表格",
            type: "table",
            icon: "iconTable",
            hideAttrViewName: false,
            pageSize: 50,
            showIcon: true,
            wrapField: false,
            filters: [],
            sorts: [],
            groups: []
        }],
        view: {
            id: viewId,
            name: "表格",
            type: "table",
            icon: "iconTable",
            hideAttrViewName: false,
            pageSize: 50,
            showIcon: true,
            wrapField: false,
            columns: avColumns,
            rows: [],
            rowCount: 0,
            filters: [],
            sorts: [],
            groups: []
        }
    };
}
