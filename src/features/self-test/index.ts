/**
 * features/self-test/index.ts
 *
 * Self-Test 自检诊断模块入口
 */

import { Dialog } from "siyuan";
import SelfTestDialog from "./ui/SelfTestDialog.svelte";
import { runAllTests, type TestReport } from "./core/test-runner";
import { registerSupertagSchemaSuite } from "./suites/supertag-schema.suite";
import { registerSupertagDiffSuite } from "./suites/supertag-diff.suite";
import { registerConditionEvaluatorSuite } from "./suites/condition-evaluator.suite";
import { registerParamResolverSuite } from "./suites/param-resolver.suite";
import { registerApiSandboxSuite } from "./suites/api-sandbox.suite";
import { registerAttributePipelineSuite } from "./suites/attribute-pipeline.suite";

export { expect, AssertionError } from "./core/assertion";
export { describe, test, it, runAllTests } from "./core/test-runner";

let isSuitesRegistered = false;

export function ensureAllSuitesRegistered() {
    if (!isSuitesRegistered) {
        registerSupertagSchemaSuite();
        registerSupertagDiffSuite();
        registerConditionEvaluatorSuite();
        registerParamResolverSuite();
        registerAttributePipelineSuite();
        registerApiSandboxSuite();
        isSuitesRegistered = true;
    }
}

/**
 * 离线/静默运行全量自检套件 (可用于后台或自动化脚本)
 */
export async function runAllSelfTests(): Promise<TestReport> {
    ensureAllSuitesRegistered();
    return await runAllTests();
}

/**
 * 打开自检诊断可视化面板
 */
export function openSelfTestDialog() {
    ensureAllSuitesRegistered();

    const dialog = new Dialog({
        title: "IndexOS 核心自检诊断控制台",
        content: `<div id="self-test-container" style="height: 100%;"></div>`,
        width: "820px",
        height: "580px",
    });

    dialog.element.classList.add("indexos-dialog");
    dialog.element.querySelector('.b3-dialog__header')?.remove();

    new SelfTestDialog({
        target: dialog.element.querySelector("#self-test-container")!,
        props: {
            dialog
        }
    });
}
