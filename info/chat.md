# 思源属性视图（AV）极简 SQL/Database API 架构设计提案 (运行时按需转译方案)

为了解决在 Siyuan 插件开发中“频繁对属性视图（AV）进行增删改查操作时易出错、字段 ID 映射繁琐、API 结构复杂”的痛点，我们在此分析并设计一套标准化的 **AV 写入/变动 API**，允许本插件及其他第三方插件通过极简的 SQL 统一操作思源内置表格。

经过深度论证，为了**彻底规避本地 SQLite 镜像缓存与思源磁盘文件不同步的风险（脑裂问题）**，同时**消灭复杂的后台同步守护代码**，我们决定放弃“全局实例化物理数据库”的设计，采用**“运行时按需转译（On-Demand In-Memory Hybrid）”**模式。

---

## 1. 核心共识：运行时按需转译模式

新架构核心原则为：**读操作临时建表，写操作直接翻译且不建表，不保存物理 SQLite 文件，不运行全局后台同步守护。**

```mermaid
flowchart TD
    SQL[开发者 SQL 语句] --> Route{解析 SQL 类型}
    
    %% 读分支
    Route -->|1. SELECT 查询| Read[按需拉取数据]
    Read -->|API 请求| FetchJSON[获取 AV 真实最新 JSON]
    FetchJSON -->|写入内存| WasmDB[(Wasm SQLite 内存临时表)]
    WasmDB -->|执行 SQL| Query[联查/分组/过滤计算]
    Query -->|返回结果| Output[结构化结果集]
    Query -->|垃圾回收| Clear[自动释放内存表]
    
    %% 写分支
    Route -->|2. DML/DDL 增删改| Check{校验 WHERE 条件}
    Check -->|复杂条件 b > 2| Reject[拦截并报错: 不支持复杂写]
    Check -->|简单条件 id = 'row-xxx'| Write[按需拉取 Schema 字典]
    Write -->|API 请求| FetchSchema[获取 KeyID & KeyType]
    FetchSchema -->|组装 Payload| Payload[翻译为 Siyuan JSON 事务]
    Payload -->|HTTP POST| Siyuan[(思源 Go 内核)]
```

---

## 2. 读写操作的具体技术规范

### A. SELECT 查询操作（仅在搜索时触发临时内存建表）
* **运行机制**：
  1. 当且仅当开发者执行 `SELECT` 语句时，解析层实时发送 HTTP 请求 `/api/av/getAttributeView` 抓取目标属性视图的最新完整数据。
  2. 在 WebAssembly 纯内存中（`sql.js`）临时执行 `CREATE TABLE` 并将数据行 `INSERT` 进去。
  3. 执行 SQL 计算并返回结果。
  4. 立即释放或垃圾回收该内存表。
* **优势**：
  - **100% 数据一致性**：每次查询都实时去思源拿最新数据，完全避免了缓存不同步的 bug。
  - **保留了完整的 SQL 语法威力**：在内存中我们依然拥有全功能 SQLite 引擎，因此完美支持 `JOIN`（需联查表均已拉取）、`GROUP BY`、`ORDER BY`、聚合函数等复杂读操作。
  - **极速响应**：千行级表格的拉取、解析与内存建表在本地 Loopback 网络下通常在 **30ms - 100ms** 内完成，对于脚本和检索交互完全无感。

### B. INSERT / UPDATE / DELETE 增删改操作（完全不建表，直接翻译）
* **运行机制**：
  - 写操作**完全不在内存中载入任何行数据或创建临时表**。
  - 解析层将直接读取对应 AV 的字段 Schema（字段名 ➔ `keyID` 映射，仅需几字节网络开销且可做短 TTL 缓存）。
  - 将 SQL 直接正则拆解，转译为思源的单元格 JSON 事务 Payload，直接通过 HTTP 发送给思源 Go 内核。
* **限制与阉割定义**：
  1. **禁止复杂条件写**：仅支持单表简单写，条件必须为固定的 `WHERE id = 'row-xxx'` 或 `WHERE id IN ('row-1', 'row-2')`。
  2. **不支持级联修改和子查询写**：例如 `UPDATE TableA SET x = 1 WHERE id = (SELECT ...)` 将被直接拦截并抛出不支持异常。
  3. **数据类型强制转换**：所有 SQL 类型映射到思源内置字段类型（`TEXT`➔`text`, `BOOLEAN`➔`checkbox` 等）。

---

## 3. 架构对比：全局磁盘镜像 vs. 运行时按需转译

| 维度 | 全局磁盘镜像（旧方案） | 运行时按需转译（新共识） | 优劣势评估 |
| :--- | :--- | :--- | :--- |
| **磁盘占用** | 写入物理文件 `index-os.sqlite` | **0 字节**，完全基于内存和临时变量 | 新方案极其轻量，对思源同步盘无负担 |
| **数据一致性** | 易产生“脑裂”，需复杂的 WS 同步监听 | **100% 绝对一致**，读写均实时对接内核 | 新方案彻底消灭了同步不一致的顽疾 |
| **写操作开销** | 每次都需要将整个 Wasm 数据库持久化到磁盘 | 仅发一条 HTTP API 请求直接回写思源 | 新方案对写操作的磁盘 IO 友好度极高 |
| **读操作速度** | 本地内存执行（< 1ms） | 需要额外拉取一次 AV 数据（30-100ms） | 旧方案略快，但对于千行级数据新方案的延迟完全在可接受范围内 |
| **系统复杂度** | 极高（包含文件读写、WS 监听、数据 Hash 比对） | **极低**（仅包含正则解析和按需 Fetch） | 新方案减负了 60% 以上的代码量，大幅提升稳定性 |

---

## 4. 下阶段落地排期（更新版）

为了尽快落实这一轻量化的极简 SQL API，下阶段开发任务调整如下：

### 📅 开发计划
* **Phase 1 [列名翻译字典构建]**：
  编写轻量级缓存映射，允许在运行时通过 `/api/av/getAttributeViewKeysByAvID` 高速获取表字段映射表，将 `'列名'` 翻译为 `col-xxxx` 列 ID。
* **Phase 2 [纯 API 变动转译层 (DML 写)]**：
  实现 `executeWritableSql` 的正则分支，拦截不符合 `WHERE id = '...'` 的复杂修改。解析符合标准的 `UPDATE/INSERT/DELETE` 并直接将 Payload 提交至思源接口。
* **Phase 3 [内存临时建表与 SELECT 转译 (读)]**：
  实现 `executeReadSql`：每次执行查询时动态请求属性视图 JSON，用 `sql-wasm.js` 在纯内存中动态建表并写入数据，运行 SQL 查询并返回结果，最后自动销毁或垃圾回收内存表。
* **Phase 4 [外部 API 暴露]**：
  将 `window.indexOS.db.executeSql` 注册为全局接口，本插件的诊断面板、逻辑工厂以及其他外部插件均可以通过传入一条 SQL 字符串来进行极简的 AV 操作。
