/**
 * features/self-test/suites/param-resolver.suite.ts
 *
 * 参数解析与命令变量插值测试套件 (Param Resolver & Template Engine)
 */

import { describe, test } from "../core/test-runner";
import { expect } from "../core/assertion";
import { renderTemplate } from "../../command/utils/template-engine";
import { parseParam, mergeParamSources } from "../../command/dispatcher/param-resolver";

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
    }, "unit");
}
