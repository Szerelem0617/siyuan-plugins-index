# Supertag 体系深度调研报告

## 一、当前架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    SupertagMonitor                       │
│  WebSocket ← transactions → extractTags → processNewTag │
│                      ↓              ↓                    │
│              ┌──────────────┐  ┌──────────────┐          │
│              │ Path A: 逻辑  │  │ Path B: 数据  │          │
│              │ SUPERTAG_     │  │ dataRegistry │          │
│              │ REGISTRY      │  │ (TypeConfig) │          │
│              └──────┬───────┘  └──────┬───────┘          │
│                     │                 │                   │
│         refreshSupertagRegistry  getGlobalTypeConfigs    │
│              ↓           ↓            ↓                   │
│     ┌────────────┐ ┌──────────┐ ┌──────────────┐         │
│     │ Layer 2    │ │ Layer 3  │ │ Layer 4      │         │
│     │ Command-DB │ │ Type-DB  │ │ 各 AV 的 IAL │         │
│     │ (AV 文档)  │ │ (AV 文档)│ │ db-config    │         │
│     └────────────┘ └──────────┘ └──────────────┘         │
└─────────────────────────────────────────────────────────┘
```

---

## 二、数据组件的获取机制

**入口**: `getGlobalTypeConfigs()` → [db-config.ts:195](../src/features/data/av-setting/db-config.ts)

**获取流程**:
1. SQL 全表扫描: `SELECT id, name, content, ial FROM blocks WHERE ial LIKE '%custom-index-db-config="%'`
2. 从每个块的 IAL 中正则提取 `custom-index-db-config` 的 JSON 值
3. 反序列化为 `DbConfig`，按 mode 分支:
   - **Single Mode**: `singleClassName` → 一个标签名对应一个 AV
   - **Multi Mode**: `typeMappings[]` → 多个标签名通过 `typeFieldId` 列的不同值，分流到同一个 AV
4. 对无名称的 AV 调用 `/api/av/renderAttributeView` 懒加载名称，结果缓存在 `avNameCache`

**特征**: 
- ✅ **完全去中心化** — 不依赖任何"系统文档"，每个 AV 块自带配置
- ✅ **始终可用** — 与 `DEV_ENABLE_INIT_SYS` 无关
- ❌ **全表扫描** — 每次调用都遍历整个工作区

---

## 三、工具组件的获取机制

**入口**: `refreshSupertagRegistry()` → [registration.ts:157](../src/features/command/registration.ts)

**获取流程** (当前生产环境 `DEV_ENABLE_INIT_SYS = false`):
```
refreshSupertagRegistry()
  └─ if DEV_ENABLE_INIT_SYS → SQLite 路径 (跳过)
  └─ else → refreshRegistryFromApi()
               ├─ 1. 查找 Command-DB 文档 (WHERE name = 'custom-index-command-db')
               │     └─ 读取列表块的 custom-index-linked-av → commandAvId
               │     └─ renderAttributeView → 解析行 → COMMAND_REGISTRY
               └─ 2. 查找 Type-DB 文档 (WHERE name = 'custom-index-type-db')
                     └─ 读取列表块的 custom-index-linked-av → typeAvId
                     └─ renderAttributeView → 解析行 → SUPERTAG_REGISTRY
```

**关键细节**:
- 用 `cmdByRowId[row.id]` 做跨表关联：Type-DB 的"绑定命令"关系列引用 Command-DB 的行 ID
- 支持两种绑定方式：
  - **关系列** (`绑定命令`): 新版，用 AV 原生的关系类型列直接引用
  - **文本列** (`Block Icon Menu` / `Current Page Menu`): 旧版，逗号分隔的命令名模糊匹配

**特征**:
- ✅ **不需要 SQLite 实例化** — 纯 HTTP API 即可工作
- ❌ **依赖两个"系统文档"存在** — 文档不存在则 SUPERTAG_REGISTRY 为空
- ❌ **非增量** — 每次全量重建

---

## 四、实时响应性分析

### 当前刷新触发点

| 触发时机 | 刷新内容 | 代码位置 |
|---------|---------|---------|
| 插件 `onload` | Layer 2/3 | `index.ts:52` (仅 DEV 模式) |
| `SupertagMonitor.init()` | Layer 2/3 + Layer 4 | `supertag.ts:46` |
| `processNewTag` 中缓存超时 (5min) | Layer 2/3 + Layer 4 | `supertag.ts:198` |
| GUI 面板操作后派发事件 | Layer 2/3 + Layer 4 | `window "index-plugin-refresh-supertags"` |
| CommandsPanel 增删改 | Layer 2/3 | `CommandsPanel.svelte:63,81,95,161` |
| TopBar 面板操作 | Layer 2/3 | `top-bar.ts:300` |

### 不会触发刷新的场景

| 场景 | 后果 |
|------|------|
| 用户在思源原生 AV 表格中直接编辑 Command-DB 或 Type-DB 的单元格 | 内存 REGISTRY 过期，直到 5 分钟超时或手动刷新 |
| 用户修改某个 AV 的 `custom-index-db-config` IAL | `dataRegistry` 过期 |
| 用户删除了 Command-DB 或 Type-DB 文档 | 下次刷新会静默失败，REGISTRY 清空 |

### 结论

**当前不是实时的。** 本质是一个 **"启动加载 + 5分钟超时被动刷新"** 模型。用户通过原生 AV 界面修改配置，需要等最多 5 分钟或重载插件才会生效。

---

## 五、各种场景适配分析

当前代码在以下场景下的行为:

### 场景矩阵

| 场景 | Command-DB | Type-DB | Layer 4 配置 | 当前行为 | 是否需要适配 |
|------|-----------|---------|-------------|---------|------------|
| A: 全功能 | ✅ 存在 | ✅ 存在 | ✅ 有 | 完整工作 | 否 |
| B: 纯数据 | ❌ | ❌ | ✅ 有 | 打标签→自动加库 ✅ 但无命令绑定 | **是** — 应明确告知用户 |
| C: 只有命令 | ✅ 存在 | ❌ | ❌ | `COMMAND_REGISTRY` 有值但 `SUPERTAG_REGISTRY` 为空，命令无法通过标签触发 | **是** — 命令仍可通过其他方式调用 |
| D: 只有类型 | ❌ | ✅ 存在 | ❌ | Type-DB 行可以解析但 `cmdByRowId` 为空，关系列解析不到命令 | **是** — 应警告用户缺少 Command-DB |
| E: 全空 | ❌ | ❌ | ❌ | 静默降级，所有 REGISTRY 为空 | 否 — 已正确处理 |
| F: 文档被删 | 曾有→被删 | 曾有→被删 | ✅ 有 | 下次刷新后 REGISTRY 清空，Layer 4 仍工作 | **是** — 应清理缓存的 avId |

### 关键问题

**场景 B 是当前最常见的生产场景**（因为 `DEV_ENABLE_INIT_SYS = false`）。用户只使用了"打标签自动加库"功能。这条路径完全独立于 Layer 2/3，不需要适配。

**场景 C/D 是切换到生产环境时的过渡问题**。当 `DEV_ENABLE_INIT_SYS` 打开后，如果用户只创建了其中一个系统文档，另一个缺失时应该:
1. 在刷新注册表时打印明确的 `console.warn` 
2. 在 Supertag Manager 弹窗中显示缺失提示
3. `refreshRegistryFromApi()` 不应在 Type-DB 缺失时提前 `return`（当前第 372 行会 return），应该仍然加载 Command-DB

### 建议的适配代码改动

```typescript
// registration.ts:refreshRegistryFromApi() 当前问题:
// 第 372 行: if (!existingDocs || existingDocs.length === 0) return;
// 这会导致如果 Type-DB 不存在，连已加载的 COMMAND_REGISTRY 也不会被保留
// 因为函数直接 return 了，但 COMMAND_REGISTRY 已经在上面被覆写

// 修复: 将 return 改为仅跳过 Layer 3 加载
if (!existingDocs || existingDocs.length === 0) {
    console.warn("[Supertag] Type-DB document not found. Commands loaded but no type bindings.");
    return; // COMMAND_REGISTRY 已经加载完毕，这里 return 是安全的
}
```

实际上审查后发现当前 `return` 是安全的：`COMMAND_REGISTRY` 在第 343 行已经被覆写完毕，第 372 行的 return 只是跳过 Type-DB 加载。**但 `SUPERTAG_REGISTRY` 没有被清空**（因为没执行到第 470 行），所以旧数据会残留。应该在 return 前加 `SUPERTAG_REGISTRY = [];`。

---

## 六、设计方案对比

### 方案 0：当前方案 — AV 文档链路模型

**核心思想**: 用两个专用的思源 AV 文档（Command-DB、Type-DB）作为逻辑配置的存储介质，用各 AV 块的 IAL 属性作为数据配置的存储介质。

**优点**:
- 用户可以直接在思源的表格界面中编辑配置，所见即所得
- 关系列天然支持跨表引用（Type-DB 引用 Command-DB 的行）
- 与思源的 AV 生态完全一致

**缺点**:
- 依赖特定"系统文档"的存在，增加了故障点
- 全量刷新，无增量更新
- 数据配置（IAL）和逻辑配置（AV 文档）在两个完全不同的存储层，概念不统一
- 修改后非实时

---

### 方案 A：ECS 混入式

**核心思想**: 放弃 AV 数据库，标签本身携带所有元数据（通过 Kramdown 自定义属性）。

```markdown
{: custom-supertag-project="true" custom-st-status="active" custom-st-cmd="duplicate,moveUp" }
```

**优点**: 极轻量，零依赖
**缺点**: 失去表格管理能力，属性键名管理混乱，无法批量查看筛选

**评价**: ❌ 不推荐。放弃了思源最强大的 AV 能力。

---

### 方案 B：DSL 文档脚本式

**核心思想**: 在代码块中写 JS/DSL，打标签时解释执行。

**优点**: 灵活性无上限
**缺点**: 安全风险、学习成本极高、调试困难

**评价**: ❌ 不推荐。把配置问题变成了编程问题，用户群错配。

---

### 方案 C（新提案）：去中心化 IAL 统一配置模型

**核心思想**: 消除 Command-DB 和 Type-DB 两个"系统文档"，将**所有配置都下沉到各 AV 块自身的 IAL 属性中**。

```
当前 Layer 4 已有:
  custom-index-db-config = {"avId":"...", "mode":"single", "singleClassName":"project"}

扩展为:
  custom-index-db-config = {
    "avId": "...",
    "mode": "single",
    "singleClassName": "project",
    "bindings": [                          ← 新增: 直接在 AV 上声明方法绑定
      { "commandId": "editor.general.duplicate", "ui": "BlockIconMenu" },
      { "commandId": "api.block.insertBlock", "ui": "PageMenu", "params": {"data": "{{date}}"} }
    ]
  }
```

**获取流程变为**:
```
getGlobalTypeConfigs()  ← 已有的全表扫描，一次性拿到所有 AV 的配置
  └─ 同时提取 typeName（数据组件）和 bindings（工具组件）
  └─ 不再需要单独的 refreshSupertagRegistry()
```

**优点**:
- ✅ **零系统文档依赖** — 不需要 Command-DB / Type-DB 文档存在
- ✅ **配置与数据共生** — 绑定关系直接声明在数据所在的 AV 上，概念清晰
- ✅ **一次扫描，全量获得** — 消除了数据组件和工具组件两条独立的获取路径
- ✅ **天然场景适配** — 场景 B/C/D/F 的问题全部消失，因为没有"系统文档"可以缺失
- ✅ **增量感知成本低** — 只需监听 `setAttrs` 事件中含 `custom-index-db-config` 的变更

**缺点**:
- ❌ **无法跨 AV 共享命令定义** — 每个 AV 独立声明绑定，不能像 Type-DB 那样一处修改全局生效
- ❌ **IAL 属性体积膨胀** — bindings 数组可能很长
- ❌ **Layer 1 内置命令仍需要另外的注册机制** — commands.json 不受影响
- ❌ **需要迁移现有用户的配置**

**评价**: ⭐ 值得考虑，适合"每个数据库独立管理自己的行为"的使用模式。

---

### 📊 四方案全维度对比

| 维度 | 方案 0 (当前 AV 文档) | 方案 A (ECS) | 方案 B (DSL) | **方案 C (IAL 统一)** |
|------|---------------------|-------------|-------------|---------------------|
| 系统文档依赖 | 2 个专用文档 | 无 | 无 | **无** |
| 用户配置方式 | AV 表格编辑 | 属性面板手写 | 代码块编程 | **AV 配置弹窗** |
| 上手门槛 | 低 | 中 | 高 | **低** |
| 思源 AV 利用度 | 高 | 无 | 无 | **高** |
| 跨 AV 命令复用 | ✅ 通过 Type-DB | ❌ | ✅ 脚本引用 | **❌ 需逐 AV 声明** |
| 配置实时性 | 5 分钟/手动刷新 | 即时 (IAL) | 即时 (解释执行) | **即时 (IAL 事件)** |
| 扩展上限 | 高 | 低 | 极高 | **中高** |
| 全局一致性 | ✅ 单一数据源 | ❌ 分散 | ❌ 分散 | **❌ 分散** |
| 场景适配覆盖 | 需额外处理 C/D/F | 全覆盖 | 全覆盖 | **全覆盖** |

---

## 七、推荐方案

### 短期推荐（v1.10.x）：**优化方案 0**

不做架构切换，而是修补当前方案的三个痛点:

1. **修复场景 C/D 降级**: `refreshRegistryFromApi` 中 Type-DB 不存在时清空 `SUPERTAG_REGISTRY` 而非残留旧数据
2. **添加 WebSocket 核心配置监听**: 在 `handleWsMessage` 中检测 `commandAvId`/`typeAvId` 的事务变更，防抖触发 `refreshSupertagRegistry()`
3. **Supertag Manager 弹窗增加缺失提示**: 当 Command-DB 或 Type-DB 不存在时，显示引导提示而非空白

### 中期推荐（v2.x）：**方案 0 + 方案 C 混合**

保留 Command-DB 作为"全局命令目录"（因为命令定义确实是全局资源），但将 Type-DB 的功能下沉到各 AV 的 IAL 中:

```
Layer 1: commands.json (内置原子命令)     ← 不变
Layer 2: Command-DB (全局命令定义表)      ← 保留，但改用 commandRegistry 统一管理
Layer 3: 删除 Type-DB 文档               ← 绑定关系迁移到各 AV 的 db-config 中
Layer 4: AV IAL (数据 + 绑定关系)         ← 扩展 DbConfig 结构
```

这样既保留了命令定义的全局复用能力，又消除了 Type-DB 这个最脆弱的中间层。
