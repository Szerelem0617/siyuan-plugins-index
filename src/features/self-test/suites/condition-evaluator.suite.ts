/**
 * features/self-test/suites/condition-evaluator.suite.ts
 *
 * 条件求值器与触发器规则测试套件 (Condition Evaluator & Trigger Parser)
 */

import { describe, test } from "../core/test-runner";
import { expect } from "../core/assertion";
import { evaluateCondition, type ConditionContext } from "../../unified-attributes/core/condition-evaluator";
import { parseConditionalString } from "../../unified-attributes/core/supertag-trigger";

export function registerConditionEvaluatorSuite() {
    describe("条件表达式求值与触发器规则 (Condition & DSL)", () => {
        test("1. 基础等值与不等值比较", () => {
            const ctx: ConditionContext = {
                attrs: {
                    "custom-task-status": "done",
                    "custom-priority": "high",
                    "custom-count": "5"
                }
            };

            expect(evaluateCondition("custom-task-status == 'done'", ctx)).toBe(true);
            expect(evaluateCondition("custom-task-status == 'pending'", ctx)).toBe(false);
            expect(evaluateCondition("custom-priority != 'low'", ctx)).toBe(true);
            expect(evaluateCondition("custom-count == 5", ctx)).toBe(true);
        });

        test("2. 逻辑运算符 (&&, ||)", () => {
            const ctx: ConditionContext = {
                attrs: {
                    "custom-status": "in_progress",
                    "custom-priority": "high"
                }
            };

            // AND 满足
            expect(evaluateCondition("custom-status == 'in_progress' && custom-priority == 'high'", ctx)).toBe(true);
            // AND 不满足
            expect(evaluateCondition("custom-status == 'in_progress' && custom-priority == 'low'", ctx)).toBe(false);

            // OR 满足
            expect(evaluateCondition("custom-status == 'done' || custom-status == 'in_progress'", ctx)).toBe(true);
            // OR 不满足
            expect(evaluateCondition("custom-status == 'done' || custom-priority == 'low'", ctx)).toBe(false);
        });

        test("3. 触发器声明式规则解析 (parseConditionalString)", () => {
            const dsl = `
                // 忽略纯注释行
                [新建] custom-status == 'pending' -> index.setBlockAttribute(status='done')
                [挂载] custom-priority == 'high' -> index.visualEffect(type='fireworks')
                [移除] -> index.showToast(msg='Tag Removed')
            `;

            const rules = parseConditionalString(dsl);
            expect(rules.length).toBe(3);

            // 规则 1：新建块事件 (block_created) + 显式条件 + 命令与入参
            expect(rules[0].event).toBe("block_created");
            expect(rules[0].condition).toBe("custom-status == 'pending'");
            expect(rules[0].commands.length).toBe(1);
            expect(rules[0].commands[0].labelOrId).toBe("index.setBlockAttribute");

            // 规则 2：挂载标签事件 (tag_created)
            expect(rules[1].event).toBe("tag_created");
            expect(rules[1].condition).toBe("custom-priority == 'high'");
            expect(rules[1].commands.length).toBe(1);
            expect(rules[1].commands[0].labelOrId).toBe("index.visualEffect");

            // 规则 3：移除标签事件 (tag_removed) + 空条件 + Toast 命令
            expect(rules[2].event).toBe("tag_removed");
            expect(rules[2].condition).toBe("");
            expect(rules[2].commands.length).toBe(1);
            expect(rules[2].commands[0].labelOrId).toBe("index.showToast");
        });
    }, "unit");
}
