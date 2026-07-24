# 数据库与 SQLite 运维指南

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

## 📊 核心功能与基础教学

数据库控制台内置 **数据库视图（Explorer）**、**SQL 控制台 (Console)**、**命令管理 (Commands)** 与 **超级标签 (Supertag)** 多个核心功能模块：

1. **数据库视图（DB Explorer）**：
   - 自动扫描并集中罗列工作区中的所有属性视图数据库（Attribute View）；
   - 提供快捷跳转与 `Locate` 页面定位功能，可直接在编辑器中高亮聚焦目标数据库。

2. **SQL 交互控制台**：
   - 内置轻量 SQLite 引擎，支持直接编写标准 SQL 语句进行实时数据查询、分析与批量更新；
   - 自动支持对思源原生 Attribute View 的扩展 DDL 与 DML 映射操作。

3. **命令与 Supertag 基础配置**：
   - 点击面板中的 **“实例化数据库”** 按钮后，系统将在“IndexOS”笔记本中自动初始化 Layer 2（Command-DB）与 Layer 3（Supertag-DB）；
   - 支持在编辑器中使用 `/插入命令按钮` 斜杠指令，快速插入支持一键触发的可交互命令按钮。

---

## 💻 支持的 SQL 命令细则 (DDL / DML)

插件对标准 SQL DDL/DML 进行了定制封装，可直接映射修改思源属性视图 (AV) 结构与数据：

### 1. 创建数据库表 (`CREATE TABLE`)
语法格式：
```sql
CREATE TABLE "表名" (
    "列名1" 列类型1,
    "列名2" 列类型2(选项1, 选项2),
    "关联列" RELATION REFERENCES "目标表名"
);
```
- **示例**：
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
支持添加或删除属性视图列：
- **添加列 (`ADD COLUMN`)**：
  ```sql
  ALTER TABLE "项目管理" ADD COLUMN "负责邮箱" EMAIL;
  ALTER TABLE "项目管理" ADD COLUMN "标签状态" SELECT(进行中, 已挂起, 已完成);
  ```
- **删除列 (`DROP COLUMN`)**：
  ```sql
  ALTER TABLE "项目管理" DROP COLUMN "负责邮箱";
  ```

### 3. 删除表 (`DROP TABLE`)
移除指定的数据库映射（不会破坏绑定的文档底层）：
```sql
DROP TABLE "项目管理";
```

### 4. 支持的列类型清单 (16 种原生 AV 类型)

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
| `RELATION` | 数据库关联列 | `"任务关联" RELATION REFERENCES "任务表"` |
| `MASSET` | 资源文件附件 | `"附件" MASSET` |
| `ROLLUP` | 汇总统计列 | `"进度汇总" ROLLUP` |
| `TEMPLATE` | 模板列 | `"模板" TEMPLATE` |
| `CREATED` | 创建时间 (自动) | `"创建时间" CREATED` |
| `UPDATED` | 更新时间 (自动) | `"更新时间" UPDATED` |

### 5. 数据查询与更新 (`SELECT`, `UPDATE`, `DELETE`)
可以直接使用标准 SQLite 语法进行查询与数据修改：
```sql
-- 查询指定列
SELECT * FROM av_20260721140000 LIMIT 20;

-- 数据行筛选
SELECT * FROM av_20260721140000 WHERE "优先级" = '高';
```

---

> [!TIP]
> ⚠️ **温馨提示**：开发者模式与 SQL 直接修改操作建议在测试工作空间或进行了文档备份的前提下使用。
