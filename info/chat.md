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
    - `data/`: 数据转换功能。包括将列表转换为数据库（已更名为“创建数据库”）以及数据库视图的聚焦操作。
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
2. **自动化更新**: 通过监听 `loaded-protyle-static` 和 `switch-protyle` 事件，实现目录和大纲的无感同步。
3. **属性绑定**: 利用 SiYuan 的 `custom-attr` 机制，将生成的目录/大纲块与源文档建立关联，确保更新时的精准定位。
4. **Svelte 集成**: 使用 Svelte 构建响应式 UI，提供流畅的用户配置体验。
