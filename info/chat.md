# 思源属性视图（AV）极简 SQL API 暴露与重写评估总结

此文档记录了本插件如何向外暴露 SQL 读写接口以供其他插件或用户调用，并针对本插件已有的各种属性视图（AV）操作，进行了“要不要使用极简 SQL API 进行重写”的架构设计与评估分析。

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

## 2. DDL (数据定义语言) 扩展脑洞与 Siyuan 原生列类型支持

针对建表与改字段（DDL）的 SQL 转译支持，我们进行了更深入的方案探究。

### 💡 绝妙思路：直接使用思源原生类型作为 SQL 类型声明

您提到的 **`CREATE TABLE "表名" (列名1 number, 列名2 relation)`** 方案是一个**非常巧妙且完美的破局思路**！

* **为什么可行？**
  * 在 SQLite 中，列的类型声明（Column Type）是**动态且自由度极高**的。SQLite Wasm 引擎在执行 `CREATE TABLE` 时，**允许接受任何自定义字符串作为类型声明**。因此，传入 `relation`、`mSelect` 或 `checkbox` 等类型并不会导致 SQL 引擎报错。
  * 我们的 DDL SQL 转译层可以直接通过正则表达式拦截并解析出这些“思源专属”的类型声明，并直接 1:1 映射并调用思源的接口。

### 🛠️ 方案实现路径设计

如果我们要让这套原生 DDL 转译运行起来，逻辑如下：

#### 1. 新建表 (`CREATE TABLE`)
* **SQL 语法**：
  ```sql
  CREATE TABLE "新数据表" (
      "标题" block,
      "状态" select,
      "负责人" relation,
      "启用" checkbox
  );
  ```
* **转译执行流**：
  1. 拦截 `CREATE TABLE` 语句。
  2. 调用思源的 `/api/filetree/createDocWithMd`，在系统配置的默认笔记本或索引沙盒目录下创建一个包含属性视图 block 标记的空文档：
     `<div data-type="NodeAttributeView" data-av-type="table"></div>`
  3. 等待思源建立完该 AV 的物理实例化，并通过 DOM / 块属性读取获得新生成的 `avID`。
  4. 解析列定义括号内的字段。第一列声明为 `block` 类型（主键）。
  5. 依次为其他列调用 `/api/av/addAttributeViewKey`，并将 SQL 里的类型直接映射为思源的原生类型：
     * `select` ➔ `select`
     * `relation` ➔ `relation`
     * `checkbox` ➔ `checkbox`
  6. 在 friendlyTableNameMap 中将 `"新数据表"` 注册并重定向为这个新生成的 `avID`。

#### 2. 添加列 (`ALTER TABLE ADD COLUMN`)
* **SQL 语法**：
  ```sql
  ALTER TABLE "我的表" ADD COLUMN "进度" number;
  ```
* **转译执行流**：
  1. 解析出目标表名 `"我的表"` 并解析 `avID`。
  2. 调用 `/api/av/addAttributeViewKey`，其中 `keyType` 直接设为 `"number"`，`keyName` 设为 `"进度"`。

#### 3. 删除列 (`ALTER TABLE DROP COLUMN`)
* **SQL 语法**：
  ```sql
  ALTER TABLE "我的表" DROP COLUMN "进度";
  ```
* **转译执行流**：
  1. 解析表名和要删除的列名 `"进度"`。
  2. 通过 schema 缓存解析出 `"进度"` 列 the `keyID`。
  3. 调用 `/api/av/removeAttributeViewKey`，传入该 `keyID` 执行物理删除。

---

### ⚖️ 该方案的优缺点评估

* **优点**：
  * **一致性极强**：开发者可以直接用思源的 16 种原生类型建表，完全消除了标准 SQL 类型不足的缺陷。
  * **极大简化初始化操作**：通过一段简单的 SQL DDL 脚本即可快速给其他插件搭建出完整的表格系统，极其适合模块化部署。
* **缺点/局限性**：
  * 对 `relation`（关联列）和 `select`（多选列）这种需要传递附属配置的字段（例如关联哪张表、选项背景色是什么），SQL DDL 语法层面依然无法自然地传递这些细节参数。
  * 需要做很多关于“如何确定新创建 AV 块的文档挂载位置”的策略兜底（如默认挂载在插件专属数据页上）。

---

### 💡 结论：是否需要加入此 DDL 支持？

目前本插件的系统底层表格（Command-DB 和 Type-DB）均已在初次加载时完成了初始化（通过 JS 逐步构建），当前的业务中暂时不需要频繁调用 `CREATE TABLE` / `ALTER TABLE`。

因此，这一套“直接按思源列类型建表”的 DDL 引擎非常适合作为**高阶开发者特供功能**。如果在后续迭代中，我们需要支持更复杂的第三方插件快速部署其独占表格，我们可以基于此设计图快速将这套 DDL 解析分支接入并暴露！
