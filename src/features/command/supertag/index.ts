/**
 * src/features/command/supertag/index.ts
 *
 * 超级标签领域 Facade 入口与统一接口导出
 */

export { supertagMonitor, SupertagMonitor } from "./core/supertag-listener";
export { supertagBinder, SupertagBinder } from "./core/supertag-binder";
export { executeTsScript } from "./core/supertag-sandbox";
export { triggerConditionalCommands, parseConditionalString } from "./core/supertag-trigger";
export { persistOutputVariablesToLayer4 } from "./core/supertag-persister";
export { parseSupertags, serializeSupertags, diffSupertags, tagCache } from "./core/supertag-diff";

export { SupertagRenderer } from "./renderer/SupertagRenderer";
export { initTagMenuInterceptor } from "./renderer/tag-menu-interceptor";

export { supertagManager, SupertagManager } from "./manager/supertag-manager";
export { initSupertagPalette, destroySupertagPalette } from "./suggestion/supertag-palette";
