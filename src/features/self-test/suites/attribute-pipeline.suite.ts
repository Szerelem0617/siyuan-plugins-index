/**
 * attribute-pipeline.suite.ts
 *
 * 自动化测试套件：4-Stage 属性键解析流水线 (Resolution Pipeline)
 * 验证在各种调用上下文与参数语法下，属性物理键名生成的严格正确性。
 */

import { describe, test } from "../core/test-runner";
import { expect } from "../core/assertion";
import { resolveTargetAttributeKey } from "../../command/effect/set-block-attribute";

export function registerAttributePipelineSuite() {
    describe("属性键解析流水线 (4-Stage Resolution Pipeline)", () => {
        test("1. 原生内置属性特权通行 (name, memo, alias, bookmark)", async () => {
            const res1 = await resolveTargetAttributeKey("name", "测试标题", "task");
            expect(res1.physicalKey).toBe("name");
            expect(res1.isNative).toBe(true);

            const res2 = await resolveTargetAttributeKey("memo", "测试备注", "");
            expect(res2.physicalKey).toBe("memo");
            expect(res2.isNative).toBe(true);

            const res3 = await resolveTargetAttributeKey("alias", "别名", "project");
            expect(res3.physicalKey).toBe("alias");
            expect(res3.isNative).toBe(true);
        });

        test("2. 显式全局逃逸 (global.prop) 无论何种上下文均直写 custom-<prop>", async () => {
            // Supertag 上下文下使用 global.task
            const res1 = await resolveTargetAttributeKey("global.task", "pending", "task");
            expect(res1.physicalKey).toBe("custom-task");
            expect(res1.isScoped).toBe(false);

            // Supertag 上下文下使用 global.status
            const res2 = await resolveTargetAttributeKey("global.status", "ready", "task");
            expect(res2.physicalKey).toBe("custom-status");
            expect(res2.isScoped).toBe(false);

            // 全局上下文下使用 global.my-name
            const res3 = await resolveTargetAttributeKey("global.my-name", "Alice", "");
            expect(res3.physicalKey).toBe("custom-my-name");
            expect(res3.isScoped).toBe(false);
        });

        test("3. 显式跨标签路由 (tag.prop) 准确归属指定 Supertag 命名空间", async () => {
            // 在 #task 上下文中显式为 project.deadline 赋值
            const res1 = await resolveTargetAttributeKey("project.deadline", "2026-10-01", "task");
            expect(res1.physicalKey).toBe("custom-tag--project--deadline");
            expect(res1.isScoped).toBe(true);
            expect(res1.targetTag).toBe("project");

            // 在无标签全局上下文中显式为 article.word-count 赋值 (合规英文连字符)
            const res2 = await resolveTargetAttributeKey("article.word-count", "1500", "");
            expect(res2.physicalKey).toBe("custom-tag--article--word-count");
            expect(res2.isScoped).toBe(true);
            expect(res2.targetTag).toBe("article");

            // 跨标签指定中文属性 (自动整段 Base32 编码)
            const res3 = await resolveTargetAttributeKey("article.字数统计", "2000", "");
            expect(res3.physicalKey.startsWith("custom-b32-")).toBe(true);
            expect(res3.isScoped).toBe(true);
            expect(res3.targetTag).toBe("article");
        });

        test("4. 缺省裸字段在 Supertag 上下文中自动吸附专属命名空间 (custom-tag--<tag>--<field>)", async () => {
            const res = await resolveTargetAttributeKey("status", "pending", "task");
            expect(res.physicalKey).toBe("custom-tag--task--status");
            expect(res.isScoped).toBe(true);
            expect(res.targetTag).toBe("task");
        });

        test("5. 缺省裸字段在全局独立上下文中直接存为全局属性 (custom-<field>)", async () => {
            const res1 = await resolveTargetAttributeKey("status", "active", "");
            expect(res1.physicalKey).toBe("custom-status");
            expect(res1.isScoped).toBe(false);

            // 带连字符的普通属性在全局上下文绝不产生歧义
            const res2 = await resolveTargetAttributeKey("user-age", "25", "");
            expect(res2.physicalKey).toBe("custom-user-age");
            expect(res2.isScoped).toBe(false);
        });

        test("6. 物理原键直通，杜绝二次套娃与重复加前缀", async () => {
            const res1 = await resolveTargetAttributeKey("custom-tag--task--status", "done", "task");
            expect(res1.physicalKey).toBe("custom-tag--task--status");

            const res2 = await resolveTargetAttributeKey("custom-task", "completed", "task");
            expect(res2.physicalKey).toBe("custom-task");
        });
    }, "unit");
}
