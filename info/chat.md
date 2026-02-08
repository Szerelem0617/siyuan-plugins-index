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
    - `data/`: 数据转换与同步功能。
        - `action.ts`: 核心逻辑实现，如“创建数据库”及数据库视图聚焦。
        - `menu.ts`: 统一管理块菜单（Context Menu）项。目前已集成数据库单元格的右键菜单功能。
        - `av-events.ts`: 数据库增强功能处理类，支持属性向上/向下同步、图标/题头图/模板选择等。
    - `notebook/`: 实现笔记本级别的目录索引生成。
- **`src/events/`**: 事件处理逻辑。
    - `protyle-event.ts`: 监听 Protyle 编辑器的静态加载和切换事件，驱动目录和大纲的自动更新。
    - `emoji-event.ts`: 处理内置 Emoji 的点击事件，支持在编辑器中直接触发 Emoji 选择器。
- **`src/shared/`**: 共享资源。
    - `api-client/`: 封装了 SiYuan SDK，提供 `BlockService` 等高层服务，支持带属性绑定的块插入与更新（支持大纲结构的自动修复）。
    - `utils/`: 包含图标处理、Markdown 转换、队列处理等通用工具函数。
- **`src/ui/`**: 界面展示层。
    - `topbar.ts`: 定义顶栏图标及主弹窗逻辑。
    - `components/`: 基于 Svelte 的 UI 组件，涵盖设置面板及各类功能对话框。

## 关键技术点

1. **解耦设计**: 业务逻辑高度模块化，通过 `src/features` 分类管理，便于维护和扩展。
2. **菜单驱动**: 摒弃了 `Alt + Click` 等隐蔽的交互方式，全面转向 SiYuan 原生的右键菜单（`click-blockicon`），提升了功能的可发现性和易用性。
3. **自动化更新**: 通过监听 `loaded-protyle-static` 和 `switch-protyle` 事件，实现目录和大纲的无感同步。
4. **属性同步**: 针对数据库（Attribute View）实现了深度的属性同步逻辑（向上/向下），极大地方便了大规模文档元数据的管理。
5. **Svelte 集成**: 使用 Svelte 构建响应式 UI，提供流畅的用户配置体验。

## 给思源源码开发者的 Debug 提示

为了将“创建数据库”、“向上/向下同步”等功能完美集成到 SiYuan 的右键菜单中，我们需要确认以下信息：

1.  **AV 单元格的右键事件机制**:
    - 当用户在数据库（Attribute View）的单元格（`.av__cell`）上点击右键时，触发的是哪个 EventBus 事件？（例如：是 `click-blockicon`，还是 `open-menu-av`，或者其他专用事件？）
    - 如果触发了事件，其 `detail` 对象中是否包含可以直接操作的 `Menu` 实例以及当前选中的单元格/行信息？

2.  **菜单挂载点**:
    - 如果没有专用事件，官方推荐的方式是否是监听全局 `contextmenu` 事件？
    - 在 `contextmenu` 事件触发后，如何获取当前已经打开的系统菜单实例（例如 `window.siyuan.menus.menu`），以便向其 `append` 自定义的菜单项，而不是覆盖整个菜单？

3.  **现有尝试**:
    - 目前尝试了监听 `click-blockicon`，但似乎在 AV 单元格右键时并未触发，或者无法通过 `detail` 获取到单元格上下文。
    - 接下来将尝试监听全局 `contextmenu` 并延时挂载菜单项。