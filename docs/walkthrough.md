# Walkthrough - 清理硬编码的 `#pipeline` 标签

本次更新排查并清理了系统中硬编码的 `#pipeline` 标签残余，统一规范为 `#composite`（复合命令）。

---

## 1. 排查与修复说明

### ① 硬编码来源
- 在 `seed-data.ts` 的 `BUILTIN_SUPERTAGS` 集合中曾遗留有 `"pipeline"`；
- 复合命令种子记录的 `rowID` 曾为 `20260721140000-pipeline`。

### ② 清理与统一
- 将 `BUILTIN_SUPERTAGS` 中的 `"pipeline"` 移除并统一修正为 `"composite"`；
- 将种子行 `rowID` 规范化为 `20260721140000-composite`。
