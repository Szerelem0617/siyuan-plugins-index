# 思源属性视图 (AV) 到 SQLite 转换与同步技术规范

## 1. 数据类型映射表 (AV Type Mapping)

| AV 类型 (`KeyType`) | 内核数据结构 | SQLite 推荐类型 | 转换逻辑与鲁棒性说明 |
| :--- | :--- | :--- | :--- |
| **`block`** | `ValueBlock` | `TEXT` | **主键/引用**：存 `Content`。对应思源块 ID，不可为 NULL。 |
| **`text`** | `ValueText` | `TEXT` | 原始字符串。 |
| **`number`** | `ValueNumber`| `REAL` | 存 `Content` (高精度浮点数)。SQL 中可直接进行聚合计算。 |
| **`date`** | `ValueDate` | `INTEGER` | 存 `Content` (UnixMilli 时间戳)。支持日期范围查询。 |
| **`select`** | `MSelect` (单) | `TEXT` | 存选项的文本名称。 |
| **`mSelect`** | `MSelect` (多) | `TEXT` (JSON) | 存为 JSON 数组字符串，方便利用 `json_each` 实现标签化查询。 |
| **`checkbox`**| `ValueCheckbox` | `INTEGER` | `0` 或 `1`。 |
| **`url/email/phone`** | (String) | `TEXT` | 原始字符串。 |
| **`mAsset`** | `ValueAsset` | `TEXT` (JSON) | 存完整资源信息的 JSON 数组，包含路径和原始文件名。 |
| **`relation`** | `ValueRelation` | `TEXT` (JSON) | 存关联块 ID 数组。反向更新时需验证 ID 合法性。 |
| **`rollup`** | `ValueRollup` | `TEXT` | **只读快照**。存内核计算结果，仅供查询参考。 |
| **`created/updated`** | (Time) | `INTEGER` | **只读系统字段**。UnixMilli 时间戳。 |

## 2. 正向同步 (AV -> SQLite) 代码关注点

1.  **行/Item 唯一性判定**:
    - 必须严格区分 `v.blockID` (行标识) 和 `v.block.id` (思源块标识)。
    - **聚合逻辑**：同步时必须以 `blockID` 为聚合键，将同一行下散落在不同 `KeyValues` 中的单元格归集到 SQL 的一行中，严禁产生重复行。
2.  **表名与列名清洗**:
    - `avID` 作为表名时需要加引号（如 `"20240408..."`）。
    - **列名唯一性保证**：由于不同 Key 可能重名，或清洗后撞车（如 `#` 和 `!` 都会变成 `_`），必须实现去重逻辑。
    - **推荐策略**：`Name_KeyID后4位` 或 `Name` (若重复则追加序号)。
3.  **动态转义保护**:
    - 数据库名 (AV ID) 和列名 (Key Name) 经常包含特殊字符。在所有 SQL 语句中，必须对标识符使用双引号包裹，例如 `CREATE TABLE "2024..." ("我的字段" TEXT...)`。
4.  **空值语义鲁棒性**:
    - 如果内核中 `IsNotEmpty` 标志为 `false`，SQL 字段应显式填入 `NULL` 而非 `0` 或空字符串，以便 SQL 的 `IS NULL` 语法生效。

## 3. 反向同步 (SQLite -> AV) 关注点 (未来规划)

1.  **API 原子操作**:
    - 必须通过接口同步，严禁直接修改 `.json` 源文件。调用 `/api/av/batchSetAttributeViewBlockAttrs` 以确保触发内核联动。
2.  **复杂结构封装**:
    - SQL 的标量数据写回时，必须根据原始 `KeyType` 重新封装成内核所需的复杂 JSON 结构（包括 `isNotEmpty` 等元数据）。
3.  **选项池自动维护**:
    - 写入 `select` 类型列时，若 SQL 中的值在 AV 选项池中不存在，逻辑层应先调用 API 自动扩充选项池，避免 UI 显示异常。

## 4. 非法写入与安全策略

1.  **禁止更新的字段**:
    - **系统字段**：`created`, `updated`, `lineNumber` 严禁手动修改。
    - **计算字段**：`rollup` 字段同步应设为只读。
2.  **主键完整性限制**:
    - 严禁通过 SQL 修改 `rowID` (即关联的 BlockID)。修改主键会导致数据与物理块“断联”，产生僵尸记录。
3.  **JSON 格式保护**:
    - 针对 `mSelect`、`relation` 等 JSON 列，写入前必须通过格式校验，防止非 JSON 字符串破坏反向同步逻辑。
