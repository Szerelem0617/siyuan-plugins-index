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
        AV_Views["Command-DB / Supertag-DB\n(统一 TabBar 编辑弹窗)"]
    end

    subgraph Dispatcher_Layer ["⚡ 调度与上下文引擎 (Command Dispatcher)"]
        ContextBuilder["Dual-Track Context 构建器\n(物理几何轨 geometry + 逻辑数据轨 vars)"]
        ParamResolver["多层参数解析器\nLayer 3 (显式) ➔ Layer 2 (DB绑定) ➔ Layer 1 (Schema默认)"]
        TemplateEngine["模板求值引擎\n({{date}}, {{time}}, {{cycle}}, {{prompt}}, {{var.x}})"]
        ExecProtocol["协议分发中枢\n(API, Custom Executor, Keyboard, Global)"]
    end

    subgraph Pipeline_Layer ["🧩 复合命令编排引擎 (Workflow Pipeline)"]
        RuleEngine["沙箱规则执行器\n(runRuleScript)"]
        StepSchema["步骤 Schema 与 IO 映射探测\n(StepSchemaItem)"]
        DataPool["平坦变量池 state.vars\n(规范 key + 别名映射)"]
    end

    subgraph Supertag_Layer ["🏷️ 超级标签与响应式触发 (Supertag & Reactive)"]
        DiffEngine["标签 Diff 引擎\n(custom-supertags 增量比对)"]
        TriggerEngine["条件触发执行器\n(tag_created / tag_removed / block_change)"]
        DOMRenderer["SupertagRenderer\n(零延迟 DOM 胶囊药丸与任务挂载)"]
    end

    subgraph State_Layer ["🗄️ 单一真理源状态机与数据库 (State & Storage)"]
        direction TB
        StateCheck{"系统是否已实例化？\n(检测两张系统 AV 物理属性)"}
        SeedConst["未实例化：只读种子常量\n(seed-data.ts)"]
        SiYuanAV["已实例化：思源原生 AV 数据库\n(Command-DB & Supertag-DB)"]
        SQLiteMirror["SQLite 内存镜像缓存\n(sys_registry_db & av_xxx)"]
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
    TriggerEngine --> StateCheck

    StateCheck -->|否| SeedConst
    StateCheck -->|是| SiYuanAV
    SiYuanAV <-->|双向同步| SQLiteMirror
    SeedConst --> TriggerEngine
    SiYuanAV --> TriggerEngine
```

---

## 2. 状态机：数据源单一真理源 (Single Source of Truth)

```mermaid
stateDiagram-v2
    [*] --> 未实例化: 检测不到 custom-index-command-db 或 custom-index-supertag-db
    未实例化 --> 已实例化: 用户点击“将数据存到思源”（一次物化建库）
    已实例化 --> 未实例化: 用户删除系统库文档（属性物理消失）
    
    state 未实例化 {
        [*] --> 读种子常量
        读种子常量: 数据源 = seed-data.ts (只读)
        读种子常量: 种子常量禁止在运行时被修改
    }
    
    state 已实例化 {
        [*] --> 读思源AV
        读思源AV: 数据源 = 思源原生 AV 表 (唯一真理源)
        读思源AV: 种子常量不再参与任何运行时判定与回退
    }
```

### 状态机准则：
1. **状态判定只看思源可观察事实**：能够同时定位到绑定 `custom-index-command-db` 和 `custom-index-supertag-db` 属性的 Attribute View 实体。
2. **严禁多层回退 (No Fallbacks)**：已实例化后，思源 AV 为唯一真理源，代码中严禁写入 `|| 种子数据` 的兜底链条，确保问题立即白盒暴露。
3. **状态刷新中枢**：集中于 `src/features/command/utils/sync-service.ts`。

---

## 3. 四层架构分层模型 (Four-Tier Hierarchy)

| 层级 | 实体与定义 | 未实例化 | 已实例化 |
|---|---|---|---|
| **Layer 1: 命令定义** | `CommandDef`（ID、参数规范、底层执行协议、目标作用域） | 内置 `builtin/*.json` 为源；内存注册表 `commandRegistry` 持有 Executor | 同左（`sys_registry_db` 仅为 SQL 查询镜像） |
| **Layer 2: 命令分身编排** | `CommandBinding`（Command-DB 行，定义具体分身的默认入参 `Input` 与出参重命名 `Output`） | 读 `seed-data.ts` 常量 | 读思源 `command-db` AV 表 |
| **Layer 3: Supertag 绑定** | `SupertagCommand`（Supertag-DB 行，定义标签关联的菜单按钮 `Icon Menu` 与条件触发脚本 `Conditional`） | 读 `seed-data.ts` 常量 | 读思源 `supertag-db` AV 表 |
| **Layer 4: 业务组件数据** | 每个超级标签对应的数据组件与自定义列（如 Project, Task, Resource 属性集） | 不存在 | 动态挂载于 `/data-dbs` 页面与关联 AV 表中 |

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
- **超级标签与条件触发**：`src/features/command/supertag/` (`core/`, `renderer/`, `manager/`, `suggestion/`)
- **属性视图与配置弹窗**：`src/features/command/av-interaction/` (`command-db-handler.ts`, `type-db-handler.ts`, `dialogs/`)
- **入口注册与菜单挂载**：`src/features/command/global-registration/` 与 `src/features/command/menu-hooks.ts`
- **后台调度与通用工具**：`src/features/command/background/` 与 `src/features/command/utils/`
- **初始化与存储管理**：`src/features/command/instantiate-storage.ts`, `registration.ts`, `data-db-management.ts`, `src/features/command/indexos/`
