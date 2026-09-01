import { describe, test } from "../core/test-runner";
import { expect } from "../core/assertion";
import { renderTemplate } from "../../command/utils/template-engine";
import { parseParam, mergeParamSources, resolveVarExpression } from "../../command/dispatcher/param-resolver";

export function registerParamResolverSuite() {
    describe("命令参数解析与模板插值 (Param Resolver & Template Engine)", () => {
        test("1. 基础上下文变量插值 (renderTemplate)", () => {
            const variables = {
                supertag: "task",
                blockId: "20260901120000-abcdefg"
            };

            const template = "Tag is {{supertag}}, Block ID is {{blockId}}";
            const resolved = renderTemplate(template, variables);

            expect(resolved).toBe("Tag is task, Block ID is 20260901120000-abcdefg");
        });

        test("2. 自定义作用域变量插值", () => {
            const variables = {
                userName: "Alex",
                projectName: "IndexOS-Platform"
            };

            const template = "Hello {{userName}}, welcome to {{projectName}}!";
            const resolved = renderTemplate(template, variables);

            expect(resolved).toBe("Hello Alex, welcome to IndexOS-Platform!");
        });

        test("3. Class Method 模式下的属性映射 ({{attr:key}})", () => {
            const variables = {
                "attr:status": "done",
                "attr:priority": "high"
            };

            const template = "Status: {{attr:status}}, Priority: {{attr:priority}}";
            const resolved = renderTemplate(template, variables, true);

            expect(resolved).toBe("Status: done, Priority: high");
        });

        test("4. 参数 JSON 字符串与对象安全解析 (parseParam)", () => {
            const jsonStr = JSON.stringify({ key: "val", count: 10 });
            expect(parseParam(jsonStr)).toEqual({ key: "val", count: 10 });

            // 非法 JSON 容错
            expect(parseParam("invalid json")).toEqual({});
            expect(parseParam(null)).toEqual({});
            expect(parseParam(undefined)).toEqual({});
        });

        test("5. 多层级参数源合并优先级 (mergeParamSources)", () => {
            const sources = {
                commandDb: { defaultVal: "base", shared: "from_db" },
                auto: { autoVal: "auto_injected", shared: "from_auto" },
                manual: { manualVal: "user_custom", shared: "from_manual" }
            };

            const merged = mergeParamSources(sources as any);
            expect(merged.defaultVal).toBe("base");
            expect(merged.autoVal).toBe("auto_injected");
            expect(merged.manualVal).toBe("user_custom");
            // manual 覆盖优先级最高
            expect(merged.shared).toBe("from_manual");
        });

        test("6. 内存运行时出参优先读取 (context.vars)", () => {
            const context: any = {
                vars: {
                    createdblock: "20260901123456-stepout",
                    last_id: "20260901123456-lastid"
                }
            };

            expect(resolveVarExpression("var.createdblock", context, {})).toBe("20260901123456-stepout");
            expect(resolveVarExpression("createdblock", context, {})).toBe("20260901123456-stepout");
            expect(resolveVarExpression("var.last_id", context, {})).toBe("20260901123456-lastid");
        });

        test("7. Supertag 上下文局部属性优先于全局同名属性", () => {
            const context: any = {
                supertag: "task"
            };
            const blockAttrs = {
                "custom-status": "global_status_val",
                "custom-tag--task--status": "local_task_status_val"
            };

            // 在 #task 上下文下，裸 var.status 优先命中 local
            expect(resolveVarExpression("var.status", context, blockAttrs)).toBe("local_task_status_val");
            expect(resolveVarExpression("status", context, blockAttrs)).toBe("local_task_status_val");
        });

        test("8. 显式全局逃逸 (var.global.prop / var.global-prop)", () => {
            const context: any = {
                supertag: "task"
            };
            const blockAttrs = {
                "custom-status": "global_status_val",
                "custom-tag--task--status": "local_task_status_val",
                "name": "My Block Title",
                "memo": "My Memo"
            };

            // 显式逃逸读取全局属性
            expect(resolveVarExpression("var.global.status", context, blockAttrs)).toBe("global_status_val");
            expect(resolveVarExpression("var.global-status", context, blockAttrs)).toBe("global_status_val");
            expect(resolveVarExpression("global.status", context, blockAttrs)).toBe("global_status_val");

            // 显式逃逸读取原生特权属性
            expect(resolveVarExpression("var.global.name", context, blockAttrs)).toBe("My Block Title");
            expect(resolveVarExpression("var.global.memo", context, blockAttrs)).toBe("My Memo");
        });

        test("9. 显式跨标签路由 (var.<tag>.<prop>)", () => {
            const context: any = {
                supertag: "task"
            };
            const blockAttrs = {
                "custom-tag--task--status": "task_status_val",
                "custom-tag--article--word_count": "1500",
                "custom-tag--permanent--card-id": "20260901120000-cardid"
            };

            expect(resolveVarExpression("var.article.word_count", context, blockAttrs)).toBe("1500");
            expect(resolveVarExpression("var.permanent.card-id", context, blockAttrs)).toBe("20260901120000-cardid");
            expect(resolveVarExpression("article.word_count", context, blockAttrs)).toBe("1500");
        });

        test("10. 缺省裸属性在无局部属性时自动降级命中全局属性或其他 Tag 属性", () => {
            const context: any = {
                supertag: "project"
            };
            const blockAttrs = {
                "custom-task": "completed",
                "custom-tag--permanent--card-id": "20260901120000-cardid"
            };

            // project 下没有 task，自动命中 custom-task
            expect(resolveVarExpression("var.task", context, blockAttrs)).toBe("completed");
            // project 下没有 card-id，自动命中挂载的 permanent card-id
            expect(resolveVarExpression("var.card-id", context, blockAttrs)).toBe("20260901120000-cardid");
        });
    }, "unit");
}
