# IndexOS 块属性与思源 AV 数据库双向投影可行性深度调研报告

> **目标**：实现以“块实体 `custom-*` 属性 / Supertag 组件”为单一真理源，思源原生 AV（Attribute View）数据库作为可视化“投影视图”，并评估双向同步的可行性与官方 PR 路径。

---

## 1. 架构现状与底层物理机制

### 1.1 思源原生 AV（数据库）的数据存储真相
查阅思源内核源码（`kernel/model/attribute_view.go` 与 `kernel/api/av.go`）：
1. **模式与值解耦**：
   * AV 数据库的列结构（Key）存储于 `.av/<avID>.json`；
   * 每一行（Row）实质上对应一个物理块 ID（`itemID = blockID`）；
   * 单元格的具体取值主要保存在 `.av/` 结构与特定的 IAL 映射中；
2. **强类型约束**：
   * `select`（单选）与 `mSelect`（多选）必须绑定在 AV 列定义的 `options`（包含 `optionID` 与 `color`）；
   * `date` 存储毫秒级 Unix 时间戳；`relation` 存储关联块 ID 数组；`rollup` / `template` 为只读动态计算字段；
3. **官方更新接口**：
   * 思源提供完整的 `/api/av/updateAttributeViewCell` 与 `/api/av/batchUpdateAttributeViewCells` 事务接口。

---

## 2. 方案可行性对比：插件桥梁 VS 官方内核 PR

### 方案 A：IndexOS 响应式同步桥梁（当前最佳，即刻完全落地）
* **运行机制**：
  ```
  【块 custom-* 属性 / Supertag】 
          │  ▲
          │  │ (IndexOS 响应式同步桥梁)
          ▼  │
  【思源 AV 数据库视图 (.av/json)】
  ```
  1. **正向投影（块 ➔ AV）**：当块上的 `custom-status` 或 Supertag 发生变更时，插件通过 `/api/av/updateAttributeViewCell` 将变更同步写入绑定的 AV 视图，保持 AV 表格实时展示最新数据；
  2. **反向回写（AV ➔ 块）**：用户在思源原生 AV 表格中手动修改单元格时，插件通过监听 WebSocket 事务变更，将新值回写到该块的 `custom-*` 属性中；
* **可行性评估**：**100% 完全可行，零侵入，零破坏，当前即可在插件层全量运行**。

---

## 3. IndexOS SQLite 镜像对 AV 数据类型的支持全景

目前 IndexOS 的 SQLite 纯内存引擎（`src/features/sqlite/sqlite-manager.ts`）已实现 **全量 AV 数据类型的高性能映射与支持**：

| AV 数据类型 | SQLite 列类型 | 读写支持 | 处理机制 |
| :--- | :--- | :---: | :--- |
| **`text` / `url` / `email` / `phone`** | `TEXT` | 读写 | 字符串直接透传 |
| **`number`** | `REAL` | 读写 | 数字浮点数校验 |
| **`checkbox`** | `INTEGER` | 读写 | 0 / 1 布尔转换 |
| **`date`** | `INTEGER` | 读写 | Unix 毫秒时间戳 |
| **`select`** | `TEXT` | 读写 | 自动映射匹配 Option 名称与 OptionID |
| **`mSelect`** | `TEXT` (JSON) | 读写 | JSON 数组字符串存储与解析 |
| **`relation`** | `TEXT` (JSON) | 读写 | 关联块 ID 列表 |
| **`mAsset`** | `TEXT` (JSON) | 读写 | 资源附件路径数组 |
| **`rollup` / `template`** | `TEXT` | **纯读 (只读)** | **动态计算**：直接在查询或渲染时动态汇总，不占用持久化存储 |
| **`created` / `updated`** | `INTEGER` | **纯读 (只读)** | 映射内核块元数据时间戳 |

---

## 4. 落地结论

1. **单一权威源原则坚不可摧**：块自身的 `custom-*` 与 Supertag 保持为唯一真理源；
2. **AV 作为自适应外显投影**：通过 IndexOS 的响应式同步桥梁，实现普通块属性与 AV 数据库视图的无感双向同步；
3. **Rollup / 模板动态直算**：只读计算字段由引擎在内存中动态求值，不写死脏数据。
