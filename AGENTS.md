# AGENTS.md

## 项目

思源笔记插件 `siyuan-plugins-index`：目录插件 + IndexOS 实验平台（命令系统、Supertag 绑定、AV 数据库与 SQL 控制台）。

## 重要 Context（必须遵守）

- 当前是**测试版本**。
- **命令管理（IndexOS Command 系统）与 SQL 管理 AV 相关功能不做 backwards compatibility**：
  不写兼容旧数据 / 旧表结构的迁移代码，可以直接破坏性变更。
- 普通目录 / 大纲功能保持稳定。

## 架构速览

- 完整架构说明见 [docs/architecture.md](docs/architecture.md)（状态机、分层、命名约定）。
- 核心状态机：未实例化时读 `seed-data.ts` TS 常量；用户点击“将数据存到思源”（代码内称“实例化”）后，
  思源 AV 为唯一数据源；删除系统库文档即回到未实例化。
- **没有 SQLite 种子表**（`sys_command_db` / `sys_type_db` 已删除，不要重建，不要在运行时写）。
- 命名：`CommandDef`（Layer 1 命令定义）≠ `CommandBinding`（Layer 2 绑定行，`COMMAND_BINDINGS`）。
- 参数优先级：#1 pipeline 人为规划 > #2 pipeline 自动赋予 > #3 command-db 配置 > 变量解析内嵌；#5 seed/registry 仅作初始模板。统一解析入口 `resolveCommandParams()`。
- 命令 Pipeline（复合命令）设计见 `docs/pipeline-design.md`；实现位于 `src/features/command/pipeline/`（types / engine / manager）。

## 本地环境

- 思源源码在本地可查（Dialog 等组件实现、样式均可直接读源码确认）：
  `/Users/feng/Desktop/Git-cloned/siyuan`
  - Dialog 组件实现：`app/src/dialog/index.ts`
  - Dialog 样式：`app/src/assets/scss/component/_dialog.scss`
- 插件 CSS 设计令牌（`--indexos-*`）定义在 `src/ui/styles/tokens.css`，弹窗类样式在 `src/ui/styles/utilities.css`。

## 工程命令

- 类型检查：`npx tsc --noEmit`（必须零错误）

