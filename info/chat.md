# 思源属性视图（AV）极简 SQL API 完整文档

此文档记录了本插件向外暴露的所有 SQL 接口，涵盖 **SELECT（读）**、**DML（写）** 和 **DDL（建表/改表/删表）** 三大类操作。其他插件可直接通过 `window.indexOS.db` 调用。

---

## 0. 接口暴露方式

在主入口 [index.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/index.ts) 中，`onload` 时注入 `window.indexOS.db`：

| 方法 | 签名 | 用途 |
|---|---|---|
| `runQuery` | `(sql: string, params?: any[], options?: DDLOptions) → Promise<{ columns, values }>` | 统一入口，自动判断读/写并路由 |
| `executeWritableSql` | `(sql: string, options?: DDLOptions) → Promise<any>` | 写操作直接入口（DML + DDL） |
| `instantiateAV` | `(avId: string, force?: boolean) → Promise<void>` | 强制将指定 AV 加载到 Wasm 内存 |

`DDLOptions` 接口（仅对 DDL 中的 `CREATE TABLE` 生效）：

```typescript
interface DDLOptions {
    targetDocId?: string;         // 在此文档末尾创建 AV
    insertAfterBlockId?: string;  // 在此块后面插入 AV（与 targetDocId 互斥）
}
```

> [!NOTE]
> `runQuery` 对 SELECT 语句返回 `{ columns: string[], values: any[][] }`，对写操作返回 `{ columns: ["success", "affectedRows", "message"], values: [[1, N, "..."]] }`。

---

## 1. SELECT（读操作）

支持 3 秒 TTL 缓存。如果表未加载或已过期，自动拉取最新数据实例化。

### 基础查询

```javascript
const res = await window.indexOS.db.runQuery(
  'SELECT rowID, Command_ID, Param_Mapping FROM "Command-DB" WHERE Enable = 1'
);
console.log("列头:", res.columns);  // ["rowID", "Command_ID", "Param_Mapping"]
console.log("数据行:", res.values); // [[1, "cmd_1", "..."], ...]
```

### 支持的 SQL 功能

- **WHERE / AND / OR** 条件过滤
- **ORDER BY** 排序
- **LIMIT / OFFSET** 分页
- **JOIN**（跨 AV 表联查）
- **聚合函数**（`COUNT`, `SUM`, `AVG`, `MAX`, `MIN`）
- **LIKE** 模糊匹配
- **GROUP BY / HAVING**

> [!IMPORTANT]
> 表名必须用引号包裹（支持 `""`、`` `` ``、`''`），尤其是包含中文、连字符的表名。

---

## 2. DML（数据操作）

实现位于 [dml.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/run-query/dml.ts)。

### 2.1 UPDATE — 更新行

```sql
UPDATE "表名" SET 列名1 = 值1, 列名2 = 值2 WHERE 条件
```

#### WHERE 支持三种模式

| WHERE 模式 | 示例 | 内部行为 |
|---|---|---|
| 单行 rowID/id/_itemID | `WHERE rowID = 'xxx'` | 直接定位 |
| 多行 IN | `WHERE id IN ('a', 'b', 'c')` | 批量定位 |
| 复杂条件 | `WHERE 价格 > 100 AND 状态 = '在读'` | 先在内存 SQLite 执行 `SELECT rowID` 定位，再批量写 |

#### 调用示例

```javascript
// 按主键列文本定位
await window.indexOS.db.runQuery(
  `UPDATE "Command-DB" SET Enable = 0 WHERE 主键 = '🖇️ 复制块引用'`
);

// 按 rowID 精确更新
await window.indexOS.db.runQuery(
  `UPDATE "Command-DB" SET Enable = 1 WHERE rowID = '20260601-abc123'`
);

// 复杂条件更新
await window.indexOS.db.runQuery(
  `UPDATE "书单" SET 状态 = '已读' WHERE 价格 > 50 AND 状态 = '在读'`
);
```

#### 返回值

```javascript
{ columns: ["success", "affectedRows", "message"], values: [[1, 3, "Successfully updated 3 rows"]] }
```

#### 支持的值类型自动映射

| 列类型 | 值格式 | 示例 |
|---|---|---|
| `text` | 字符串 | `SET 备注 = '新内容'` |
| `number` | 数字 | `SET 价格 = 42` |
| `checkbox` | true/false | `SET 启用 = true` |
| `select` | 字符串 | `SET 状态 = '已完成'` |
| `mSelect` | JSON 数组或字符串 | `SET 标签 = '["标签1","标签2"]'` |
| `relation` | Block ID 或 JSON 数组 | `SET 关联 = '["20260601-xxx"]'` |
| 其他 (`date`, `url` 等) | 字符串 content | `SET 链接 = 'https://...'` |

---

### 2.2 INSERT — 插入行

```sql
INSERT INTO "表名" (列1, 列2, ...) VALUES (值1, 值2, ...)
```

> [!NOTE]
> INSERT 创建的是**游离行 (detached row)**，即不绑定到任何实际思源块的独立数据行。

#### 调用示例

```javascript
await window.indexOS.db.runQuery(
  `INSERT INTO "Command-DB" (Command_ID, Enable) VALUES ('my_new_cmd', 1)`
);
```

#### 返回值

```javascript
{ columns: ["success", "affectedRows", "message"], values: [[1, 1, "20260602170605-newid"]] }
// message 字段返回新插入行的 itemID
```

---

### 2.3 DELETE — 删除行

```sql
DELETE FROM "表名" WHERE 条件
```

> [!IMPORTANT]
> DELETE 使用 `_itemID` 列在内存中定位行，然后调用 `/api/av/removeAttributeViewBlocks` 真正删除。WHERE 条件支持任意 SQL 表达式（复杂条件在内存 SQLite 中求值）。

#### 调用示例

```javascript
// 按条件删除
await window.indexOS.db.runQuery(
  `DELETE FROM "Command-DB" WHERE Enable = 0`
);

// 按 ID 删除
await window.indexOS.db.runQuery(
  `DELETE FROM "书单" WHERE rowID = '20260601-abc123'`
);
```

#### 返回值

```javascript
{ columns: ["success", "affectedRows", "message"], values: [[1, 5, "Successfully deleted 5 rows"]] }
```

---

## 3. DDL（数据定义）

实现位于 [ddl.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/sqlite/run-query/ddl.ts)。

### 3.1 CREATE TABLE — 创建数据库

```sql
CREATE TABLE "表名" (
    "列名1" 类型,
    "列名2" 类型(选项1, 选项2),
    "列名3" relation REFERENCES "关联表名"
)
```

#### 支持的列类型

| SQL 类型 | 思源 AV 类型 | 说明 |
|---|---|---|
| `block` | 主键列 | 第一列声明为 block 时自动映射为 AV 主键 |
| `text` | 文本 | 默认类型 |
| `number` | 数字 | |
| `select` | 单选 | 可用括号预设选项 |
| `mselect` | 多选 | 可用括号预设选项 |
| `date` | 日期 | |
| `checkbox` | 勾选框 | |
| `relation` | 关联 | 可加 `REFERENCES "表名"` 建立双向关联 |
| `masset` | 资源 | |
| `rollup` | 汇总 | |
| `template` | 模板 | |
| `created` | 创建时间 | |
| `updated` | 更新时间 | |

#### 调用示例

```javascript
// ① 默认在当前编辑器文档末尾创建
await window.indexOS.db.runQuery(
  `CREATE TABLE "书单" ("书名" block, "价格" number, "状态" select('已读','在读','未读'))`
);

// ② 指定目标文档创建（其他插件推荐）
await window.indexOS.db.runQuery(
  `CREATE TABLE "书单" ("书名" block, "价格" number)`,
  [],
  { targetDocId: "20260602143857-rk816co" }
);

// ③ 在指定块后面插入
await window.indexOS.db.runQuery(
  `CREATE TABLE "书单" ("书名" block, "价格" number)`,
  [],
  { insertAfterBlockId: "20260602164831-cllp2yb" }
);

// ④ 用 executeWritableSql 直接调用
await window.indexOS.db.executeWritableSql(
  `CREATE TABLE "书单" ("书名" block, "价格" number)`,
  { targetDocId: "20260602143857-rk816co" }
);
```

#### 带关联列的创建

```javascript
// 先创建被关联的表
await window.indexOS.db.runQuery(`CREATE TABLE "作者表" ("姓名" block, "国籍" text)`);
// 再创建含关联列的表
await window.indexOS.db.runQuery(
  `CREATE TABLE "书单" ("书名" block, "作者" relation REFERENCES "作者表")`
);
```

#### 返回值

```javascript
{ columns: ["success", "affectedRows", "message"], values: [[1, 0, "Table '书单' created successfully with avID '20260602-xxx'."]] }
```

---

### 3.2 ALTER TABLE — 修改表结构

#### 添加列

```sql
ALTER TABLE "表名" ADD COLUMN "列名" 类型
ALTER TABLE "表名" ADD COLUMN "列名" select('选项1', '选项2')
ALTER TABLE "表名" ADD COLUMN "列名" relation REFERENCES "关联表名"
```

```javascript
await window.indexOS.db.runQuery(
  `ALTER TABLE "书单" ADD COLUMN "评分" number`
);

// 添加带预设选项的单选列
await window.indexOS.db.runQuery(
  `ALTER TABLE "书单" ADD COLUMN "难度" select('简单', '中等', '困难')`
);

// 添加关联列
await window.indexOS.db.runQuery(
  `ALTER TABLE "书单" ADD COLUMN "出版社" relation REFERENCES "出版社表"`
);
```

#### 删除列

```sql
ALTER TABLE "表名" DROP COLUMN "列名"
```

```javascript
await window.indexOS.db.runQuery(
  `ALTER TABLE "书单" DROP COLUMN "评分"`
);
```

#### 返回值

```javascript
// ADD COLUMN
{ columns: ["success", "affectedRows", "message"], values: [[1, 0, "Column '评分' added successfully to table '书单'."]] }

// DROP COLUMN
{ columns: ["success", "affectedRows", "message"], values: [[1, 0, "Column '评分' dropped successfully from table '书单'."]] }
```

---

### 3.3 DROP TABLE — 删除数据库

```sql
DROP TABLE "表名"
```

```javascript
await window.indexOS.db.runQuery(`DROP TABLE "书单"`);
```

> [!CAUTION]
> 此操作会**永久删除**思源中的 AV 数据库块及其所有数据，且**不可撤销**。同时清除 Wasm 内存中的缓存和注册表。

#### 返回值

```javascript
{ columns: ["success", "affectedRows", "message"], values: [[1, 0, "Table '书单' dropped successfully."]] }
```

---

## 4. 辅助 API

### `instantiateAV` — 强制加载 AV 到内存

```javascript
await window.indexOS.db.instantiateAV("20260602170605-avid", true);
```

用于确保后续 SELECT 查询使用最新数据。`force = true` 强制重新拉取，忽略 TTL 缓存。

---
