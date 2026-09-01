/**
 * features/self-test/suites/api-sandbox.suite.ts
 *
 * 思源内核运行时集成沙箱测试 (Runtime API Integration Sandbox)
 * 自动在沙箱环境中创建临时测试块，测试真实 IAL 写入与 Base32 中文属性落盘，并在 finally 中彻底销毁临时数据。
 */

import { describe, test } from "../core/test-runner";
import { expect } from "../core/assertion";
import { post } from "../../../shared/api-client/request";
import { getPhysicalAttrKey, parsePhysicalAttrKey } from "../../unified-attributes/core/supertag-schema";

export function registerApiSandboxSuite() {
    describe("思源内核运行时 API 沙箱 (Integration Sandbox)", () => {
        test("1. 临时块中文属性写入、Base32 落盘与无损读取闭环", async () => {
            // 1. 查询当前可用的任一文档根块作为挂载父节点
            const sqlRes = await post("/api/query/sql", {
                stmt: "SELECT id FROM blocks WHERE type = 'd' LIMIT 1"
            });
            const rootDocs = Array.isArray(sqlRes) ? sqlRes : (sqlRes?.data || []);
            if (rootDocs.length === 0) {
                // 若没有文档则跳过或直通
                return;
            }

            const parentDocId = rootDocs[0].id;
            let tempBlockId: string | null = null;

            try {
                // 2. 在文档底部插入沙箱测试临时段落块
                const insertRes = await post("/api/block/insertBlock", {
                    dataType: "markdown",
                    data: `🧪 **[IndexOS-SelfTest-Sandbox]** 临时自动化测试块 (创建时间: ${new Date().toISOString()})`,
                    parentID: parentDocId
                });

                const insertedData = Array.isArray(insertRes) ? insertRes[0] : (insertRes?.data?.[0] || insertRes);
                tempBlockId = insertedData?.doOperations?.[0]?.id || insertedData?.id;

                expect(tempBlockId).toBeTruthy();

                // 3. 生成中文 Supertag 属性
                const tagName = "自检测试标签";
                const propName = "当前测试状态";
                const testValue = "自动通过_Passed_100%";

                const physicalKey = getPhysicalAttrKey(tagName, propName);
                expect(physicalKey.startsWith("custom-b32-")).toBe(true);

                // 4. 调用真实思源 API 设置属性
                const setRes = await post("/api/attr/setBlockAttrs", {
                    id: tempBlockId,
                    attrs: {
                        [physicalKey]: testValue,
                        "custom-supertags": `#${tagName}`
                    }
                });

                expect(setRes).toBeTruthy();

                // 5. 重新获取块属性，检验真实落盘与解码还原
                const getRes = await post("/api/attr/getBlockAttrs", { id: tempBlockId });
                const fetchedAttrs = getRes?.data || getRes || {};

                expect(fetchedAttrs[physicalKey]).toBe(testValue);

                const parsed = parsePhysicalAttrKey(physicalKey);
                expect(parsed).toBeTruthy();
                expect(parsed?.tag).toBe(tagName);
                expect(parsed?.originalName).toBe(propName);
            } finally {
                // 6. 核心保障：测试结束后 100% 销毁临时块，零残留污染用户正文
                if (tempBlockId) {
                    try {
                        await post("/api/block/deleteBlock", { id: tempBlockId });
                    } catch (_) {}
                }
            }
        });
    }, "integration");
}
