# 思源属性视图 (AV) 到 SQLite 转换与双向同步技术规范

本文档阐述了本插件中实现的思源笔记属性视图（AV）与 SQLite 关系型数据库之间的双向同步与转换设计，包含数据类型映射、正向同步（AV -> SQLite）及反向更新（SQLite -> AV）的实现细节，并以 `relation`（关联列）字段为例进行深度剖析。

---

## 1. 数据类型映射表 (AV Type Mapping)

属性视图单元格内使用的是复杂的 JSON 结构，而 SQLite 仅支持标量数据类型。映射关系定义在 [sqlite-manager.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/sqlite-manager.ts#L8-L26) 中：

| AV 类型 (`KeyType`) | SQLite 类型 | 可写回 (Writable) | 转换与同步机制说明 |
| :--- | :--- | :--- | :--- |
| **`block`** | `TEXT` | ❌ 否 | **只读主键/引用**：提取 `block.content` 充当关联块内容（主键绑定为 `rowID`）。 |
| **`text`** | `TEXT` |  是 | 原始字符串映射。 |
| **`number`** | `REAL` |  是 | 提取为浮点数类型。若为空值则存为 `NULL`。 |
| **`date`** | `INTEGER` |  是 | 提取并存储为 13 位 Unix 毫秒级时间戳。若为空值存为 `NULL`。 |
| **`select`** | `TEXT` |  是 | 提取单选框选项的文字名称（`content`）。 |
| **`mSelect`** | `TEXT` |  是 | 多选框，存为 JSON 数组字符串，例如 `["选项A", "选项B"]`。 |
| **`checkbox`** | `INTEGER` |  是 | `0` (未选中) 或 `1` (选中)。 |
| **`url/email/phone`** | `TEXT` |  是 | 原始字符串映射。 |
| **`relation`** | `TEXT` |  是 | 关联列，存为包含目标块 ID 的 JSON 数组字符串，例如 `["20260310..."]`。 |
| **`mAsset`** | `TEXT` |  是 | 资源文件列，存为包含资源文件元数据的 JSON 数组字符串。 |
| **`rollup`** | `TEXT` | ❌ 否 | **只读汇总列**：提取汇总计算的只读快照存为文本或 JSON。 |
| **`template`** | `TEXT` | ❌ 否 | **只读模板列**：提取渲染后的只读文本。 |
| **`created/updated`** | `INTEGER`| ❌ 否 | **只读系统列**：提取创建/修改时间的毫秒级时间戳。 |

---

## 2. 正向同步实现 (AV ➔ SQLite)

正向同步由 `instantiateAV(avId)` 实现，流程如下：

1. **结构获取**：通过 `/api/av/getAttributeView` 接口获取最新的属性视图列头配置 `keyValues`。
2. **清洗并去重列名**：
   * 去除列名中的非字母数字字符（替换为下划线 `_`）。
   * 避开 SQLite 系统列名（如 `rowID`、`_itemID`）。
   * 对重名或非 ASCII 字符列进行重命名安全处理（追加 `_KeyID后四位` 或序号），保证 SQL 表结构的唯一性。
   * 列信息持久化在元数据表 `_av_schema` 中。
3. **动态建表**：
   * 将 Siyuan 表名转换为安全的无符号表名（如 `av_20251021232406_u4zvv9w`）。
   * 执行 `DROP TABLE IF EXISTS` 和 `CREATE TABLE`，以扁平化形式构建表结构，以 `rowID` 为主键。
4. **行数据扁平化归集 (Row Flattening)**：
   * 遍历属性视图的每一个 `KeyValues` 中的单元格 `values`。
   * 以思源块的 `blockID`/`itemID` 为行聚合键（`rowID`），把散落在各个列中的单元格数值归并到同一行记录的对象中。
   * 提取底层值时，根据其字段类型进行提取（例如 `checkbox` 转换为 `0/1`，多选和关联列转换为 `JSON` 字符串，空值填为 `NULL`）。
5. **批量写入与事务持久化**：
   * 在 SQLite 中开启事务 (`BEGIN TRANSACTION;` / `COMMIT;`) 批量插入记录。
   * 更新 `_meta` 表以记录最后同步的时间和数据哈希值（用于增量同步判定）。
   * 将 SQLite 的二进制数据导出为 ArrayBuffer 并保存至磁盘上的 `/data/storage/petal/siyuan-plugins-index/index-os.sqlite`。

---

## 3. 反向同步实现 (SQLite ➔ AV)

反向同步由 `runMutation(sql)` 实现，它允许用户在客户端运行标准的 SQL `UPDATE` 语句，并将变更实时同步回思源笔记的属性视图：

1. **解析拦截**：
   * 提取 SQL 语句的表名，判定其是否为已同步的 AV 虚拟表。
   * 在 SQLite 执行更改前建立一个 `SAVEPOINT av_mutation;` 事务保存点。
   * 拍摄当前数据库中该表的快照（**Before Snapshot**）。
2. **本地执行**：
   * 允许在 SQLite 内存数据库中执行 `UPDATE` 语句。如果语法错误，自动回滚保存点。
   * 拍摄修改后的表快照（**After Snapshot**）。
3. **状态 Diff 差分**：
   * 对比 `Before` 和 `After` 快照，找出被修改的具体单元格信息，收集其 `{ rowId, itemId, colName, keyId, keyType, oldValue, newValue }`。
4. **多级验证 (Validation)**：
   * 校验修改的列是否为只读列（如 `created`、`rollup` 等），如果是，则拦截报错。
   * 校验值格式是否合法：如数字类型是否为 `NaN`、`checkbox` 是否为 `0` 或 `1`、`relation` 和 `mSelect` 是否为合法的 JSON 数组，不合法则拦截报错。
   * **若验证失败，则调用 `ROLLBACK TO av_mutation;` 撤销 SQLite 中的全部修改。**
5. **生成日志与 API 批量回写**：
   * 验证通过后，将变更记录写入系统日志表 `_changelog`。
   * 将修改的原始标量值（或 SQLite 中的 JSON 串）重新打包为思源内核所需的复杂单元格 JSON 对象（根据 `keyType` 自动映射，若值为 `NULL` 则调用空值封装逻辑）。
   * 调用内核 `/api/av/batchSetAttributeViewBlockAttrs` 以批处理块的形式将新值写回思源。
   * 写入成功后释放保存点（`RELEASE av_mutation;`），如果 API 回写异常则会报错并提供回滚机制。

---

## 4. 以 `relation`（关联列）字段为例的深度剖析

`relation` 类型字段是思源核心的“双向关联数据库”底层支持。它用于连接两个不同的属性视图（例如 Layer 2 的命令表与 Layer 3 的类绑定表）。

### 4.1 AV ➔ SQLite (正向读取)
当从思源读取关系数据到 SQLite 时，思源返回的 relation cell 数据结构一般如下：
```json
{
  "type": "relation",
  "relation": {
    "blockIDs": ["20260310184003-2tpu9yq", "20260310184004-9zxyte3"],
    "contents": [...]
  }
}
```
* **转换过程**：[sqlite-manager.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/sqlite-manager.ts#L369-L376) 会遍历 `v.relation.contents` 或 `v.relation.blockIDs`，抽取非空的思源块 ID，使用 `JSON.stringify()` 序列化为 JSON 数组字符串存储在 SQLite 中：
  ```sql
  -- SQLite 表中的存储值为 TEXT 类型：
  '["20260310184003-2tpu9yq", "20260310184004-9zxyte3"]'
  ```

### 4.2 SQLite 中的增删改查 (CRUD)
在 SQLite 中，我们可以直接通过 SQL 操作关联关系：
* **查询 (Retrieve)**：查找所有绑定了特定类（如 ID 为 `20260310184003-2tpu9yq`）的命令行：
  ```sql
  SELECT * FROM av_command_db 
  WHERE "绑定类" LIKE '%20260310184003-2tpu9yq%';
  -- 或者更严谨地使用 json_each：
  SELECT c.* FROM av_command_db c, json_each(c."绑定类") 
  WHERE json_each.value = '20260310184003-2tpu9yq';
  ```
* **修改/全量重置 (Update)**：
  ```sql
  UPDATE av_command_db 
  SET "绑定类" = '["20260526203557-newuuid"]' 
  WHERE rowID = '20260526201122-cmdrow';
  ```
* **新增或删除单个关联项 (Add/Delete in array)**：
  因为在 SQLite 中是 JSON 格式，我们可以配合 `json_insert` 或 `json_remove` 编写更新，也可由外部计算好新的 JSON 数组再发 UPDATE 语句：
  ```sql
  -- 例如通过 SQLite JSON 函数追加一个关联：
  UPDATE av_command_db 
  SET "绑定类" = json_insert("绑定类", '$[#]', '20260526203557-newuuid') 
  WHERE rowID = '20260526201122-cmdrow';
  ```

### 4.3 SQLite ➔ AV (反向更新写回)
当触发 `UPDATE` 时，[sqlite-writeback.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/sqlite-writeback.ts#L347-L367) 会对其进行严格校验和重新封包：
1. **格式校验**：
   * 必须是合法的思源块 ID 格式 (`^\d{14}-[a-z0-9]{7}$`)。
   * 如果是 JSON 数组，数组内的每一项也必须是合法块 ID，如果不合法则被拦截。
2. **值重构转换**：
   * 校验通过后，调用 `_toAVValue(value, schema)`：将字符串或 JSON 数组提取为纯 ID 数组 `ids = ["20260310184003-2tpu9yq", "20260310184004-9zxyte3"]`。
   * 重构出思源核心接受的 payload：
     ```json
     {
       "type": "relation",
       "relation": {
         "blockIDs": ["20260310184003-2tpu9yq", "20260310184004-9zxyte3"],
         "contents": null
       }
     }
     ```
   * 随后通过 `batchSetAttributeViewBlockAttrs` 发送给思源，思源内核会自动更新该关联并根据双向关联机制（如果已配置）自动同步更新对方属性视图的对应单元格！

---

## 5. 系统初始化 (construct-dir.ts) 与双向同步逻辑分析

### 5.1 `construct-dir.ts` 目前是如何实现的？
`construct-dir.ts` 用于初始化整个 IndexOS 的系统元数据文档树与核心存储（Layer 2 和 Layer 3 的属性视图）：
1. **笔记本与页面创建**：先检索并创建笔记本 `"类与命令管理"` 以及两个页面 `"逻辑工厂 (Command-DB)"` 和 `"类型绑定 (Type-DB)"`。
2. **列表转为属性视图**：通过 `/api/query/sql` 查找页面下的首个列表块，并利用自定义逻辑（`createDatabaseWithBlocks`）转换为底层的属性视图（AV），将其 `avId` 写入列表属性中。
3. **增加配置列**：在初始化回调中，利用 `/api/av/addAttributeViewKey` 注入系统所需的各类控制列（如 `Command ID`、`Enable`、`Inline Button` 等）。
4. **注入默认数据**：利用 `/api/av/batchSetAttributeViewBlockAttrs` 为系统命令和绑定默认注入初始化元数据。
5. **建立并校验双向关联**：通过 `establishDbRelation` 向 Command-DB 添加 `"绑定类"` 关联列，并通过调用异步交易 `/api/transactions` (操作为 `updateAttrViewColRelation`) 建立到 Type-DB 的双向关联（并生成 back-relation 关联列 `"绑定命令"`），利用轮询逻辑保证写入并提交。

---

### 5.2 核心追问：系统初始化要不要考虑用 SQLite 同步逻辑来做？

**结论：不要考虑，也不应当使用同步逻辑来进行系统初始化。**

原因在于以下几个致命的“先有鸡还是先有蛋”的闭环冲突：

1. **结构依赖（No Schema, No SQL）**：
   * SQLite 的同步机制（`instantiateAV`）**强烈依赖思源中已有的属性视图及其字段结构**。它是先读取思源已有的列和行配置，从而建表、同步数据的。
   * 如果系统尚未初始化，在思源中根本不存在 `Command-DB` 和 `Type-DB` 的属性视图，SQLite 同步逻辑将完全无法运行（无源可读，无法动态在 SQLite 中建立对应的表结构）。
2. **元数据管理 (Meta vs Row Data)**：
   * SQLite 的双向更新机制（`runMutation`）是设计用于 **行数据（Row Data）的 CRUD 操作**（对已有的列填值、改值）。
   * 而系统初始化需要执行的是 **元数据结构构建（Metadata DDL）**：创建文档页面、将普通的 Markdown 列表物理转换为数据库块、添加属性列、为两个独立的数据库配置底层的双向关联链条。这些元数据控制在 SQLite 中是没有对应实体表的，只能通过思源专属的事务与内核 API 来完成。
3. **关联建立的物理限制**：
   * 在初始化时，两个表之间还没有任何关联。想要建立双向关联，必须通知思源内核并在两个物理 JSON 存储中分配相互映射的 keyID。这一步必须在内核层利用 `updateAttrViewColRelation` 事务完成。
   * 如果试图用 SQL 写入 `relation` 字符串，会因为关联列尚未被内核建立关联属性（`relation` 描述为 null），写入的块 ID 不会被内核识别为关系连接，只会被当作无效数据丢弃，或导致两边数据库的元数据不一致。

**总结**：
* **`construct-dir.ts`** 扮演的是 **“建国筑基”** 的角色：负责利用思源的系统接口、事务底层从无到有地搭建文档、数据库表结构和表关联。
* **SQLite 同步逻辑 (sqlite-manager / writeback)** 扮演的是 **“治国运行”** 的角色：负责在表结构和关联都已经稳固的前提下，为用户提供极其高效的批量行数据 CRUD、查询与参数流转操作。两者分工明确，不可替代。
