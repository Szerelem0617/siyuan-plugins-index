import { isDevModeActive } from "./index";
import type { PluginFeature } from "./features";

// 定义普通模式（未开启开发者模式）下允许的功能白名单
const USER_MODE_FEATURES = new Set<PluginFeature>([
    "data.addTemplateCols",
    "database.diagnose"
]);

// 定义开发者模式下允许的功能白名单（全量功能）
const DEV_MODE_FEATURES = new Set<PluginFeature>([
    "commands.pull",
    "commands.management",
    "database.diagnose",
    "database.reset",
    "outline.reverse",
    "data.addTemplateCols"
]);

/**
 * 校验当前用户是否有权使用某项插件功能。
 * @param feature 功能标识符
 */
export function canUseFeature(feature: PluginFeature): boolean {
    const isDev = isDevModeActive();
    return isDev ? DEV_MODE_FEATURES.has(feature) : USER_MODE_FEATURES.has(feature);
}
