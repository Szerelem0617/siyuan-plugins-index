# IndexOS 四层架构设计文档

> 本文档是 IndexOS 命令与类型系统的架构设计总纲，覆盖 Layer 1 ~ Layer 4 的职责划分、数据结构、运行时解析流程，以及对当前设计的批判性审视。

---

## 一、ECS 设计哲学

IndexOS 将思源笔记的块系统映射为 **ECS (Entity Component System)** 模型：

| ECS 概念 | 思源映射 | 说明 |
|:---|:---|:---|
| **Entity** | 块 (Block) | 思源中的任意内容块，拥有唯一 `data-node-id` |
| **Component** | 标签 (Tag) | 附加在块上的标签，可以是纯数据组件、纯工具组件、或混合型 |
| **System** | Layer 2 + 3 + 4 | 命令调度、类映射、数据同步三位一体 |

### 组件类型分类

| 组件类型 | 描述 | 举例 |
|:---|:---|:---|
| **数据组件** | 只定义数据结构（AV 列），不挂命令 | `#Book` (作者、ISBN、评分) |
| **工具组件** | 只挂命令，不关联数据库 | `#Review` (发起复习、导出闪卡) |
| **混合组件** | 既有数据库又挂命令 | `#Project` (截止日期 + 归档 + 生成报告) |

### 组合后的交互模式

- **数据 + 异名工具**：`#Book` + `#Timeline` → Timeline 工具从 Book 数据库读取日期列
- **多数据 + 一工具**：`#Daily` / `#Workout` / `#Reading` + `#Tracker` → Tracker 通用读取 count 字段
- **一数据 + 多工具**：`#Server` + `#Ping` / `#SSH` / `#Backup` → Server 数据被多个工具操作

---

## 二、四层架构总览

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: 命令注册表 (Command Registry)                   │
│  commands.json + commandRegistry 单例                     │
│  "底层命令的元定义 — 怎么调度、参数 schema 是什么"            │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 命令工厂 (Command-DB)                           │
│  思源 AV 数据库，用户可编辑                                  │
│  "命令变体的完整配置 + 全局调用方式（TopBar/Slash/Palette）"  │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 类注册表 (Type-DB)                              │
│  思源 AV 数据库，用户可编辑                                  │
│  "类的完整定义 + 块级调用方式（右键/Button/OnCreate）"        │
├─────────────────────────────────────────────────────────┤
│  Layer 4: 数据库配置 (DB Config)                           │
│  块属性 JSON (custom-index-db-config)                     │
│  "AV 列映射、值继承规则、语义别名"                            │
└─────────────────────────────────────────────────────────┘
```

### 各层职责一句话定义

| Layer | 回答的问题 | 数据载体 |
|:---|:---|:---|
| L1 | **"这个底层命令怎么调度？"** | `commands.json` (代码内) |
| L2 | **"这个命令变体配什么参？在哪全局可用？"** | Command-DB (AV) |
| L3 | **"这个类绑什么命令？在块上怎么触发？"** | Type-DB (AV) |
| L4 | **"这个数据库的列怎么映射？值怎么继承？"** | 块属性 JSON |

---

## 三、Layer 2 详细设计：命令工厂 + 全局调用

### 核心原则
> 一条 L2 记录 = 一个**完全配置好、可直接 dispatch 的命令模板**。
> 相同底层命令的不同参数配置 = 不同的命令变体（不同行）。

### 表结构

| 列名 | 类型 | 说明 |
|:---|:---|:---|
| **命令变体名** (主键) | text (block) | 显示名，如"归档-项目完成" |
| **Command ID** | text | 引用 L1 注册表的命令 ID |
| **Param** | text | 完整的参数 JSON，支持 `{{prop:xxx}}` 语义占位 |
| **Override Group** | text | 同族变体标识（如"archive"），用于继承时覆盖 |
| **Type** | text | Native / API / Custom |
| **Scope** | text | Global / Self / Sibling / Parent |
| **Enable** | checkbox | 是否启用 |
| **Top Bar** | checkbox | 是否注册到顶栏按钮 |
| **Slash** | checkbox | 是否注册为 Slash 命令 |
| **Palette** | checkbox | 是否注册到命令面板 (;;) |

### 全局 vs 块级调用的分界

| 调用方式 | 需要块上下文？ | 归属层 |
|:---|:---|:---|
| Top Bar | ❌ | **L2** |
| Slash 命令 | ❌ | **L2** |
| Command Palette (;;) | ❌ | **L2** |
| Context Menu (右键) | ✅ | **L3** |
| Inline Button | ✅ | **L3** |
| On Create | ✅ | **L3** |
| On Remove | ✅ | **L3** |

**设计理由**：全局调用方式不关心块的类型/标签，天然属于命令自身的属性；块级调用方式取决于"块是什么类"，属于类的定义。

---

## 四、Layer 3 详细设计：类注册表 + 块级调用

### 核心原则
> 一条 L3 记录 = 一个**类的完整定义**。
> 主键是类名，唯一；调用方式做列名，命令名做值。

### 表结构

| 列名 | 类型 | 说明 |
|:---|:---|:---|
| **Class Name** (主键) | text (block) | 类名，如 `Project` |
| **Extends** | text | 父类名，如 `Entity`（支持继承链） |
| **Context Menu** | mSelect/text | 右键菜单中出现的命令列表（引用 L2 变体名） |
| **Button** | mSelect/text | 块内自动渲染的按钮列表 |
| **On Create** | mSelect/text | 打标签时自动执行的命令列表 |
| **Data Sources** | text | 关联的 AV 数据库 ID/名称（桥接 L4） |
| **Icon** | text | 类的图标/emoji |
| **Enable** | checkbox | 是否启用 |

### 继承合并规则

```
用户右键 #Project 块 → 合并 Context Menu 列：
  Project.ContextMenu = [归档-项目完成, 生成报告]
  Entity.ContextMenu  = [复制块引用, 归档-通用]

合并逻辑：
  1. 收集子类自有命令：[归档-项目完成, 生成报告]
  2. 收集父类命令：[复制块引用, 归档-通用]
  3. Override Group 冲突检查：
     - "归档-项目完成" (group=archive) vs "归档-通用" (group=archive)
     → 子类覆盖父类
  4. 最终结果：[复制块引用, 归档-项目完成, 生成报告]
```

### Layer 3 的三层职责

1. **结构定义**（类是什么）：Class Name / Extends / Icon / Data Sources
2. **行为装配**（类能做什么）：Context Menu / Button
3. **生命周期**（类什么时候自动做什么）：On Create / On Remove

---

## 五、Layer 4 详细设计：数据库配置

### 现有实现
- 存储在块属性 `custom-index-db-config` 中的 JSON
- 管理 AV 数据库的类型映射（typeMappings）、值继承规则（inheritanceRules）
- 支持 single 模式（一库一类）和 multi 模式（一库多类，通过分类列区分）

### 与 Layer 3 的桥接
- L3 的 `Data Sources` 列指向 L4 管理的 AV 数据库
- L3 的 `On Create` 命令可以触发"加入到 AV 数据库"的操作
- L4 的 `TypeConfig` 提供属性查找能力，供 L2 命令的参数解析使用

### 多数据库支持（规划中）
一个块打多个标签时，可能映射到多个 AV 数据库。L4 需支持全量同步而非择一同步。

---

## 六、运行时解析流程

### 场景 A：全局调用（Top Bar 按钮被点击）

```
1. 用户点击顶栏按钮 "全局关系图"
2. top-bar.ts 查找 L2 记录 → 取得 Command ID = "general.graphView", Param = ""
3. 调用 dispatchCommand("general.graphView", "", mockContext)
4. Dispatcher 在 L1 registry 查到 dispatch.method = "global", target = "graphView"
5. 执行 globalCommand("graphView")
```

### 场景 B：块级调用（右键菜单）

```
1. 用户右键 #Project 块
2. registration.ts 提取块上所有标签 → ["project"]
3. 查 L3 Type-DB → Class "Project", ContextMenu = ["归档-项目完成", "生成报告"]
4. 查 L3 继承链 → Extends = "Entity", Entity.ContextMenu = ["复制块引用", "归档-通用"]
5. 合并（Override Group 冲突解决）→ [复制块引用, 归档-项目完成, 生成报告]
6. 对每个命令名查 L2 → 取得完整 Command ID + Param
7. 渲染右键菜单
8. 用户点击 "归档-项目完成"
9. 查 L2 → Command ID = "api.attr.setBlockAttrs", Param = {status:"completed"}
10. dispatchCommand(...) → L1 registry → dispatch via API
```

### 场景 C：自动触发（On Create）

```
1. 用户给块打上 #Project 标签
2. supertag.ts 的 ws-main 监听捕获 tag 变更
3. 查 L3 → Class "Project", OnCreate = ["加入项目库"]
4. 查 L2 → "加入项目库" = Command ID "custom.addToAV", Param = {avId:"av-xxx"}
5. dispatchCommand(...) → 自动将块加入目标 AV 数据库
```

---

## 七、批判性审视 (Critical Analysis)

### 问题 1：L2 命令变体膨胀

**风险**：如果有 10 个底层命令 × 5 个参数变体 = 50 行。随着类和场景增多，L2 行数可能快速膨胀到上百条，用户在一张大表中管理会变困难。

**建议**：
- 利用 AV 的 **Group By Override Group** 视图，把同族变体折叠在一起
- 考虑引入"模板变体"概念：`Param = {status: "{{input}}"}` → 只需一行 + 运行时弹窗填值，减少变体数量
- 对 `interactive` paramMode 做好 UI 支持，让用户能在执行时动态填参，而不是预先创建大量静态变体

### 问题 2：L2 和 L1 的关系可能令用户困惑

**风险**：用户看到 L2 的 "Command ID" 列引用了 L1 中的 ID（如 `api.attr.setBlockAttrs`），但 L1 对用户是不可见的（它是代码里的 `commands.json`）。用户怎么知道有哪些 Command ID 可以填？

**建议**：
- L2 的 Command ID 列应做成 **下拉选择**（从 `commandRegistry.getAllCommands()` 动态生成选项），而非让用户手动输入
- 或提供"命令浏览器"的辅助工具——现有的 `command-palette.ts` 可以扩展为此功能
- 最终目标：**用户永远不需要知道 L1 的存在**，L1 是开发者层

### 问题 3：L3 的 mSelect 列在思源 AV 中的数据一致性

**风险**：L3 的 `Context Menu`、`Button`、`On Create` 列的值应当与 L2 的命令变体名严格一致。但思源 AV 的 mSelect 列允许用户自由输入任意文本。如果用户在 L3 填了一个 L2 里不存在的命令名，就会静默失败。

**建议**：
- 运行时做**验证扫描**：`refreshSupertagRegistry()` 时对每个 L3 引用的命令名检查 L2 是否存在，不存在则打印警告
- 未来考虑用 AV 的 **Relation 列类型**替代 mSelect，将 L3 的命令列直接关联（Relation）到 L2 的行，由思源原生保证引用完整性
- 如果 Relation 列不支持所需的灵活性，则在代码侧做兜底：找不到精确匹配时尝试模糊匹配（类似现有 `findByNameOrId`）

### 问题 4：继承深度与性能

**风险**：如果继承链很深（A → B → C → D → E），运行时需要递归查询 L3 的 5 行并逐层合并。目前 L3 数据存储在思源 AV 中，每次查询需要调用 `renderAttributeView` API，5 层 = 5 次 API 调用。

**建议**：
- 插件启动时一次性加载全部 L3 数据到内存，构建 `Map<className, ClassDef>` 和预计算的继承合并结果
- 运行时查询 = 内存 O(1)，只在 L3 数据变更时刷新缓存
- 现有的 `SUPERTAG_REGISTRY` 缓存模式可以直接复用

### 问题 5：Override Group 的匹配歧义

**风险**：两个命令变体可能 Command ID 不同但语义上互斥。例如"设置状态-API版" (api.attr.setBlockAttrs) 和"设置状态-键盘版" (editor.xxx)，它们应该互相覆盖，但 Command ID 不同无法自动判定。

**建议**：
- Override Group 是正确的解法——**必须由用户显式标注哪些命令互斥**
- 如果用户不填 Override Group，则默认不覆盖（安全侧）
- 文档/tooltip 中明确说明：同一个 Override Group 的命令，子类只会保留最近一个

### 问题 6：On Create 的幂等性

**风险**：如果用户删除标签后重新添加，或思源同步导致重复的 ws-main 事件，On Create 命令可能被重复执行。对于 "加入 AV 数据库" 这种操作，重复执行会导致重复行或错误。

**建议**：
- 现有 `supertag.ts` 的 `applySupertag` 已有幂等检查（检查 blockToItem 是否已存在）——确保所有 On Create 命令都遵循这个模式
- 引入 **命令级别的幂等标记**：在 L1 的 `CommandConstraints` 中增加 `idempotent: boolean` 字段
- 非幂等命令在 On Create 场景下应额外确认

### 问题 7：跨层属性解析的复杂度

**风险**：当 L2 的 Param 中使用 `{{prop:DueDate}}` 这种语义占位符时，解析链路变长：L2 Param → L3 Data Sources → L4 DB Config → AV 列查找。任何一环出错都可能导致参数为空。

**建议**：
- 分阶段实现：首先支持直接的静态参数和 `{{block_id}}` 类模板变量（已有）
- `{{prop:xxx}}` 作为第二阶段特性，并提供清晰的错误提示："属性 DueDate 在块 xxx 的关联数据库中未找到"
- 考虑提供一个 **"Dry Run / 调试模式"**：执行前展示参数解析过程，不实际执行

---

## 八、与旧架构的对比

| 维度 | 旧架构 | 新架构 |
|:---|:---|:---|
| **L2 职责** | 命令定义 + 参数（部分） + 全局 UI | 命令变体完整配置 + 全局调用方式 |
| **L3 主键** | 标签名（重复出现） | 类名（唯一） |
| **L3 每行含义** | 一个绑定关系 (tag × method) | 一个类的完整定义 |
| **L3 行数** | N类 × M命令 = NM 行 | N 行 |
| **参数来源** | 分散在 L2 和 L3 | 统一在 L2 |
| **继承** | 无法实现 | Extends 列 + Override Group 覆盖 |
| **全局/块级调用** | 混在一起 | 全局→L2, 块级→L3, 职责清晰 |
| **数据库关联** | L3 无此概念 | L3 通过 Data Sources 桥接 L4 |

---

## 九、实施优先级建议

| 阶段 | 内容 | 改动量 |
|:---|:---|:---|
| **Phase 1** | 重构 L3 表结构（主键改为类名，增加 Extends/ContextMenu/Button/OnCreate 列） | 中 |
| **Phase 2** | L2 增加 Override Group 列，去掉旧 L3 的 Param Mapping | 小 |
| **Phase 3** | 代码层实现继承合并逻辑 + 内存缓存 | 中 |
| **Phase 4** | 实现 `{{prop:xxx}}` 语义参数解析 | 大 |
| **Phase 5** | L2 Command ID 列改为下拉选择 + 验证扫描 | 小 |

---

*Last Updated: 2026-04-01*
