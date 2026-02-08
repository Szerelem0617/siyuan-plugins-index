# 项目架构总结

本项目是一个思源笔记（SiYuan）插件，旨在提供增强的目录（Index）、大纲（Outline）和数据库（Database）功能。

## 目录结构与模块说明

- **`src/index.ts`**: 插件入口。负责生命周期管理、事件总线监听（通过具体子目录直接引入）及初始化。
- **`src/core/`**: 核心基础功能（配置、斜杠命令）。
- **`src/features/`**: 业务功能模块。
    - `index/`, `outline/`, `builder/`, `notebook/`: 各自独立的业务模块。
    - **`data/`**: 数据转换与同步功能（已极致解耦）。
        - **`list/`**: 所有**从列表触发**的逻辑。
            - `action.ts`: 包含“创建数据库” (`createDatabaseWithBlocks`) 和“数据库视图聚焦” (`focusDatabaseView`)。
            - `menu.ts`: 列表块右键菜单处理。
        - **`attribute-view/`**: 所有**在数据库内部**发生的逻辑。
            - `events.ts`: 数据库事件监听与单元格上下文捕获。
            - `menu.ts`: 数据库内部菜单处理（同步、题头图等）。
            - `constants.ts`: 数据库专用视觉常量。
- **`src/shared/`**: 高度解耦的共享资源。
    - `api-client/`: 封装 SDK 及通用的 `post` 请求工具。
    - `constants.ts`: 定义全局共用的自定义属性键名（如 `ATTR_LINKED_AV`）。
    - `utils/`: 通用工具函数。

## 关键技术点

1. **极致解耦**: 彻底废弃了 `index.ts` 聚合文件，外部直接按需引入 `list` 或 `attribute-view` 的具体实现，模块职责极其清晰。
2. **逻辑归位**: `focusDatabaseView` 已回归 `list` 模块，体现了以“触发源”为核心的 Feature 划分原则。
3. **多模式支持**: 数据库增强功能兼顾 `Alt + Click` 快捷操作与原生右键菜单。

## 下一步 Refractor 建议

1.  **列处理器抽象 (Column Processors)**: 为 Icon、题头图、模板编写独立的处理器类。
2.  **UI 组件化**: 将背景选择和模板选择重构为 Svelte 组件。
3.  **错误处理增强**: 在 `shared/api-client/request.ts` 中统一业务错误提示。

## 给思源源码开发者的 Debug 提示 (关于 Emoji 点击精度)

(保留之前的 Emoji 提示部分...)