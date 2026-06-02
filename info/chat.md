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

## 2. 当前插件 AV 关联操作的 SQL 重写可行性评估

本插件目前有大量和属性视图（AV）直接交互的业务功能。以下是关于“是否要用新暴露的 SQL 方法重写这些功能”的深度评估：

### 🛠️ 插件现有 AV 相关功能一览
1. **属性视图数据源与大纲双向同步** (`db-reverse-list.ts`, `attribute-sync.ts`)
2. **主标签（Supertag）文档监控与默认属性写入** (`supertag.ts`, `supertag-manager.ts`)
3. **属性视图配置面板与列定义映射** (`db-config.ts`, `create-db.ts`)
4. **单元格逻辑变更与批量更新** (`batch-update.ts`, `special-handlers.ts`)

---

### 📝 重写可行性与性价比对比表

| 功能模块 | 读操作是否重写 | 写操作是否重写 | 架构师决策与核心理由 |
| :--- | :---: | :---: | :--- |
| **1. 双向同步与大纲转换** | **推荐重写** | **部分重写** | **读极大提升，写保持现状**：<br>・ 读：原逻辑需要用大量的 JS 遍历代码查找大纲与 AV 的映射关系。使用 SQL 查询（如：`SELECT rowID FROM table WHERE label = 'xx'`）可以省去大量过滤手写代码。<br>・ 写：大纲生成需要连续、高密度的批量级联写，直接调用 API Payload 可最大化减免解析开销。 |
| **2. 主标签（Supertag）默认写入** | **不推荐** | **极力推荐重写** | **写体验降维打击**：<br>・ 往常向新打了主标签的文档写入默认属性值（如 `Status = 'Todo'`, `Priority = 'Medium'`），需要通过 HTTP 拿到该 AV 的列信息，找到每个列的字段 ID，然后再手动封装成极其嵌套复杂的 Cell JSON Transaction。<br>・ 如果使用 `runQuery("UPDATE \"Type-DB\" SET Status = 'Todo' WHERE id = 'doc-xxx'")`，可以将代码从 **30 行缩减为 1 行**，且完全不用管底层的 KeyID 是什么，维护性价比极高。 |
| **3. 配置面板与列头管理 (DDL)** | **不推荐** | **禁止重写** | **不适合 SQL 表达模式**：<br>・ 配置面板涉及大量的思源底层专属操作：如添加特定类型关联列（`relation` 需定义双向关联 BlockID）、编辑单选/多选的背景颜色等。<br>・ 这些属于配置管理（Schema 管理），用 SQL DDL 极其难以传递颜色、关联 ID 等元属性。应当继续用原生 REST API 维持精细控制。 |
| **4. 局部单元格变更** | **不推荐** | **极力推荐重写** | **简化点对点写**：<br>・ 在属性面板、双击切换启用状态等交互处，直接执行 `UPDATE` SQL 是最符合直觉的。它免去了实例化并读取结构体的开销，写起来干净利落。 |

### 💡 总结结论：按需混合使用
* **大批量、低延迟、底层专属（如管理字段属性、颜色、大批量初始化写入）** 的操作：**继续使用原生思源 HTTP API**。
* **业务层面的增删改查、局部状态更新、以及需要根据列名多条件检索数据** 的操作：**全面使用新暴露的 SQL API 进行重写**。这能让本插件的业务代码行数缩减 35% 以上，并大幅增加可读性！
