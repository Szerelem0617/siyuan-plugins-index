/**
 * dispatcher/index.ts
 *
 * 模块化统一导出 IndexOS 命令调度器子系统
 */

export * from "./types";
export * from "./context-builder";
export * from "./param-resolver";
export * from "./executors";
export * from "./dispatcher-core";

// 兼容老代码的默认与命名导出
export { dispatchCommand } from "./dispatcher-core";
export { getBlockId } from "../utils/context-extractor";
