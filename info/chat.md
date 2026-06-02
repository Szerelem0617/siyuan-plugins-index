# 思源属性视图（AV）极简 SQL API 暴露与重写评估总结

此文档记录了本插件如何向外暴露 SQL 读写接口以供其他插件或用户调用，并针对本插件已有的各种属性视图（AV）操作，进行了"要不要使用极简 SQL API 进行重写"的架构设计与评估分析。

---

## 1. 暴露 SQL 相关方法与外部调用总结

为了将轻量化 Wasm 内存 SQLite 的能力共享给思源生态，我们在插件加载时将核心 SQL 转译与查询接口注入到了全局命名空间中。

### 📂 接口暴露方式
在主入口 [index.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/index.ts) 中，我们在 `onload` 生命周期内向 `window` 注入了 `indexOS.db` 空间：
* **`window.indexOS.db.runQuery(sql: string, params?: any[])`**: 统一的 SQL 执行入口。自动识别语句类型：如果是 `SELECT` 读操作，则按需实例化 Wasm 内存表并执行查询；如果是 `UPDATE/INSERT/DELETE` 写操作，则重定向给写转译引擎。
* **`window.indexOS.db.executeWritableSql(sql: string)`**: 专门处理修改类 DML 语句的直接翻译层。
* **`window.indexOS.db.instantiateAV(avId: string, force?: boolean)`**: 强制使指定 AV 在 Wasm 内存中实例化建表。

在 `onunload` 时，插件会自动执行 `delete (window as any).indexOS` 回收变量，防止内存泄漏。

### 💻 外部调用示例（其他插件/控制台调试）

#### ① SELECT 条件联查（读）
支持 3 秒轻量 TTL 缓存。如果表格已过期或未加载，会自动向内核拉取最新 JSON 实例化后执行：
```javascript
// 查询开启启用的命令
const res = await window.indexOS.db.runQuery("SELECT rowID, Command_ID, Param_Mapping FROM \"Command-DB\" WHERE Enable = 1");
console.log("列头:", res.columns);
console.log("数据行:", res.values);
```

#### ② 主键/字段名过滤的极简更新（写 - In-Memory DML Filter）
自动检测 WHERE 条件，如果是列名过滤，会先在内存中利用 SQLite 快速定位 rowID，再合并为 Siyuan Batch 事务发送给 Go 内核：
```javascript
// 直接按主键列的文本定位并关闭某个指令
const updateRes = await window.indexOS.db.runQuery("UPDATE \"Command-DB\" SET Enable = 0 WHERE 主键 = '🖇️ 复制块引用'");
console.log("执行状态:", updateRes.values[0][0]); // 1 (成功)
console.log("更新行数:", updateRes.values[0][1]); // 1
```

#### ③ 插入数据行
自动生成思源 BlockID 并创建游离行（Detached Row），然后写入指定列属性值：
```javascript
await window.indexOS.db.runQuery("INSERT INTO \"Command-DB\" (Command_ID, Enable) VALUES ('my_new_cmd', 1)");
```

---

## 2. DDL (数据定义语言) 实现现状与能力评估

### 📋 CREATE TABLE 当前能力分析

当前 `executeDDL` 中的 `CREATE TABLE` 实现（位于 [ddl.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/run-query/ddl.ts)）的具体行为：

#### ❓ Q1: 是否支持传参？

**不支持。** 当前 `CREATE TABLE` 仅通过 SQL 文本解析，签名为 `executeDDL(processedSql: string, db: any)`，整个调用链如下：

```
用户输入 SQL → runQuery() → 检测到 write → executeWritableSql() → executeDDL(processedSql, db)
```

所有参数全部从 SQL 字符串正则解析而来。没有额外的可选参数接口可以控制行为（比如指定目标文档、是否生成标题、notebook 选择等）。

**SQL 语法示例（这就是目前唯一的"参数"）：**
```sql
CREATE TABLE "TestTable" (
    "书名" block,
    "价格" number,
    "状态" select('已读', '在读', '未读')
);
```

如果要支持传参（例如指定目标文档ID），有两种思路：
1. **扩展 SQL 语法**：`CREATE TABLE "X" (...) IN DOCUMENT '20260602-xxxxx'` — 不标准但可行
2. **给 `executeDDL` 增加可选的 options 对象**：`executeDDL(sql, db, { targetDocId?, withHeading? })` — 更干净，但需要修改调用链

#### ❓ Q2: 是否支持选择在哪里创建？

**不支持选择。** 当前逻辑硬编码为：

1. 尝试获取**当前活跃编辑器的文档 ID**（`protyle.block.rootID`）
2. 如果编辑器不存在，fallback 到 Siyuan 数据库里**随机取一个文档**
3. 在该文档**末尾** `appendBlock` 插入

也就是说，用户无法指定笔记本、文档路径或者插入位置（如某个块的后面）。

#### ❓ Q3: 创建的 H3 标题能否删除？

**可以也应该删除。** 当前代码（[ddl.ts:110](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/run-query/ddl.ts#L110)）在 appendBlock 时发送的 markdown 是：

```javascript
data: `### ${tableName}\n\n<div data-type="NodeAttributeView" data-av-type="table"></div>`
```

这会生成一个 `### 表名` H3 标题 + AV 数据库块。这个标题完全是装饰性的，不影响 AV 功能。思源的 AV 块本身自带数据库名称（通过 `setAttrViewName` 事务设置），所以 **H3 标题是多余的**。

> [!TIP]
> 建议直接去掉 H3，改为只插入 AV div：
> ```javascript
> data: `<div data-type="NodeAttributeView" data-av-type="table"></div>`
> ```
> 注意：对应的 `DROP TABLE` 逻辑（[ddl.ts:552-563](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/run-query/ddl.ts#L552-L563)）中有一段"查找并删除前面的标题块"的代码，如果去掉 H3 标题，这段代码也可以一并简化。

---

## 3. `batch-update.ts` 和 `create-db.ts` 是否应该改用统一 SQL API？

### 📁 文件概览

| 文件 | 用途 | 核心逻辑 | 代码行数 |
|---|---|---|---|
| [batch-update.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/data/attribute-view/special/batch-update.ts) | 批量更新当前视图中所有可见行的某一列值 | `renderAttributeView` → 构建 cell values → `batchSetAttributeViewBlockAttrs` | ~54 行 |
| [create-db.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/data/list/create-db.ts) | 从列表大纲创建/同步数据库 | 递归解析 DOM → 建列 → 绑定块 → 写入层级/路径/图标数据 | ~724 行 |

### ⚖️ 详细对比分析

#### `batch-update.ts` — **建议不改**

**当前做法**：
直接调用 Siyuan 原生 API — `renderAttributeView` 获取可见行 → 构建 `batchSetAttributeViewBlockAttrs` payload → 发送

**如果改用 SQL API**：
```sql
UPDATE "我的数据库" SET "列名" = '新值';
```

**不建议改的理由**：

1. **SQL UPDATE 需要精确的 WHERE 条件，而 batch-update 的语义是"当前视图的所有可见行"**。可见行受视图的筛选、排序、分页影响。SQL 引擎无法感知当前前端视图的 filter 状态，只能操作物理全量数据。要实现等效功能，SQL 引擎需要额外感知视图层信息，这严重违背了 SQL 层的职责边界。

2. **性能方面并无改善**。当前 batch-update 只发了 **1 次** `renderAttributeView`（获取行）+ **1 次** `batchSetAttributeViewBlockAttrs`（写入），共 2 次 API 调用。如果走 SQL API，链路变成：SQL 解析 → preprocessSql 名称替换 → instantiateAV 拉取全表 → 内存 WHERE 过滤 → schema 查询 → 构建 batch payload → batchSetAttributeViewBlockAttrs。**步骤更多、更慢**。

3. **batch-update 只有 54 行，逻辑清晰明了**。引入 SQL 抽象层反而增加了调试复杂度。

#### `create-db.ts` — **建议不改**

**当前做法**：
从思源列表块 DOM 递归提取层级结构 → 用 `insertBlock` 创建 AV 块 → `addAttributeViewKey` 逐列建列 → `addAttributeViewBlocks` 绑定块行 → `batchSetAttributeViewBlockAttrs` 分块写入层级/路径/图标等元数据 → 设置视图列可见性、排序等

**如果改用 SQL API**：
```sql
CREATE TABLE "新表" ("Level" number, "Father" text, "Path" text, "icon" text);
INSERT INTO "新表" (Level, Father, Path, icon) VALUES (1, '', '/001-xxx', '📁');
INSERT INTO "新表" (Level, Father, Path, icon) VALUES (2, 'xxx', '/001-xxx/001-yyy', '');
-- ... 重复 N 次
```

**不建议改的理由**：

1. **`create-db.ts` 不只是"建表+插数据"，它是一套完整的列表↔数据库双向绑定系统**。它的核心能力包括：
   - **DOM 解析**：递归遍历 NodeListItem，提取 block ref、subdoc link、icon 等
   - **增量同步**：检测已有绑定 (`ATTR_LINKED_AV`)，跳过已存在的行，只 diff 更新变化的字段
   - **Siyuan Block 绑定**：用 `isDetached: false` 绑定真实块（非游离行），这是 SQL INSERT 默认创建的 detached row 做不到的
   - **ID 映射持久化**：用 `setBlockAttrs` 在列表项上存储 `ATTR_ITEM_ID`，建立反向查找
   - **视图配置**：隐藏特定列、关闭入口图标、设置数据库名称
   
   这些功能 SQL API 根本覆盖不了。SQL 只是数据操作的语法糖，不是 UI 控制工具。

2. **SQL INSERT 创建的是 detached row（游离行），`create-db.ts` 需要的是 bound block（绑定块）**。这是根本性的语义差异。SQL 引擎中 `INSERT INTO` 的实现是 `isDetached: true`，而 create-db 明确使用 `isDetached: false` + 真实 Siyuan Block ID。改用 SQL 意味着要么修改 SQL INSERT 语义（破坏通用性），要么加特殊 SQL 扩展语法（过度设计）。

3. **性能方面 SQL 路径更差**：
   - SQL INSERT 是逐行执行的（每条 INSERT 一次 API 调用），而 create-db 用 chunk 批量 `addAttributeViewBlocks`（每 50 行一次）
   - SQL 引擎每次写操作都要走 `preprocessSql → schema 查询 → 类型映射` 的解析链路，724 行直接 API 调用的代码省去了所有这些中间层开销

4. **create-db 是 724 行高度定制化的领域逻辑**，不是简单的 CRUD。试图用 SQL 重写等于把一个 DSL（Domain Specific Language）塞进另一个 DSL（SQL），得不偿失。

### 📊 结论总结表

| 维度 | `batch-update.ts` | `create-db.ts` |
|---|---|---|
| **改用 SQL 是否可行？** | 部分可行（但 WHERE 语义不同） | 技术上不可行（bound block vs detached row） |
| **改用 SQL 是否更高效？** | ❌ 更慢（多了 instantiateAV + schema 查询） | ❌ 更慢（逐行 INSERT vs chunk 批量绑定） |
| **改用 SQL 是否更简洁？** | ❌ 54→50 行顶多省 4 行，但失去视图感知 | ❌ 无法覆盖 DOM 解析、增量同步、块绑定 |
| **建议** | **不改** | **不改** |

> [!IMPORTANT]
> **核心判断原则**：SQL API 的定位是**外部调用的通用接口**（控制台调试、第三方插件集成、快速原型），不是用来替代插件内部已经高度优化的原生 API 调用链的。内部模块直接调用 Siyuan API 更高效、更精确、更易调试。SQL 层存在的意义是对外暴露一个统一入口降低使用门槛，而不是成为内部唯一的数据访问层。

---

## 4. 后续优化建议（不涉及代码改动）

1. **`executeDDL` 的 CREATE TABLE 应该去掉 H3 标题**，只插入纯 AV div
2. **可考虑给 `executeDDL` 增加可选 options 参数**（`targetDocId`、`insertAfterBlockId`），让外部调用者可以精确控制创建位置
3. **`DROP TABLE` 的标题清理逻辑应随 H3 去除一并简化**
4. **SQL API 暴露层可考虑增加 `executeDDL` 的直接暴露**，让外部插件也能用 SQL 建表

