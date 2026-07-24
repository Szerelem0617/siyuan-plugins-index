# 使用 SQLite 操作思源数据库指南

本指南为 **Index Plugin (v1.10.0+)** 开发者模式下提供的数据库与 SQLite 运维交互说明文档。

---

## 🛠️ 入口与基础配置

### 1. 开启开发者模式
1. 打开思源插件配置页面（`设置` -> `属性视图/数据库` 页面）；
2. 勾选开启 **开发者模式** 选项；
3. 勾选后系统将解锁全局 SQL 运维控制台、命令管理与 Supertag 高级控制能力。

### 2. 唤出控制台
开启开发者模式后，您可以通过以下两种方式随时唤出控制台面板：
- **快捷键**：`⌥⌘S` (Mac) 或 `Alt+Cmd+S` (Windows/Linux)；
- **鼠标快捷触发**：按住 `Alt` / `Option` 键，点击思源软件顶部栏右侧的 **原生搜索图标**。

---

## 🔍 一、基础查询与表名称说明 (`SELECT`)

在 SQL 交互终端中，查询操作是最基础且高频的使用场景。思源的数据表与系统原生数据库支持以下多种名称绑定与查询方式：

### 1. 表的指定格式
在编写 SQL 语句时，`FROM` 后面的表名支持以下几种形式（建议使用双引号 `" "` 包裹表名以防特殊字符）：

- **友好表名（友好别名/自定义表名）**：
  若数据库设置了友好表名或通过 DDL 创建，可直接使用表名查询：
  ```sql
  SELECT * FROM "任务列表";
  SELECT * FROM "项目管理" LIMIT 10;
  ```
- **原生 AV ID (`av_xxx`)**：
  每一个属性视图数据库在底层都有唯一的 `avID`（如 `av_20260721140000_5z3to31`），直接查询 `av_` 加 ID 对应的表：
  ```sql
  SELECT * FROM "av_20260721140000_5z3to31";
  ```
- **系统内置表**：
  实例化系统数据库后，可以查询 Layer 1/2/3 内存表：
  - `sys_registry_db`：已注册的命令库
  - `sys_command_db`：Layer 2 命令编排表
  - `sys_type_db`：Layer 3 超级标签绑定表

### 2. 常用查询示例
```sql
-- 1. 基础全量查询 (限制前 20 条)
SELECT * FROM "任务列表" LIMIT 20;

-- 2. 指定列与条件筛选
SELECT "主键", "优先级", "完成日期" FROM "任务列表" WHERE "优先级" = '高';

-- 3. 模糊匹配查询
SELECT * FROM "项目管理" WHERE "项目名称" LIKE '%开发%';

-- 4. 排序与分页
SELECT * FROM "任务列表" ORDER BY "截止时间" DESC LIMIT 10 OFFSET 0;
```

---

## ✏️ 二、数据行更新与删除 (`DML: UPDATE / DELETE`)

除了查询外，您可以通过标准 SQL DML 语句对思源属性视图中的单元格数据进行批量修改或删减。

### 1. 更新数据行 (`UPDATE`)
更新指定行的属性单元格数据：
```sql
-- 将所有高优先级的任务状态更新为“进行中”
UPDATE "任务列表" SET "状态" = '进行中' WHERE "优先级" = '高';

-- 更新特定行的项目名称
UPDATE "项目管理" SET "项目名称" = 'v1.10.0 重构架构' WHERE "主键" = '项目A';
```

### 2. 删除数据行 (`DELETE`)
从指定的属性视图数据库中移除行（不会删除原始文档块）：
```sql
-- 删除已完成的任务数据行
DELETE FROM "任务列表" WHERE "状态" = '已完成';
```

---

## 🏗️ 三、表与列结构修改 (`DDL: CREATE / ALTER / DROP TABLE`)

插件对 SQLite 的 DDL 进行了深层封装，可直接在思源当前文档中动态创建、修改或删除原生属性视图数据库。

### 1. 创建数据库表 (`CREATE TABLE`)
在当前编辑文档中快速生成一个新的 Attribute View 数据库表：
```sql
CREATE TABLE "项目管理" (
    "项目名称" TEXT,
    "优先级" SELECT(高, 中, 低),
    "进度" NUMBER,
    "完成日期" DATE,
    "相关任务" RELATION REFERENCES "任务列表"
);
```

### 2. 修改表结构 (`ALTER TABLE`)
支持在已有属性视图中动态添加或移除列：
- **添加新列 (`ADD COLUMN`)**：
  ```sql
  ALTER TABLE "项目管理" ADD COLUMN "负责邮箱" EMAIL;
  ALTER TABLE "项目管理" ADD COLUMN "状态" SELECT(未开始, 进行中, 已完成);
  ```
- **删除指定列 (`DROP COLUMN`)**：
  ```sql
  ALTER TABLE "项目管理" DROP COLUMN "负责邮箱";
  ```

### 3. 删除表 (`DROP TABLE`)
移除指定的数据库映射（取消 AV 绑定）：
```sql
DROP TABLE "项目管理";
```

### 4. 16 种思源原生 AV 列类型一览表

| 简写类型 | 描述说明 | 示例语法 |
| :--- | :--- | :--- |
| `TEXT` / `BLOCK` | 文本 / 块关联主键 | `"名称" TEXT` |
| `NUMBER` | 数字类型 | `"预算" NUMBER` |
| `SELECT` | 单选下拉框 | `"状态" SELECT(待处理, 处理中, 已完成)` |
| `MSELECT` | 多选下拉框 | `"标签" MSELECT(前端, 后端, 设计)` |
| `DATE` | 日期时间 | `"截止时间" DATE` |
| `CHECKBOX` | 复选框 (Boolean) | `"是否归档" CHECKBOX` |
| `URL` | 网址链接 | `"参考链接" URL` |
| `EMAIL` | 电子邮箱 | `"联系邮箱" EMAIL` |
| `PHONE` | 电话号码 | `"联系电话" PHONE` |
| `LINENUMBER` | 行号序号 | `"序号" LINENUMBER` |
| `RELATION` | 数据库关联列 | `"关联任务" RELATION REFERENCES "任务列表"` |
| `MASSET` | 资源文件附件 | `"附件" MASSET` |
| `ROLLUP` | 汇总统计列 | `"进度汇总" ROLLUP` |
| `TEMPLATE` | 模板列 | `"模板" TEMPLATE` |
| `CREATED` | 创建时间 (自动) | `"创建时间" CREATED` |
| `UPDATED` | 更新时间 (自动) | `"更新时间" UPDATED` |

---

## 🖼️ 四、视图管理 (`CREATE / ALTER / DROP VIEW`)

属性视图（Attribute View）支持在同一张数据表下创建不同的布局视图（表格 Table、看板 Kanban、画廊 Gallery），并绑定独立的筛选条件。

### 1. 创建新视图 (`CREATE VIEW`)
语法格式：
```sql
CREATE [KANBAN|GALLERY|TABLE] VIEW "视图名称" AS SELECT * FROM "原表名" [WHERE 筛选条件];
```
- **创建看板视图 (Kanban View)**：
  ```sql
  CREATE KANBAN VIEW "任务看板" AS SELECT * FROM "任务列表" WHERE "状态" = '进行中';
  ```
- **创建画廊视图 (Gallery View)**：
  ```sql
  CREATE GALLERY VIEW "卡片展示" AS SELECT * FROM "项目管理";
  ```
- **创建普通表格视图 (Table View)**：
  ```sql
  CREATE TABLE VIEW "高优先级任务" AS SELECT * FROM "任务列表" WHERE "优先级" = '高';
  ```

### 2. 修改视图条件与名称 (`ALTER VIEW`)
```sql
-- 修改视图名称与筛选条件
ALTER VIEW "任务看板" ON "任务列表" SET RENAME TO "进行中看板", WHERE "状态" = '进行中';
```

### 3. 删除视图 (`DROP VIEW`)
```sql
DROP VIEW "高优先级任务" ON "任务列表";
```

---

> [!TIP]
> ⚠️ **建议**：建议在进行大规模 `UPDATE`、`DELETE` 或 `DROP TABLE` 结构性变更操作前进行文档备份，避免误删数据。
