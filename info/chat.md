# 项目架构总结

本项目是一个思源笔记（SiYuan）插件，旨在提供增强的目录（Index）、大纲（Outline）和数据库（Database）功能。

## 目录结构与模块说明

- **`src/index.ts`**: 插件入口。负责生命周期管理（`onload`, `onunload`）、事件总线监听（块菜单、文档加载、页签切换）以及各模块的初始化。
- **`src/core/`**: 核心基础功能。
    - `settings/`: 配置管理。定义了 `SettingsProperty` 及其默认值，通过 `Settings` 类实现配置的持久化存储。
    - `slash.ts`: 斜杠（Slash）命令的注册与处理逻辑。
- **`src/features/`**: 业务功能模块化实现。
    - `index/`: 实现文档子文档目录的自动生成与更新逻辑。
    - `outline/`: 实现文档内标题大纲的提取、格式化及插入逻辑。
    - `builder/`: 提供更复杂的文档构建器功能，支持深度定制和自动同步。
    - **`data/`**: 数据转换与同步功能（已进行解耦重构）。
        - `index.ts`: 统一导出点。
        - **`list/`**: 列表块相关操作。
            - `action.ts`: 列表转数据库核心逻辑 (`createDatabaseWithBlocks`)。
            - `menu.ts`: 针对列表块的右键菜单回调。
        - **`attribute-view/`**: 数据库（AV）相关增强。
            - `action.ts`: 数据库视图聚焦逻辑 (`focusDatabaseView`)。
            - `events.ts`: 数据库事件监听与单元格上下文捕获（支持 Alt+Click 和 ContextMenu）。
            - `menu.ts`: 数据库内部同步及增强功能的菜单 handler。
            - `constants.ts`: 数据库专用视觉常量（如题头图背景）。
    - `notebook/`: 实现笔记本级别的目录索引生成。
- **`src/events/`**: 插件级通用事件处理。
- **`src/shared/`**: 高度解耦的共享资源。
    - `api-client/`: 封装 SiYuan SDK 及 `post` 请求工具。
    - `constants.ts`: 定义全局共用的自定义属性键名（如 `ATTR_LINKED_AV`）。
    - `utils/`: 通用工具函数（图标、Markdown 处理等）。
- **`src/ui/`**: 界面展示层。基于 Svelte 的组件化 UI。

## 关键技术点

1. **解耦设计**: 采用 Feature-based 目录结构，业务逻辑（Action）、交互逻辑（Menu）与事件驱动（Events）清晰分离。
2. **多模式触发**: 数据库增强功能同时支持 `Alt + Click`（快捷操作）和 SiYuan 原生右键菜单（`open-menu-av`），兼顾效率与发现性。
3. **自动化更新**: 监听 Protyle 生命周期事件，确保目录大纲与内容的实时一致性。
4. **属性持久化**: 利用 `custom-attr` 在列表与数据库之间建立稳固的双向映射。

## 下一步 Refractor 建议

1.  **列处理器抽象 (Column Processors)**: 目前 `events.ts` 中处理 Icon、题头图、模板的逻辑混合在一起。建议抽象出 `IColumnProcessor` 接口，为不同列类型编写独立的处理器类。
2.  **上下文管理强化**: `lastClickedAVCell` 是一个全局变量。建议引入一个单例 `EditorContext` 来管理当前活动的编辑器实例、选中的块/单元格，提高可靠性。
3.  **UI 组件化**: 数据库增强功能中的“内置背景选择”和“模板选择”目前仍使用原生 DOM 操作生成。建议将其重构为独立的 Svelte 组件，利用 Svelte 的声明式渲染简化代码。
4.  **统一 API 错误处理**: 在 `src/shared/api-client/request.ts` 中增加通用的错误捕获与用户提示（Message）逻辑，减少业务代码中的重复 try-catch。


