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
  - `sys_registry_db`：Layer 1 已注册的命令库（commands.json 的查询镜像）
  - Layer 2/3 数据在“将数据存到思源”后存储于思源属性视图（command-db / supertag-db），
    通过对应的 `av_*` 表查询；未存储时系统直接读取插件内置种子数据，无 SQLite 表。

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

## ✏️ 二、数据行操作 (`DML: INSERT / UPSERT / UPDATE / DELETE`)

除了查询外，您可以通过标准 SQL DML 语句对思源属性视图中的单元格数据进行新增、批量修改或删减。

### 1. 插入数据行 (`INSERT INTO / UPSERT`)

思源数据库中的数据行分为**游离行（Detached Row）**与**原生实体块关联行（Native Block Row）**两种：

#### ① 插入游离内容（不占用文档实际段落）
直接传入普通文本或各类型字段，系统会自动在属性视图数据库中生成独占的游离行：
```sql
INSERT INTO "任务列表" ("任务名称", "状态", "估算工时", "是否完成") 
VALUES ('重构数据库后端', '进行中', 12.5, true);
```

#### ② 插入原生实体块（将文档中已有段落块绑定到数据库）
只需在插入时将第一列（或 `id`/`rowID` 列）指定为思源块的 14 位真实 Block ID（如 `'20260722154220-2przl2z'`）：
```sql
-- 方法 1：直接在第一列传入原生块 ID
INSERT INTO "任务列表" ("任务名称", "状态", "优先级") 
VALUES ('20260722154220-2przl2z', '进行中', '高');

-- 方法 2：显式声明 id 列传入原生块 ID
INSERT INTO "任务列表" (id, "任务名称", "状态") 
VALUES ('20260722154220-2przl2z', '绑定已有文档块', '进行中');

-- 方法 3：使用 UPSERT 语法（存在则更新对应块的属性，不存在则关联绑定）
INSERT INTO "任务列表" ("任务名称", "状态", "优先级") 
VALUES ('20260722154220-2przl2z', '已处理', '中')
ON CONFLICT("任务名称") DO UPDATE SET "状态" = EXCLUDED."状态";
```

### 2. 更新数据行 (`UPDATE`)
更新指定行的属性单元格数据（支持修改普通列、修改主键绑定的 Block ID 或转换游离状态）：
```sql
-- 1. 更新普通单元格数据
UPDATE "任务列表" SET "状态" = '进行中' WHERE "优先级" = '高';

-- 2. 修改主键绑定：将已有行改绑到新的原生块（传入 14 位 Block ID）
UPDATE "任务列表" SET "任务名称" = '20260722154220-2przl2z' WHERE id = 'row_xxxxxx';

-- 3. 将原生块行转为游离行（传入普通文本名称）
UPDATE "任务列表" SET "任务名称" = '纯游离卡片文本' WHERE id = '20260722154220-2przl2z';
```

### 3. 删除数据行 (`DELETE`)
从指定的属性视图数据库中移除行（如果是游离行则直接删除，如果是原生块则仅取消数据库关联）：
```sql
-- 删除已完成的任务数据行
DELETE FROM "任务列表" WHERE "状态" = '已完成';
```

---

## 🏗️ 三、表与列结构修改 (`DDL: CREATE / ALTER / DROP TABLE`)

插件对 SQLite 的 DDL 进行了深层封装，可直接在思源当前文档中动态创建、修改或删除原生属性视图数据库。

### 1. 创建数据库表 (`CREATE TABLE`)
在思源中动态创建一个新的 Attribute View 数据库表：
```sql
CREATE TABLE "项目管理" (
    "项目名称" TEXT,
    "优先级" SELECT(高, 中, 低),
    "进度" NUMBER,
    "完成日期" DATE,
    "相关任务" RELATION REFERENCES "任务列表"
);
```

> [!NOTE]
> 📌 **指定页面与创建位置**：
> - **默认行为**：未单独指定参数时，会在当前活动的文档窗口底部自动生成该数据库。
> - **开发者 API 扩展**：通过 `executeWritableSql(sql, { targetDocId: '2026xxxxxx-xxxxxx' })` 可指定数据库生成的目标文档；通过 `{ insertAfterBlockId: '2026xxxxxx-xxxxxx' }` 可指定插入到某个块的下方。

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

### 2. 修改视图与显隐控制 (`ALTER VIEW`) (支持思源 3.8.0+)
支持通过 SQL 灵活控制指定视图在选项卡中的隐藏与暴露、调整列隐藏状态或修改视图图标：

```sql
-- 1. 控制视图显隐 (支持思源 3.8.0+ 视图隐匿功能)
-- 隐藏 "复合命令" 视图 (使该视图不在界面选项卡中暴露，至少保留 1 个可见视图)
ALTER VIEW "复合命令" ON "command-db" SET VISIBLE false;

-- 重新暴露/显示 "复合命令" 视图
ALTER VIEW "复合命令" ON "command-db" SET VISIBLE true;

-- 2. 设置视图图标 (支持设置思源 Icon 标识或 Emoji 字符)
ALTER VIEW "普通命令" ON "command-db" SET ICON '⚡';

-- 3. 控制指定列在视图中的隐藏/展开
ALTER VIEW "普通命令" ON "command-db" SET COLUMN "Pipeline_定义" HIDDEN true;
ALTER VIEW "普通命令" ON "command-db" SET COLUMN "Pipeline_定义" HIDDEN false;

-- 4. 修改视图名称与筛选条件
ALTER VIEW "任务看板" ON "任务列表" SET RENAME TO "进行中看板", WHERE "状态" = '进行中';
```

### 3. 删除视图 (`DROP VIEW`)
```sql
DROP VIEW "高优先级任务" ON "任务列表";
```

---

> [!TIP]
> ⚠️ **建议**：建议在进行大规模 `UPDATE`、`DELETE` 或 `DROP TABLE` 结构性变更操作前进行文档备份，避免误删数据。
