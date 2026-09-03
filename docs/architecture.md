# IndexOS 核心架构与系统数据流规范

> 本文档描述 `siyuan-plugins-index` 与 IndexOS 系统的完整架构规范、分层模型、数据流转与状态机。
> 维护约定：任何涉及状态机、数据源或命令调度的演进，必须同步更新本文档。

---

## 1. 系统全景架构图 (Mermaid Architecture)

```mermaid
flowchart TD
    %% 全局分层
    subgraph UI_Layer ["🖥️ 表现与交互层 (UI & Interaction)"]
        Palette["@ Supertag 快速面板\n;; 命令快速调色板"]
        Buttons["内嵌按钮 / 顶栏 / 底栏 / 侧栏"]
        MenuHooks["块图标 / 页面标题 / 文档树菜单"]
        Virtual_AV["业务数据虚拟投影 (Virtual AV)\n(流式真分页 LIMIT / OFFSET + 双向编辑)"]
        Config_Dialogs["Command-DB / Supertag-DB\n(统一配置面板，无需前置建库)"]
    end

    subgraph Dispatcher_Layer ["⚡ 调度与上下文引擎 (Command Dispatcher)"]
        ContextBuilder["Dual-Track Context 构建器\n(物理几何轨 geometry + 逻辑数据轨 vars)"]
        ParamResolver["多层参数解析器\nLayer 3 (显式) ➔ Layer 2 (DB绑定) ➔ Layer 1 (Schema默认)"]
        TemplateEngine["模板求值引擎\n({{date}}, {{time}}, {{cycle}}, {{prompt}}, {{var.x}})"]
        ExecProtocol["协议分发中枢\n(API, Custom Executor, Keyboard, Global)"]
    end

    subgraph Pipeline_Layer ["🧩 复合命令编排引擎 (Composite Command Engine)"]
        RuleEngine["沙箱规则执行器\n(runRuleScript)"]
        StepSchema["步骤 Schema 与 IO 映射探测\n(StepSchemaItem)"]
        DataPool["平坦变量池 state.vars\n(规范 key + 别名映射)"]
    end

    subgraph Supertag_Layer ["🏷️ 超级标签与响应式触发 (Supertag & Reactive)"]
        DiffEngine["标签 Diff 引擎\n(custom-supertags 增量比对)"]
        TriggerEngine["条件触发执行器\n(tag_created / tag_removed / block_change)"]
        DOMRenderer["SupertagRenderer\n(零延迟 DOM 胶囊药丸与任务挂载)"]
    end

    subgraph Core_Contracts ["📐 DIP 契约抽象层 (Core Contracts)"]
        ISqlStorageDriver["ISqlStorageDriver\n(SQL 存储驱动抽象)"]
        IPlatformHost["IPlatformHost\n(宿主环境几何与交互适配)"]
        IVirtualAvDriver["IVirtualAvDriver\n(流式虚拟多维表格驱动)"]
    end

    subgraph State_Layer ["🗄️ SQL-First 单一真理源与存储底座 (State & Storage)"]
        direction TB
        SQLiteEngine["本地内存 SQLite 引擎 (sql.js)\n系统元表: command-db / supertag-db / sys_registry_db\n业务热表: proj_xxx (流式分页缓存)"]
        StorageJSON["插件私有存储 indexos-meta.json\n(元数据原子持久化，无需物理页面污染)"]
        BlockIAL["块属性物理分布式底座 (custom-* IAL)\n(思源 attributes 表高并发索引，万级抗压)"]
    end

    %% 交互连线
    UI_Layer --> ContextBuilder
    ContextBuilder --> ParamResolver
    ParamResolver --> TemplateEngine
    TemplateEngine --> ExecProtocol

    ExecProtocol -->|调用 Pipeline| RuleEngine
    RuleEngine --> StepSchema
    StepSchema --> DataPool
    DataPool -->|链式分发| ExecProtocol

    DOMRenderer -.->|属性变动| DiffEngine
    DiffEngine -->|广播事件| TriggerEngine
    TriggerEngine --> SQLiteEngine

    Config_Dialogs <-->|读写系统元表| SQLiteEngine
    SQLiteEngine <-->|自动落盘/冷启恢复| StorageJSON
    Virtual_AV <-->|流式分页拦截| SQLiteEngine
    SQLiteEngine <-->|双向同步单元格| BlockIAL
```

---

## 2. 状态机：SQL-First 单一真理源与持久化规范

```mermaid
stateDiagram-v2
    [*] --> SQLite内存核心启动: 插件加载
    SQLite内存核心启动 --> 载入私有存储: 检查 indexos-meta.json
    载入私有存储 --> 系统就绪: 恢复用户历史命令与标签规则
    载入私有存储 --> 预装种子常量: 无存储文件时加载 seed-data.ts
    预装种子常量 --> 系统就绪
    
    state 系统就绪 {
        [*] --> 运行中
        运行中: SQLite 内存系统表为全系统单一真理源
        运行中: 任何配置变更即时写回 SQLite 并原子保存至 indexos-meta.json
        运行中: 业务数据分散存于块属性 (IAL)，虚拟 AV 实时分页查询
    }
```

### 核心准则：
1. **纯净内核，拒绝正文元表污染**：系统核心元表（`command-db` 与 `supertag-db`）彻底移出思源正文，不再在用户的笔记本中强制生成物理 AV 页面，避免数据脆弱性与正文污染。
2. **即开即用与单一真理源**：无论用户是否在思源中建库，内存 SQLite 始终为系统唯一有效真理源。用户在配置面板中添加自定义命令、配置标签规则，立即可用且自动持久化至 `indexos-meta.json`。
3. **物理底座与展示分离 (DIP)**：
   - **物理持久化**：业务数据纯走块属性（`custom-supertags` 与 `custom-${tag}-${field}`），利用思源底层 SQLite `attributes` 表的高效索引，杜绝大 JSON 卡死；
   - **逻辑处理**：本地 SQLite 内存表；
   - **展示交互**：空 AV 壳子拦截渲染，服务端真流式分页（`LIMIT :pageSize OFFSET :offset`）。

---

## 3. 四层架构分层模型 (Four-Tier Hierarchy)

| 层级 | 实体与定义 | 物理真理源 | 逻辑与调度接入 |
|---|---|---|---|
| **Layer 1: 命令定义** | `CommandDef`（ID、参数规范、底层执行协议、目标作用域） | 内置 `builtin/*.json` + 插件注册 | 内存注册表 `commandRegistry` + `sys_registry_db` 表 |
| **Layer 2: 命令分身编排** | `CommandBinding`（Command-DB 行，定义具体分身的默认入参 `Input` 与出参重命名 `Output`） | 插件存储 `indexos-meta.json` | 内存 SQLite `command-db` 系统表 |
| **Layer 3: Supertag 绑定** | `SupertagCommand`（Supertag-DB 行，定义标签关联的菜单按钮 `Manual` 与自动化规则 `Auto`） | 插件存储 `indexos-meta.json` | 内存 SQLite `supertag-db` 系统表 |
| **Layer 4: 业务数据流** | 具有超级标签的实际笔记块及其业务字段（如 Task, Project, Book 属性） | 笔记物理块属性 (IAL) | `proj_${tag}` 虚拟投影表（流式真分页） |

---

## 4. 命令调度与参数流转规范 (Dataflow & Context)

### 4.1 双轨上下文 (Dual-Track Context)
每次命令触发，调度器统一构建双轨上下文：
- **空间物理轨 (Spatial Track)**：自动计算触发节点在视口中的绝对物理几何边界：
  `geometry: { x, y, width, height, centerX, centerY }`，供粒子特效、弹窗悬浮精确定位。
- **逻辑数据轨 (Logical Track)**：包含 `blockId`、`supertag`、`executionMode`（前台/后台）以及动态平坦变量池 `vars: Record<string, unknown>`。

### 4.2 参数解析优先级 (逐键覆盖)
1. **Layer 3 (显式客制化入参)**：调用方显式传入的参数（如 Pipeline 步骤中手动配置的参数或按钮 `?p={}` 参数）；
2. **Auto-Context (上下文自动感应)**：针对 `id` / `blockid` 参数，自动感应前置步骤产出的 Block ID 或当前上下文块 ID；
3. **Layer 2 (Command-DB 绑定默认值)**：数据库中配置的 `Input Mapping`；
4. **Layer 1 (Schema 注册默认值)**：命令元数据 `params[].default`。

### 4.3 纯粹 IO 规范 (Clean Separation of Concerns)
- **输入 (Input)**：由调用方或 Pipeline 统一入参池提供，命令**不回显**输入参数到变量池。
- **输出 (Output)**：命令仅产出真正执行产生的**事实结果**（如新创建的块 ID `createdblock`、API 返回的结构体数据），自动进入平坦变量池供后续步骤以 `{{var.xxx}}` 消费。

---

## 5. 核心模块与目录布局

- **注册表与内置定义**：`src/features/command/registry/` (`command-registry.ts`, `builtin/*.json`)
- **调度中枢与执行协议**：`src/features/command/dispatcher/` (`dispatcher-core.ts`, `param-resolver.ts`, `executors.ts`, `context-builder.ts`)
- **原子执行器**：`src/features/command/effect/` (`visual-effect.ts`, `safe-update-block.ts`, `insert-block-below.ts`, `set-block-attribute.ts`, `add-supertag.ts`, `open-target.ts`, `show-message.ts`)
- **复合命令编排引擎**：`src/features/command/pipeline/` (`engine.ts`, `manager.ts`, `script-dsl.ts`, `pipeline-step-schema.ts`, `PipelineEditorDialog.svelte`)
- **统一属性管理与超级标签 (Unified Attributes & Supertags)**：`src/features/unified-attributes/` (`core/`, `projection/`, `inspector/`, `manager/`, `renderer/`, `suggestion/`)
- **属性视图与配置弹窗**：`src/features/command/av-interaction/` (`command-db-handler.ts`, `type-db-handler.ts`, `dialogs/`)
- **入口注册与菜单挂载**：`src/features/command/global-registration/` 与 `src/features/command/menu-hooks.ts`
- **后台调度与通用工具**：`src/features/command/background/` 与 `src/features/command/utils/`
- **初始化与存储管理**：`src/features/command/indexos/` (`command-sqlite.ts`, `seed-data.ts`), `registration.ts`
