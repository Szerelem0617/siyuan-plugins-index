export const NOTEBOOK_NAME = "IndexOS";
export const NOTEBOOK_ICON = "1f42c"; // 🐬

export interface ColumnMeta {
    name: string;
    type: string;
    icon: string;
}

export interface DbPageConfig {
    title: string;
    attrName: string;
    markdown: string;
    expectedColName: string;
    columns: ColumnMeta[];
}

export const COMMAND_DB_CONFIG: DbPageConfig = {
    title: "command-db",
    attrName: "custom-index-command-db",
    markdown: `该页面由 IndexOS 自动生成。这里是系统的 Layer 2，用于编排复合指令和参数流转。\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>\n`,
    expectedColName: "Command ID",
    columns: [
        { name: "Command ID", type: "text", icon: "iconCode" },
        { name: "Param Mapping", type: "text", icon: "iconList" },
        { name: "UI 入口", type: "text", icon: "iconLayout" }
    ]
};

export const TYPE_DB_CONFIG: DbPageConfig = {
    title: "supertag-db",
    attrName: "custom-index-supertag-db",
    markdown: `该页面由 IndexOS 自动生成。这里是系统的 Layer 3，用于将逻辑工厂中的复合命令绑定到特定的 Supertag 上，并配置参数映射。**主键（第一列）即为需要绑定的 Supertag 名称（如 project 或 任何类名）。**\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>\n`,
    expectedColName: "Icon Menu",
    columns: [
        { name: "Icon Menu", type: "text", icon: "iconMenu" },
        { name: "Conditional", type: "text", icon: "iconPlay" }
    ]
};

export const DATA_DBS_CONFIG = {
    title: "data-dbs",
    attrName: "custom-index-data-dbs"
};

export interface DefaultRelationRule {
    typeLabel: string;
    commandLabels: string[];
}

export const DEFAULT_RELATION_BINDINGS: DefaultRelationRule[] = [
    {
        typeLabel: "project",
        commandLabels: ["全局关系图"]
    },
    {
        typeLabel: "task",
        commandLabels: ["☑ 转换为任务", "转换为任务", "🎆 烟花", "烟花"]
    },
    {
        typeLabel: "pipeline",
        commandLabels: ["⚡ API 插入块测试", "API 插入块测试", "📝 安全更新块内容", "安全更新块内容"]
    },
    {
        typeLabel: "permanent",
        commandLabels: ["📝 安全更新块内容", "安全更新块内容"]
    }
];
