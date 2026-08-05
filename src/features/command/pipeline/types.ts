/**
 * pipeline/types.ts
 * 命令 Pipeline（复合命令）数据模型 v1
 *
 * 设计文档：docs/pipeline-design.md
 * 原则：JSON 管编排（顺序/绑定/跳过/延迟），script 步骤管算法（循环/复杂逻辑）。
 */

export const PIPELINE_VERSION = 1;

export type PipelineStepType = "command" | "script";

export interface PipelineStep {
    /** 步骤类型，默认 "command" */
    type?: PipelineStepType;
    /** type=command 必填：已注册命令 ID（可以是另一个复合命令） */
    commandRef?: string;
    /** 是否执行本步，默认 true */
    enabled?: boolean;
    /** 执行本步前等待毫秒，默认 0 */
    delayMs?: number;
    /** 命令入参（#1 人为规划），逐键覆盖 Command-DB 配置；空键 = 用 Command-DB 默认 */
    params?: Record<string, unknown>;
    /** type=script 必填：TS 脚本正文 */
    code?: string;
}

export interface PipelineConfig {
    version: number;
    name: string;
    steps: PipelineStep[];
}

export interface ValidationResult {
    ok: boolean;
    errors: string[];
}

export function validatePipeline(config: unknown): ValidationResult {
    const errors: string[] = [];
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        return { ok: false, errors: ["pipeline 配置必须是一个对象"] };
    }
    const c = config as Partial<PipelineConfig>;
    if (c.version !== PIPELINE_VERSION) {
        errors.push(`pipeline version 应为 ${PIPELINE_VERSION}，当前为 ${String(c.version)}`);
    }
    if (!c.name || typeof c.name !== "string" || !c.name.trim()) {
        errors.push("pipeline name 缺失");
    }
    if (!Array.isArray(c.steps) || c.steps.length === 0) {
        errors.push("pipeline steps 必须是非空数组");
    } else {
        c.steps.forEach((step, i) => {
            const s = (step || {}) as PipelineStep;
            const type = s.type || "command";
            if (type === "command") {
                if (!s.commandRef || typeof s.commandRef !== "string") {
                    errors.push(`步骤 ${i}: command 类型缺少 commandRef`);
                }
            } else if (type === "script") {
                if (!s.code || typeof s.code !== "string" || !s.code.trim()) {
                    errors.push(`步骤 ${i}: script 类型缺少 code`);
                }
            } else {
                errors.push(`步骤 ${i}: 未知 type "${type}"`);
            }
            if (s.enabled !== undefined && typeof s.enabled !== "boolean") {
                errors.push(`步骤 ${i}: enabled 应为布尔值`);
            }
            if (s.delayMs !== undefined && (typeof s.delayMs !== "number" || s.delayMs < 0)) {
                errors.push(`步骤 ${i}: delayMs 应为非负数字`);
            }
            if (s.params !== undefined && (typeof s.params !== "object" || s.params === null || Array.isArray(s.params))) {
                errors.push(`步骤 ${i}: params 应为对象`);
            }
        });
    }
    return { ok: errors.length === 0, errors };
}
