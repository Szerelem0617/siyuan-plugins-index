import { getColumnMeta } from "./types";
import { getSupertagSchema, type SupertagFieldSchema } from "../core/supertag-schema";

/**
 * 从 SQLite 热表结果集组装标准的 IAV 视图对象
 */
export function buildVirtualIAVFromSQL(
    avId: string,
    tagName: string,
    tableName: string,
    columnsList: string[],
    valuesList: any[][],
    db: any,
    cachedSchema?: SupertagFieldSchema[]
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

    const schemaMap = new Map<string, SupertagFieldSchema>();
    if (cachedSchema && cachedSchema.length > 0) {
        cachedSchema.forEach(f => schemaMap.set(f.slug.toLowerCase(), f));
    }

    // 自定义属性列
    for (const attr of attrCols) {
        const colId = `col_${attr}`;
        const schemaField = schemaMap.get(attr.toLowerCase());

        // 收集或从 Schema 获取选项列表
        const options: Array<{ id: string; name: string; color: string }> = [];
        const optMap = new Map<string, { id: string; name: string; color: string }>();

        if (schemaField?.options && schemaField.options.length > 0) {
            schemaField.options.forEach(opt => {
                const item = { id: opt.id, name: opt.name, color: opt.color || "1" };
                options.push(item);
                optMap.set(opt.name, item);
            });
        }

        // 从 SQLite 查询当前列的所有枚举值补充缺失选项
        const optRes = db.exec(`SELECT DISTINCT "${attr}" FROM "${tableName}" WHERE "${attr}" IS NOT NULL AND "${attr}" != '';`);
        if (optRes && optRes.length > 0) {
            optRes[0].values.forEach((valArr: any[], idx: number) => {
                const optVal = String(valArr[0]);
                if (!optMap.has(optVal)) {
                    const item = {
                        id: `opt_${attr}_${optVal}`,
                        name: optVal,
                        color: String(((options.length + idx) % 8) + 1)
                    };
                    options.push(item);
                    optMap.set(optVal, item);
                }
            });
        }

        const meta = getColumnMeta(tagName, attr);
        const displayName = schemaField?.label || meta?.name || attr;
        const colType = schemaField?.type || meta?.type || "select";

        avColumns.push({
            id: colId,
            name: displayName,
            type: colType,
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
            const schemaField = schemaMap.get(attr.toLowerCase());
            const colType = schemaField?.type || "select";
            const aIdx = columnsList.indexOf(attr);
            const val = aIdx !== -1 && rowArr[aIdx] !== null && rowArr[aIdx] !== undefined ? String(rowArr[aIdx]) : "";

            let cellValue: any = null;
            let valueType = colType;

            if (colType === "checkbox") {
                valueType = "checkbox";
                cellValue = {
                    id: `${rowId}_${colId}`,
                    keyID: colId,
                    blockID: rowId,
                    type: "checkbox",
                    checkbox: {
                        checked: val === "true" || val === "1"
                    }
                };
            } else if (colType === "number") {
                valueType = "number";
                const num = Number(val);
                cellValue = {
                    id: `${rowId}_${colId}`,
                    keyID: colId,
                    blockID: rowId,
                    type: "number",
                    number: {
                        content: isNaN(num) ? 0 : num,
                        isNotEmpty: val.trim() !== ""
                    }
                };
            } else if (colType === "date") {
                valueType = "date";
                const ts = new Date(val).getTime();
                cellValue = {
                    id: `${rowId}_${colId}`,
                    keyID: colId,
                    blockID: rowId,
                    type: "date",
                    date: {
                        content: isNaN(ts) ? Date.now() : ts,
                        isNotEmpty: val.trim() !== "",
                        hasEndDate: false
                    }
                };
            } else if (colType === "select" || colType === "mSelect") {
                valueType = "select";
                const optColor = schemaField?.options?.find(o => o.name === val)?.color || "1";
                const selectItems = val ? [{
                    id: `opt_${attr}_${val}`,
                    content: val,
                    name: val,
                    color: optColor
                }] : [];

                cellValue = {
                    id: `${rowId}_${colId}`,
                    keyID: colId,
                    blockID: rowId,
                    type: "select",
                    mSelect: selectItems
                };
            } else {
                valueType = "text";
                cellValue = {
                    id: `${rowId}_${colId}`,
                    keyID: colId,
                    blockID: rowId,
                    type: "text",
                    text: {
                        content: val
                    }
                };
            }

            cells.push({
                id: `${rowId}_${colId}`,
                color: "",
                bgColor: "",
                valueType,
                value: cellValue
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
