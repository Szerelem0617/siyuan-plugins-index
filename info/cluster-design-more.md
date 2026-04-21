# 群与超图的统一实现设计 (Cluster-Hyperedge Unified Model)

> 延续 cluster-design.md 的分析，深入探讨群与超边的统一数据模型、性能考量、与四层架构的关系，以及存储架构选型。

---

## 一、群与超边的统一：RelationGroup 模型

### 1.1 关键洞察

群和超边是同一事物的两个极端：

```
纯群 (Cluster)                         纯超边 (Hyperedge)
成员完全对等                             成员有明确角色
"刺客们是一伙的"                         "F 是结果，m 和 a 是因子"
│                                        │
▼           ◄ ─ ─ ─ 光谱 ─ ─ ─ ►        ▼
RelationGroup                        RelationGroup
  roles = null                         roles = [左值, 乘数1, 乘数2]
```

用户不需要区分两个概念。他们只需要知道："我可以把相关的东西圈在一起。如果需要，还可以给每个成员标注它在这个关系中的角色。"

### 1.2 统一数据模型定义

```typescript
interface RelationGroup {
    // === 核心标识 ===
    id: string;              // 群/超边实体的块 ID（Detached 独立块）
    name: string;            // 显示名，如 "电流公式" 或 "牛顿第二定律"
    
    // === 类型与分类 ===
    groupType: string;       // "formula" | "synergy" | "knowledge" | "workflow" | 自定义
    isHyperedge: boolean;    // false = 纯群(对等), true = 超边(有角色)
    
    // === 成员关系 ===
    members: BlockRef[];     // 所有成员的块引用列表（Relation 列）
    
    // === 角色信息（超边模式专用）===
    // 方案 A: 角色列（简单，适合固定角色数）
    roleSlots?: {
        [slotName: string]: BlockRef[];  // 如 { "结果": [F], "因子": [m, a] }
    };
    // 方案 B: 成员-角色映射（灵活，适合动态角色数）
    memberRoles?: Map<BlockRef, string>; // 如 { F: "结果", m: "因子", a: "因子" }
    
    // === 元数据 ===
    description?: string;
    thresholdRules?: string; // 阈值触发规则 JSON（羁绊等）
    sourceAvId?: string;     // 来源 AV ID
}
```

### 1.3 AV 层的实现：两种 View 切换

用同一张 AV 同时服务两种心智模型：

```
═══════════════════════════════════════════════════════════
  AV: 物理知识·关系组

  ┌─── View 1: 群视图 (简洁) ─────────────────────────┐
  │ 群名         │ 类型     │ 成员                      │
  │──────────────┼──────────┼──────────────────────────│
  │ 电流公式      │ 公式群   │ [I, A, n, v, q]          │
  │ 基础定律      │ 知识群   │ [欧姆, 基尔霍夫, 电功率]  │
  └────────────────────────────────────────────────────┘

  ┌─── View 2: 关系视图 (完整) ────────────────────────────────────┐
  │ 关系名       │ 类型   │ 全部成员       │ 角色A:结果 │ 角色B:因子  │
  │──────────────┼────────┼───────────────┼───────────┼────────────│
  │ 电流公式      │ 公式   │ [I,A,n,v,q]  │ [I]       │ [A,n,v,q]  │
  │ 牛二定律      │ 公式   │ [F,m,a]      │ [F]       │ [m,a]      │
  └────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════
```

**View 1（群视图）** 隐藏了角色列，只展示"谁和谁在一起"。
**View 2（关系视图）** 展示完整的角色分配。

**两个 View 读写同一份数据**——用户在群视图中添加成员，在关系视图中分配角色。

### 1.4 从群到超边的渐进升级路径

```
用户旅程：

Day 1: "我想把这几个物理量圈在一起"
  → 创建群，拖入 [I, A, n, v, q]
  → 数据：members = [I, A, n, v, q], roles = null
  → 体验：简单直观

Day 7: "我想标注一下谁是结果、谁是因子"
  → 切换到关系视图
  → 把 I 拖到"角色A:结果"列，其余拖到"角色B:因子"列
  → 数据：members 不变, roleSlots = { 结果: [I], 因子: [A,n,v,q] }
  → 体验：无缝升级，没有"重建"成本

Day 30: "我想可视化这些关系"
  → 启动全景图渲染器
  → 纯群显示为"无向簇"，超边显示为"有向带角色的星形"
  → 体验：同一套数据自动适配两种可视化
```

---

## 二、统一实现的技术细节

### 2.1 AV 列结构设计

```
关系组 AV 标准列定义：

必须列：
  ├── 主键 (Block)       → 群/超边实体块（Detached）
  ├── 名称 (Text)        → 群名或关系名
  ├── 类型 (Select)      → formula / synergy / knowledge / workflow / custom
  └── 成员 (Relation)    → 指向节点池 AV 中的成员块

可选列（关系视图专用）：
  ├── 角色A (Relation)   → 第一个角色槽位的成员
  ├── 角色B (Relation)   → 第二个角色槽位的成员
  ├── 角色C (Relation)   → 更多角色可动态添加列
  └── 角色说明 (Text)    → 对角色分配的文字描述

扩展列（特定类型专用）：
  ├── 阈值规则 (Text)    → JSON 格式的阈值触发配置
  ├── 描述 (Text)        → 对关系的上下文描述
  └── 统计 (Rollup)      → 自动聚合成员属性
```

### 2.2 "成员"列 vs "角色X"列的数据一致性

一个重要的数据约束：**所有角色列中的块 ID 的并集 = 成员列中的块 ID**。

```
成员 = [I, A, n, v, q]        ← 全集
角色A:结果 = [I]               ← 子集
角色B:因子 = [A, n, v, q]     ← 子集
角色A ∪ 角色B = 成员            ← 一致性约束
```

**实现策略**：
- 方案 A（成员列为 Source of Truth）：用户操作"成员"列增删，角色列的有效范围自动约束
- 方案 B（角色列为 Source of Truth）：用户操作角色列时，"成员"列自动计算为所有角色列的并集
- **推荐方案 B**：因为超边模式下用户直接操作角色列更自然；群模式下直接操作成员列，角色列为空

### 2.3 SQLite 反向索引的统一表设计

```sql
-- 统一表：同时服务群查询和超边查询
CREATE TABLE relation_group_membership (
    block_id TEXT NOT NULL,           -- 成员块 ID
    group_id TEXT NOT NULL,           -- 群/超边实体块 ID
    group_name TEXT,                  -- 冗余存储群名（加速查询，避免 JOIN）
    group_type TEXT,                  -- 冗余存储类型
    role TEXT DEFAULT 'member',       -- 群模式下 = 'member'，超边模式下 = 具体角色名
    source_av_id TEXT NOT NULL,       -- 来源 AV ID（用于同步和清理）
    updated_at INTEGER,
    PRIMARY KEY (block_id, group_id, role)
);

-- 索引
CREATE INDEX idx_rgm_block ON relation_group_membership(block_id);
CREATE INDEX idx_rgm_group ON relation_group_membership(group_id);
CREATE INDEX idx_rgm_source ON relation_group_membership(source_av_id);

-- 查询示例
-- Q1: 块 X 属于哪些群/超边？
SELECT group_name, group_type, role FROM relation_group_membership WHERE block_id = ?;

-- Q2: 群 Y 有哪些成员？
SELECT block_id, role FROM relation_group_membership WHERE group_id = ?;

-- Q3: 块 X 在哪些关系中扮演"结果"角色？
SELECT group_name FROM relation_group_membership WHERE block_id = ? AND role = '结果';

-- Q4: 块 X 和块 Y 共同属于哪些群？
SELECT group_id, group_name FROM relation_group_membership
WHERE block_id IN (?, ?) GROUP BY group_id HAVING count(DISTINCT block_id) = 2;

-- Q5: 群 Y 的成员中，有多少属于"已掌握"状态？（跨表 JOIN）
SELECT count(*) FROM relation_group_membership rgm
JOIN node_attributes na ON rgm.block_id = na.block_id
WHERE rgm.group_id = ? AND na.status = 'mastered';
```

### 2.4 操作流程：创建群 vs 创建超边

```
用户操作 A：创建群（简单模式）
  1. 选中多个块 → 右键 "创建关系组"
  2. 弹出对话框：
     ┌───────────────────────────────────┐
     │  创建关系组                        │
     │  名称：[____________]             │
     │  类型：[知识群 ▼]                  │
     │  目标数据库：[物理知识 ▼]           │
     │  成员：块1, 块2, 块3              │
     │                                   │
     │  □ 启用角色分配（高级）             │
     │                                   │
     │        [取消]  [创建]              │
     └───────────────────────────────────┘
  3. 插件创建群实体块 → 写入 AV → 更新 SQLite 索引

用户操作 B：创建超边（高级模式）
  1. 同上，但勾选"启用角色分配"
  2. 对话框扩展：
     ┌───────────────────────────────────┐
     │  创建关系组 (角色模式)              │
     │  名称：[牛顿第二定律]              │
     │  类型：[公式 ▼]                    │
     │                                   │
     │  角色槽位：                        │
     │  ┌──────┬────────────────┐       │
     │  │ 结果  │ [拖入: F]      │       │
     │  │ 因子  │ [拖入: m, a]   │       │
     │  │ [+添加角色]           │       │
     │  └──────┴────────────────┘       │
     │                                   │
     │        [取消]  [创建]              │
     └───────────────────────────────────┘
```

---

## 三、性能分析

### 3.1 纵向群 vs 横向群

| 维度 | 纵向群（层级自动生成） | 横向群（用户手动创建） |
|:---|:---|:---|
| **存储成本** | ⭐ 零（可从 Path 列计算） | ⚠️ 需要存储成员关系 |
| **写入成本** | ⭐ 零 | O(k) per member change |
| **查询"群的所有成员"** | 快（`WHERE path LIKE 'prefix%'`） | 快（`WHERE group_id = ?`） |
| **查询"块属于哪些群"** | 需计算所有祖先（`path.split('/')` → 每段一个群） | 直接查索引表 |
| **同步维护** | 列表结构变更时自动重算 | AV 变更时增量同步 |
| **总体性能** | ⭐⭐⭐⭐⭐ 极优 | ⭐⭐⭐⭐ 优 |

**纵向群的性能优势本质**：它不是"多一种索引更快"，而是"根本不需要额外索引"。层级关系已经隐含在 Path/Level 列中，是**免费的计算**。

### 3.2 SQLite 足够吗？

**结论：对个人知识管理规模，SQLite 绰绰有余。**

| 量级 | 典型值 | SQLite 承受力 |
|:---|:---|:---|
| 总块数 | ~50,000 | 轻松 |
| 群/超边数 | ~500 | 轻松 |
| 成员关系数 | ~10,000 | 轻松 |
| "块属于哪些群" 查询 | < 1ms | ✅ |
| "群的交集成员" 查询 | < 5ms | ✅ |
| 递归层级查询 (CTE) | < 10ms | ✅ |
| 2跳间接关联查询 | < 20ms | ✅ |

**CozoDB 的判断**：
- 优势在查询表达力（Datalog 写递归和图遍历更优雅），不在原始性能
- 增加 ~2-3MB bundle size，额外的依赖和学习成本
- **结论：MVP 不引入，未来如果查询复杂度激增可作为升级选项**

### 3.3 每个用户 AV 数据库建一张 SQLite 表？

用户每创建一个 AV 数据库，插件在 SQLite 中建一张对应的"镜像同步表"来缓存 AV 数据加速查询。

**这是完全安全的做法：**
- SQLite 对表数量没有硬限制（理论上可以有数万张表）
- 每张表独立存储，不影响其他表的读写性能
- `sqlite_master` 的表元数据查询在几百张表内都是 O(1) 级别
- 个人用户不太可能创建超过 100 个 AV 数据库

**但有一个更好的做法值得考虑**：如果这些表结构相同（都是 AV 的列镜像），可以改用**单表 + source_av_id 列**的方案。这样 JOIN 查询和跨 AV 分析更方便，索引也更集中。分表和单表各有优劣，取决于查询模式：

| 方案 | 优势 | 劣势 |
|:---|:---|:---|
| 每 AV 一张表 | 单表查询更快、DROP TABLE 清理简便 | 跨 AV 查询需要 UNION ALL |
| 单表 + av_id 列 | 跨 AV 聚合查询天然支持 | 数据量大后需要复合索引 |

---

## 四、群、超边与四层架构的关系

### 4.1 两个子系统的独立与交汇

```
┌─────────────────────────────────────┐
│        行为子系统 (4-Layer)           │
│  "块能做什么"                        │
│                                     │
│  L1: 命令注册表  (代码内)             │
│  L2: 命令工厂    (Command-DB AV)     │
│  L3: 类注册表    (Type-DB AV)        │
│  L4: 数据库配置  (块属性 JSON)        │
│                                     │
│  索引：sys_command_db (SQLite)       │
│  索引：sys_type_db (SQLite)          │
└──────────┬──────────────────────────┘
           │
           │ 交汇点：
           │ • L3 用 AV 归属判定身份（替代 Tag）
           │ • 群成员身份影响 L3 的命令分发
           │ • L2 命令可操作群（create/add/remove）
           │
┌──────────▼──────────────────────────┐
│        关系子系统 (Cluster-HE)        │
│  "块和什么有关"                       │
│                                     │
│  群注册表   (N 个领域 AV)             │
│  成员关系   (AV Relation 列)         │
│  角色分配   (AV 角色列, 可选)         │
│  聚合统计   (Rollup + 命令触发)      │
│                                     │
│  索引：relation_group_membership     │
│        (SQLite, 统一反向索引)         │
└─────────────────────────────────────┘

共享存储：index-os.sqlite
  ├── sys_command_db       # 行为子系统
  ├── sys_type_db          # 行为子系统
  ├── relation_group_membership  # 关系子系统
  ├── av_mirror_*          # AV 镜像缓存（可选）
  └── ...
```

### 4.2 群命令在四层中的注册

```
L1 新增命令：
  ├── cluster.create        → 创建关系组
  ├── cluster.addMember     → 添加成员
  ├── cluster.removeMember  → 移除成员
  ├── cluster.queryBlock    → 查询块的所属群
  ├── cluster.aggregate     → 聚合统计
  ├── cluster.assignRole    → 分配角色（超边模式）
  └── cluster.visualize     → 可视化渲染

L2 命令变体：
  ├── "创建知识群"        (cluster.create, {type:"knowledge"})
  ├── "创建公式超边"      (cluster.create, {type:"formula", hyperedge:true})
  ├── "查看所属关系"      (cluster.queryBlock, {view:"panel"})
  ├── "羁绊统计"          (cluster.aggregate, {metric:"synergy"})
  └── "公式关系图"        (cluster.visualize, {filter:"formula"})

L3 类绑定：
  ClusterEntity:
    Identity: AV 归属 "群注册表"
    ContextMenu: [展开成员, 聚合统计, 编辑群, 可视化]
    Button: [添加成员]

  ClusterMember:
    Identity: 存在于 relation_group_membership 表中
    ContextMenu: [查看所属群, 添加到群, 退出群]
```

---

## 五、实施路线（修订版）

### Phase 0: 数据基础

| 任务 | 说明 |
|:---|:---|
| 设计 relation_group_membership SQLite 表 | 统一的反向索引 |
| AV 同步到 SQLite 的增量机制 | ws-main 监听 AV 变更 → 更新索引 |
| AV 模板生成器 | 一键创建标准列结构的"关系组 AV" |

### Phase 1: 群 (MVP)

| 任务 | 说明 |
|:---|:---|
| cluster.create 命令 | 多选块 → 创建群 → 写入 AV + SQLite |
| cluster.queryBlock 命令 | 右键 → "查看所属群" → 悬浮面板 |
| 纵向群自动生成 | 列表加入 AV 时 → 自动推导并写入层级群 |
| 群视图 (View 1) | AV 中的简洁群展示 |

### Phase 2: 超边扩展

| 任务 | 说明 |
|:---|:---|
| 角色列支持 | AV 中添加 Relation 类型的角色列 |
| 关系视图 (View 2) | 切换到带角色槽位的完整关系展示 |
| 关系打结器 UI | 多选块 → 拖拽分配到角色槽位 |
| cluster.assignRole 命令 | 给已有群成员分配/修改角色 |

### Phase 3: 聚合与游戏化

| 任务 | 说明 |
|:---|:---|
| cluster.aggregate 命令 | 基础统计（count, 完成率） |
| 阈值触发系统 | 达到 N 个成员满足条件 → 触发奖励/状态变更 |
| 反向查询引擎 (Context Pane) | 悬浮时自动展示块的所有群/超边关系 |
| 全景图渲染 | G6/ECharts 可视化群网络拓扑 |

---

*Last Updated: 2026-04-13*
