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

## 工程命令

- 类型检查：`npx tsc --noEmit`（必须零错误）
- 构建：`npm run build`
