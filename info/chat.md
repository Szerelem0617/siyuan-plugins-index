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



(此处保留之前的内容...)



## 给思源源码开发者的 Debug 提示 (关于数据库命名失败)



我们在尝试通过 API 创建数据库并自动命名时遇到了问题。



**操作背景**:

1.  通过 `insertBlock` 插入一个 `NodeAttributeView` 块。

2.  从返回的 HTML 中通过正则匹配提取 `data-av-id` (例如 `20260208204552-8bkses9`)。

3.  通过 `renderAttributeView` 获取第一个视图的 `viewID` (例如 `20260208204552-a51e6d4`)。

4.  发送一个 `transactions` 请求，尝试修改数据库名称。



**使用的 Transaction 逻辑**:

```json

{

    "action": "setAttrViewName",

    "avID": "20260208204552-8bkses9",

    "data": "新命名的数据库名"

}

```



**问题描述**:

-   日志显示 `avID`、`viewID` 和提取的名称均正确。

-   Transaction 请求发送成功（code 0），但界面和数据上均未生效，数据库名称依然显示为默认或为空。



**需要专家确认的问题**:

1.  **Action 选型**: `setAttrViewName` 到底是修改“数据库（Attribute View）”的总名称，还是修改“视图（View/Tab）”的名称？

2.  **关键参数**: 修改**数据库总名称**（即数据库块顶部的名字）的正确 Action 名称是什么？是否需要在 `data` 之外传入其他 ID（比如 `blockID` 或特定的视图 ID）？

3.  **时机问题**: 在插入数据库块并立即通过 `render` 获取 ID 后发送 Transaction，是否会因为数据库索引未完成而导致失败？是否需要调用特定的同步接口？



**请求**: 请提供 SiYuan 源码中修改数据库名称（Database Name）的核心 Action 定义及所需的完整参数结构。
