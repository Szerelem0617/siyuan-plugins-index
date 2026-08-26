/**
 * command-db-auto-context.ts
 * Command-DB (Layer 2) 专属 Auto-Context 词库与快捷 Token 配置
 *
 * 架构原则：
 * 1. 本模块与 Pipeline / 序列流的 smart-bindings.ts 彻底解耦，独立维护 Command-DB 的显式化配置；
 * 2. Layer 2 是能独立直接执行的默认通用绑定层，快捷词库优先提供通用独立可执行的系统变量 (如 {{block_id}}, {{prompt}}, {{time}})；
 */

export interface CommandDbTokenOption {
    token: string;
    label: string;
    description: string;
}

/** 为 Command-DB 参数类型分配的可快捷点选的 Token 胶囊列表 */
export function getCommandDbTokens(paramKey: string, paramType?: string): CommandDbTokenOption[] {
    const isBlockIdParam = paramKey === "id" || paramType === "blockid";

    // enum 类型使用专属下拉框呈现，无需通用文本插值胶囊
    if (paramType === "enum") {
        return [];
    }

    if (isBlockIdParam) {
        return [
            {
                token: "{{self.id}}",
                label: "⚡ {{self.id}}",
                description: "显式绑定当前触发上下文实体的 ID"
            }
        ];
    }

    // 默认/字符串类型通用常用 Token
    return [
        {
            token: "{{prompt:请输入内容}}",
            label: "💬 {{prompt:...}}",
            description: "执行时弹窗提示用户交互式输入"
        },
        {
            token: "{{time}}",
            label: "🕒 {{time}}",
            description: "动态插入当前时间 (HH:mm:ss)"
        },
        {
            token: "{{date}}",
            label: "📅 {{date}}",
            description: "动态插入当前日期 (YYYY-MM-DD)"
        }
    ];
}

/** 为 Command-DB 参数生成显式的推荐 Placeholder 提示 */
export function getCommandDbPlaceholder(paramKey: string, paramType?: string, paramDefault?: any, _paramDesc?: string): string {
    const isBlockIdParam = paramKey === "id" || paramType === "blockid";

    if (isBlockIdParam) {
        return "显式推荐: {{block_id}} (点下方胶囊一键填入)";
    }

    if (paramDefault !== undefined && String(paramDefault).trim() !== "") {
        return `默认预设: ${paramDefault}`;
    }

    return "请输入内容 (可写 {{prompt}} 等变量)";
}
