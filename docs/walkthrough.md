# Walkthrough - 投影数据库绑定机制重构：属性 ID 驱动与重命名免疫

本次重构彻底改变了以往“仅靠数据库名和 Supertag 名进行字符串比较”的脆弱机制，转向以 `custom-supertag-id` / `custom-supertag-tag` 块属性以及 `supertag-db` 系统表行 ID 为第一真理源的鲁棒架构。

---

## 1. 架构设计与改动细节

### ① 为什么不能单纯依赖名称？
- 用户在思源中随时可能将数据库重命名（例如将 `task` 改为 `2026年待办工作清单`），或者修改 Supertag；
- 单纯依赖名称匹配会导致重命名后投影关系丢失、识别失效。

### ② 统一属性与行 ID 驱动机制（真理源）

1. **块级持久化自定义属性（Single Source of Truth）**：
   - 在 AV 数据库块（`type = 'av'`）的 IAL 属性上保存：
     - `custom-supertag-tag`: 绑定的 Supertag 标签名（如 `task`）；
     - `custom-supertag-id`: 对应的 `supertag-db` 行 ID（或 Supertag 唯一标识）。
   - 在 `supertag-db` 系统表中：
     - `related_av` 字段同步记录 AV 数据库 ID。

2. **多层级解析优先级**：
   - **第 1 优先级（属性真理源）**：读取 AV 块 / DOM / IAL 的 `custom-supertag-tag` 与 `custom-supertag-id`；
   - **第 2 优先级（系统表记录）**：查询 `supertag-db` 的 `related_av` 与 rowid 记录；
   - **第 3 优先级（内存缓存与 Binder）**：`supertagAVProjector` / `supertagBinder`；
   - **第 4 优先级（降级自愈）**：初次发现未打标的同名/目录数据库时，自动调用 `/api/attr/setBlockAttrs` 将 `custom-supertag-tag` 与 `custom-supertag-id` 写入块属性。

3. **创建数据库全流程注入**：
   - 在 Supertag 管理中点击 `[ + 创建数据库 ]` 时，不仅创建文档与 AV 块，且同时向 AV 块写入 `custom-supertag-tag` 与 `custom-supertag-id`，并更新 `supertag-db` 的 `related_av` 字段。

---

## 2. 修改文件清单

1. **[supertag-entity.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/core/supertag-entity.ts)**：
   - 新增 `getSupertagDbRecords()` 从 `supertag-db` 读取 `rowId`, `typeTag`, `relatedAv`；
   - 在 `getUnifiedSupertagList()` 中根据属性与系统表行 ID 进行聚合匹配，自动自愈回写属性。

2. **[av-projection-toggle.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/projection/av-projection-toggle.ts)**：
   - `resolveBoundTag` 优先读取 `custom-supertag-tag` / `custom-supertag-id`；
   - `asyncResolveBoundTagFromSql` 优先从 IAL 解析自定义属性，彻底免疫重命名。

3. **[supertag-manager-dialog.svelte](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/manager/supertag-manager-dialog.svelte)**：
   - 在 `handleCreateDatabase` 中持久化写入 `custom-supertag-tag` 与 `custom-supertag-id`，并同步更新 `supertag-db` 的 `related_av`。
