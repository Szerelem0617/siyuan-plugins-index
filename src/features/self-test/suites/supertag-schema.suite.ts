/**
 * features/self-test/suites/supertag-schema.suite.ts
 *
 * Supertag 属性编码与协议测试套件 (Base32, RFC 4648, Physical Key Generator & Decoder)
 */

import { describe, test } from "../core/test-runner";
import { expect } from "../core/assertion";
import {
    base32Encode,
    base32Decode,
    isLegalAttrIdentifier,
    getPhysicalAttrKey,
    parsePhysicalAttrKey
} from "../../unified-attributes/core/supertag-schema";

export function registerSupertagSchemaSuite() {
    describe("Supertag 编码协议 (Base32 & Physical Keys)", () => {
        test("1. Base32 编码解码对称性测试 (ASCII 与 UTF-8 中文字符)", () => {
            const testStrings = [
                "hello-world",
                "测试标签",
                "🔥进度状态",
                "custom_prop_v1",
                "tag.status.sub_item",
                "1234567890",
                ""
            ];

            for (const str of testStrings) {
                const encoded = base32Encode(new TextEncoder().encode(str));
                // 必须仅包含 [a-z2-7]
                if (encoded.length > 0) {
                    expect(/^[a-z2-7]+$/.test(encoded)).toBe(true);
                }
                const decoded = new TextDecoder().decode(base32Decode(encoded));
                expect(decoded).toBe(str);
            }
        });

        test("2. 思源合法标识符判定 (isLegalAttrIdentifier)", () => {
            expect(isLegalAttrIdentifier("task")).toBe(true);
            expect(isLegalAttrIdentifier("task-status")).toBe(true);
            expect(isLegalAttrIdentifier("item-1")).toBe(true);
            expect(isLegalAttrIdentifier("a-1-b-2")).toBe(true);

            // 非法字符拦截
            expect(isLegalAttrIdentifier("Task")).toBe(false); // 大写
            expect(isLegalAttrIdentifier("task_status")).toBe(false); // 下划线
            expect(isLegalAttrIdentifier("测试")).toBe(false); // 中文
            expect(isLegalAttrIdentifier("task status")).toBe(false); // 空格
            expect(isLegalAttrIdentifier("")).toBe(false); // 空
        });

        test("3. 纯英文合法属性生成保持原生直读 (custom-<tag>-<field>)", () => {
            const key = getPhysicalAttrKey("task", "status");
            expect(key).toBe("custom-task-status");

            const parsed = parsePhysicalAttrKey(key);
            expect(parsed).toBeTruthy();
            expect(parsed?.tag).toBe("task");
            expect(parsed?.slug).toBe("status");
            expect(parsed?.originalName).toBe("status");
            expect(parsed?.isEncoded).toBe(false);
        });

        test("4. 中文 Supertag 自动整段 Base32 编码与无损还原", () => {
            const key = getPhysicalAttrKey("测试标签", "status");
            // 必须满足思源属性只包含小写字母、数字和连字符的硬约束
            expect(key.startsWith("custom-b32-")).toBe(true);
            expect(/^[a-z0-9-]+$/.test(key)).toBe(true);

            const parsed = parsePhysicalAttrKey(key);
            expect(parsed).toBeTruthy();
            expect(parsed?.tag).toBe("测试标签");
            expect(parsed?.slug).toBe("status");
            expect(parsed?.originalName).toBe("status");
            expect(parsed?.isEncoded).toBe(true);
        });

        test("5. 中文字段名与 Emoji 标签组合编码与无损还原", () => {
            const key = getPhysicalAttrKey("🔥项目", "当前进度");
            expect(key.startsWith("custom-b32-")).toBe(true);
            expect(/^[a-z0-9-]+$/.test(key)).toBe(true);

            const parsed = parsePhysicalAttrKey(key);
            expect(parsed).toBeTruthy();
            expect(parsed?.tag).toBe("🔥项目");
            expect(parsed?.slug).toBe("当前进度");
            expect(parsed?.originalName).toBe("当前进度");
            expect(parsed?.isEncoded).toBe(true);
        });

        test("6. 独立自定义属性（无 Supertag 命名空间）编解码", () => {
            // 纯英文字段
            const key1 = getPhysicalAttrKey("", "author");
            expect(key1).toBe("custom-author");
            const parsed1 = parsePhysicalAttrKey(key1);
            expect(parsed1?.tag).toBe("");
            expect(parsed1?.originalName).toBe("author");

            // 中文字段
            const key2 = getPhysicalAttrKey("", "作者");
            expect(key2.startsWith("custom-b32-")).toBe(true);
            const parsed2 = parsePhysicalAttrKey(key2);
            expect(parsed2?.tag).toBe("");
            expect(parsed2?.originalName).toBe("作者");
        });
    }, "unit");
}
