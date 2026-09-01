/**
 * unified-attributes / index.ts
 *
 * IndexOS 统一属性治理与超级标签 (Supertag) 核心模块统一导出入口
 */

// 1. Core
export {
    SupertagMonitor,
    supertagMonitor
} from "./core/supertag-listener";

export {
    SupertagBinder,
    supertagBinder
} from "./core/supertag-binder";

export {
    getUnifiedSupertagList,
    type UnifiedSupertagDefinition,
    type SupertagColumnInfo
} from "./core/supertag-entity";

export {
    parseSupertags,
    serializeSupertags,
    diffSupertags,
    cleanTagString,
    tagCache
} from "./core/supertag-diff";

export {
    evaluateCondition,
    PRESET_CONDITIONS,
    type ConditionContext
} from "./core/condition-evaluator";

export {
    executeTsScript
} from "./core/supertag-sandbox";

export {
    triggerConditionalCommands,
    dispatchScopeEvents,
    parseConditionalString,
    type TriggerCommandRef,
    type TriggerRule
} from "./core/supertag-trigger";

// 2. Projection
export {
    SupertagAVProjector,
    supertagAVProjector,
    getColumnMeta,
    registerColumnMeta,
    type VirtualColumnMeta,
    type VirtualAVBinding
} from "./projection/supertag-av-projector";

export {
    AVProjectionToggleManager,
    avProjectionToggle
} from "./projection/av-projection-toggle";

// 3. Inspector
export {
    loadBlockAttributeData,
    updateBlockAttributeValue,
    updateAVCellAttributeValue,
    toggleSupertagOnBlock,
    type BlockAttributeData,
    type SupertagField,
    type SupertagGroup,
    type AVDatabaseField,
    type AVDatabaseGroup,
    type BuiltinAttributes,
    type RawCustomField,
    type SystemMetadata,
    type TypedFieldOption
} from "./inspector/attribute-model";

export {
    ActiveBlockTracker,
    activeBlockTracker,
    type ActiveBlockContext
} from "./inspector/active-block-tracker";

export {
    initDockInspector,
    updateDockDom,
    DOCK_TYPE
} from "./inspector/dock-inspector";

export {
    openUnifiedAttributeInspector
} from "./inspector/inspector-controller";

// 4. Manager
export {
    SupertagManager,
    supertagManager
} from "./manager/supertag-manager";

// 5. Renderer
export {
    SupertagRenderer
} from "./renderer/SupertagRenderer";

export {
    initTagMenuInterceptor
} from "./renderer/tag-menu-interceptor";

// 6. Suggestion
export {
    initSupertagPalette,
    destroySupertagPalette
} from "./suggestion/supertag-palette";
