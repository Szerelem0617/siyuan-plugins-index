/**
 * features/self-test/suites/supertag-diff.suite.ts
 *
 * Supertag 序列化与 Diff 解析测试套件
 */

import { describe, test } from "../core/test-runner";
import { expect } from "../core/assertion";
import {
    parseSupertags,
    serializeSupertags,
    diffSupertags
} from "../../unified-attributes/core/supertag-diff";

export function registerSupertagDiffSuite() {
    describe("Supertag 标签差分与序列化 (Diff & Parse)", () => {
        test("1. parseSupertags 解析 JSON 数组、逗号与哈希前缀格式", () => {
            // JSON 数组格式
            const raw1 = JSON.stringify(["task", "project", "permanent"]);
            expect(parseSupertags(raw1)).toEqual(["task", "project", "permanent"]);

            // 逗号分隔
            const raw2 = "task, project, permanent";
            expect(parseSupertags(raw2)).toEqual(["task", "project", "permanent"]);

            // 空格与 # 标签
            const raw3 = "#测试标签   #状态_v1";
            expect(parseSupertags(raw3)).toEqual(["测试标签", "状态_v1"]);

            // 空值
            expect(parseSupertags("")).toEqual([]);
            expect(parseSupertags(null)).toEqual([]);
        });

        test("2. serializeSupertags 规范化 JSON 序列化", () => {
            const tags = ["task", "project", "permanent"];
            expect(serializeSupertags(tags)).toBe(JSON.stringify(["task", "project", "permanent"]));

            // 去重与空过滤
            const tagsWithDups = ["task", "", "task", "project"];
            expect(serializeSupertags(tagsWithDups)).toBe(JSON.stringify(["task", "project"]));

            expect(serializeSupertags([])).toBe("");
        });

        test("3. diffSupertags 计算标签的新增与移除集合", () => {
            const oldSet = new Set(["task", "project"]);
            const newSet = new Set(["project", "permanent", "review"]);

            const diff = diffSupertags(oldSet, newSet);
            expect(diff.added).toEqual(["permanent", "review"]);
            expect(diff.removed).toEqual(["task"]);

            // 无变化
            const diffNoChange = diffSupertags(new Set(["task"]), new Set(["task"]));
            expect(diffNoChange.added.length).toBe(0);
            expect(diffNoChange.removed.length).toBe(0);
        });
    }, "unit");
}
