# 基于 ECS 与 Supertag 的类（Type）方法数据存储方案分析

在以 ECS（Entity-Component-System）为核心思路的架构下：
- **Entity（实体）**：被打上 Supertag 的普通思源 Block。
- **Component（组件/属性）**：挂载该 Block 的 Database（AV）中的各个属性列。
- **System（系统/方法）**：针对具有某些 Component 的 Entity 执行的特定操作（Command）。

由于一个 Block 可以打多个 Tag（多继承/多类共存），此 Block 就会同时存在于多个 AV 中，拥有多套 Component。如何优雅地为这些 Type 管理和存储“方法（Method/Command）”，是一个核心架构问题。

以下是对您的两种思路的分析，以及我顺着之前 `commandtree.md` 的思路提出的一种新维度的对比。

## 方案 1：数据库列记录 Command ID，Block 属性记录详细配置
**核心逻辑**：在定义 Type 的数据库（或类型注册表）中，增加一列 `Command ID` 列（多选文本或文本），指明该类能触发哪些命令。然后将这些命令的具体触发时机、参数等详细配置，序列化存储在“DB 块（或行块）本身的底层自定义属性（IAL）”中。
* **优点**：
    * 数据库视图保持相对整洁，只会看到一列 `Command ID` 标识。
    * 属性隐藏在底层，普通用户不会在视图上误改复杂的 JSON 参数，数据较安全。
* **缺点**：
    * **数据割裂**：用户在界面上只能看到有这个 Command，但如何使用、触发条件是什么，被隐藏在了黑盒里。系统也需要分离检索：先查 AV 表，再查节点属性，增加了逻辑断层。
    * **多态与复用冗余**：如果多个 Type 想共享同一个高度定制化的命令（比如“通用导出包含特定参数的 PDF”），必须在多个 Type 块的属性里重复写入相同的 JSON 配置。

## 方案 2：所有的命令及操作配置全量存在 DB 块属性中
**核心逻辑**：完全放弃在 AV 视图中展示“命令/方法”相关的列。把该 Type 拥有的所有命令、参数、触发规则，打成一个巨大的 JSON 数组，全部塞进 Type 对应的 DB 块的属性中（例如 `custom-type-methods="..."`）。
* **优点**：
    * 原生 AV 视图做到了极致的纯粹，只用来存储 Component（数据字段），完全剥离了 System（方法声明）。
    * 只要一次数据库 Block 的属性读取，就能拿到完整的方法定义，代码实现上最讨巧。
* **缺点**：
    * **彻底的黑盒化**：违背了现代笔记软件“Data as UI”（数据即界面）的理念。用户面对一个 Type 数据库，完全不知道它被赋予了哪些能力。必须依赖插件额外开发一整套复杂的 UI 弹窗去编辑这些底层 JSON。
    * **维护灾难**：复杂的对象数组序列化进字符串属性中极其脆弱。对 Block 的意外操作（如复制、重置属性）可能导致整个类的行为系统瞬间崩溃。

---

## 💡 方案 3（推荐思路）：独立的实体化「命令/动作库」+「关联列」(Relation) 映射

结合您在 `commandtree.md` 中最终推荐的**“单一用户白名单树 + Database 深度管理”**方案，我提出一种更符合 ECS 和关系型数据库哲学的第三种方案。

**核心逻辑**：
不要把“方法”当成一段配置文本，而是要把“方法/命令”本身也视为一种独立的**实体（Entity）**。将它们存放在全局的**“命令大盘数据库”（Command Registry DB）**中，然后通过**“关联列”（Relation）**与“类型数据库”（Type DB）进行多对多（M:N）的映射。

具体架构如下：
1. **全局方法库（System/Command DB）**：
   复用您在 `commandtree.md` 中设计的那个白名单数据库。这个表里的每一行就是一个**“实例化的行为”**，包含：`Command ID`, `名称(如：完成任务)`, `图标`, `定制参数 (Payload)`, `是否在悬浮条显示`。
2. **类型大盘库（Type/Supertag DB）**：
   维护全局 Type（如 `#Task#`, `#Project#`）的元数据。这里只需要添加一列类型为 **`Relation (关联)`** 的列，命名为 **`可用动作 (Available Actions)`**。
3. **低代码装配（Mapping）**：
   当用户想给 `#Task#` 添加一个“任务归档”方法时，直接在 Type DB 的 `可用动作` 单元格中，关联选择 Command DB 中的“任务归档”行。
4. **运行时的多类共存合并机制**：
   当用户在某个同时拥有 `#Task#` 和 `#Urgent#` 两个标签的 Block 上触发操作（如右键或点击按钮）时，插件的处理流：
   * 引擎查询 Type DB 中 `Task` 和 `Urgent` 这两行的 `可用动作`（Relation ids）。
   * 汇总这些 ids，去 Command DB 里拉取具体的命令实例。
   * **去重与覆盖匹配**：合并相同的命令。如果有同名冲突，还可以依据 Command DB 里的优先级进行覆盖。
   * 最终在 UI 上渲染给用户一个包含所有合法动作的执行面板。

### 为什么方案 3 是最佳解？
1. **100% 可视化与原生复用**：完全摒弃底层 IAL 的暗箱操作。方法是什么、参数是什么、哪些 Type 绑定了哪些方法，**全在思源原生 AV 表格中清晰可见、可直观配置**。
2. **极致的解耦与组件化**：“配置一个行为”和“将行为赋予实体”完全分离。你可以配置一个带延迟、带特定模板组合的**复杂宏（Macro）命令**，然后通过 Relation 单元格，一键复用给 10 个不同的 Type，修改时一处修改、处处生效。
3. **完美契合 ECS 哲学**：
   * 业务 Block -> 纯粹的底层对象（持有 Tag 作为身份索引）。
   * 标签大盘库 -> 相当于**组件（Component）映射表**，声明了含有该 Component 的对象享有什么权利。
   * 命令大盘库 -> 相当于**系统（System）策略库**，真正执行逻辑的独立模块。
4. **易于扩展**：未来若要增加“根据某个属性值动态显示方法”，只需在 Command DB 里加一列“可见性条件表达式”列即可，对 Type 层毫无侵入。

### 总结
在多标签（多重继承）复杂的场景下，依靠底层属性（IAL）藏匿配置是非常难以维护的技术债。利用**“独立命令子数据库 + 关联列表达多态继承”**（方案 3），不仅完美利用了思源底层的 AV 能力，更为开发者和高阶用户提供了一套类似 Notion/Tana 的全可视化面向对象可编程能力。

---

## 深入讨论：方案 3 的 DB Schema 与拦截执行逻辑

如果采用“实体化命令 + 关联列映射”的设计，我们需要设计两套数据库，并在代码层面实现拦截执行的调度器。以下是具体的落地方案。

### 1. 数据库结构设计 (DB Schema)

#### A. 全局命令大盘库 (Command Registry DB)
这个库相当于您的“方法池”或“白名单树的挂载点”。每一行是一个具体的可执行动作（可以是单个命令，也可以是宏）。

| 字段名 | 字段类型 | 作用与说明 |
| :--- | :--- | :--- |
| **Command ID** (主键) | 文本 | **不可重复的系统级 ID**（如 `plugin-av:action-archive` 或 `siyuan:export-pdf`）。代码根据这个 ID 来匹配执行的闭包逻辑。 |
| **Name** (名称) | 文本 | 用户可读的方法名称，如“归档任务”、“发送到待办”。 |
| **Icon** (图标) | 图标 | 该方法在 UI 悬浮条或菜单中显示的图标。 |
| **Type** (方法类型) | 单选 | 可分为 `System` (原生挂载), `Custom` (插件自定义), `Macro` (多步宏命令)。 |
| **Payload** (配置参数) | 长文本/JSON | **关键字段！**如果一个命令带 0-N 个参数，就配置在这里。如果是归档操作，这里可以写 `{"targetDb": "Archive", "delay": 0}`。 |
| **Trigger Ctx** (触发上下文) | 多选 | 定义这个命令在哪里可用大范围可见：`Context Menu` (右键菜单), `Hover Toolbar` (悬浮工具条), `Slash Command` (斜杠命令)。 |
| **Is Active** (是否启用) | 复选框 |  相当于“开挂机制的全局开关”。 |

#### B. 标签/属性大盘库 (Type / Supertag DB)
这个库相当于您的“类定义”，也就是目前 `Supertag` 绑定的那个汇总管理数据库。里面定义了 `#Task#`, `#Article#` 等。

| 字段名 | 字段类型 | 作用与说明 |
| :--- | :--- | :--- |
| **Type Name** (主键) | 文本 | 触发 Supertag 的标签名，如 `Task`。 |
| ... (其他数据属性列) | ... | 比如 `截止日期`，`优先级`。 |
| **Actions** (可用动作) | **Relation (关联)** | **核心！关联到 Command DB。** 在这里选定这个 Type 拥有哪些命令，比如选中了 `Command DB` 里的“归档任务”。 |

### 2. 参数与触发条件的精细化配置（由谁定义？）

您提到“可能带 0-多个参数，以及需要配置触发条件，这些在哪里配置？”
在方案 3 中，权限和参数被明确分工：

*   **参数配置在「Command DB」中。** 
    *   **原因**：一个命令如果带参数，那它实际上变成了一个特定行为的“实例”。例如：“推送到数据库 A”和“推送到数据库 B”是同一个底层动作代码，但参数不同。在 Command DB 中建立两行记录，分别配置 Payload `{"target": "A"}` 和 `{"target": "B"}`。
    *   **多态映射**：然后在 Type DB 里面，把“推送到 A”关联给 `#Task#`，把“推送到 B”关联给 `#Article#`。
*   **动作的有无（动态多继承合并）在「Type DB」的关系列中体现。**
    *   如果一个 Block 只有 `#Task#`，引擎只查 `#Task#` 关联的 Actions。如果 Block 有 `#Task#` 和 `#Emergency#`，引擎自动将两者的 Actions 列表 `Union`（去重合并）后展示给用户。

### 3. 代码层面的拦截执行逻辑 (Runtime Interception)

这是插件核心引擎要处理的运行期逻辑（System）。它的职责是：拦截块的 UI 操作（比如右键菜单或点击悬浮动作按钮） -> 动态计算当前块拥有哪些方法 -> 注入 UI -> 用户点击 -> 组装 payload 去执行。

**生命周期大图：**

1.  **缓存准备阶段**：
    *   在插件加载或这俩 DB 发生数据变动时，读取并缓存两份映射表：
        *   `TypeActionMap`: { "Task": ["action-archive", "action-complete"] }
        *   `CommandDefMap`: { "action-archive": { payload: {...}, trigger: ["ContextMenu"] } }

2.  **UI 挂载与拦截阶段 (例如：右键块菜单拦截)**：
    *   监听思源的触发事件（如 `click-blockicon` 或挂载 `protyle-toolbar`）。
    *   **获取上下文 (ECS: Get Entities)**：读取当前光标所在的 Block，分析它的 `data-type="NodeTag"`，提取出所有的 `Supertag` 列表（例如：`#Task#`, `#WIP#`）。
    *   **合并方法列表 (ECS: Merge Systems)**：
        *   去 `TypeActionMap` 查 `Task` 和 `WIP` 分别绑了哪些 Command ID。
        *   用 `Set` 去重，得到当前 Block 理论上支持的 Command IDs。
    *   **动态渲染 UI**：
        *   遍历提取出的 Command IDs，从 `CommandDefMap` 取出详细配置（Icon、Name、可见性 Context）。
        *   往思源的右键菜单（或悬浮菜单）中动态 `insert` DOM 节点。

3.  **调度与执行阶段 (Execution Engine)**：
    *   用户点击了动态注入的菜单项“归档任务”。
    *   获取 `CommandDefMap` 中该命令配置的 `Payload` 参数对象。
    *   **核心分发器 (Dispatcher)**：
        ```typescript
        // 伪代码演示
        async function executeCommand(commandId: string, currentBlockId: string, payload: any) {
            switch(commandId) {
                case "plugin-av:action-archive":
                    // 传入当前 Block ID 和 Payload 中的目标数据库
                    await archiveBlockEngine(currentBlockId, payload.targetDb);
                    break;
                case "siyuan:export-pdf":
                    // 组装原生系统需要的参数并调用
                    await window.siyuan.actions.exportPdf(currentBlockId, payload);
                    break;
                // ... 如果是 Macro，则按顺序循环调用子命令
            }
        }
        ```

### 极简总结
- **在哪配置参数和触发条件？** -> 全集中在 `Command DB` 里配置（让动作可复用）。
- **在哪配置多态和归属？** -> 在 `Type DB` 的关系列里配置（勾选即可）。
- **引擎如何工作？** -> 监听 UI 点击 -> 获取块的 Tags -> 查关系表拿动作 ID -> 查详情表拿 Payload -> 调度执行代码。

---

## 进阶：如何让命令的参数与 Type 自身的属性（或当前 Block 实例的属性）关联？

这是一个非常关键的架构问题！如果我们要通过 `Relation` 去复用一个通用的动作（比如：“发送邮件通知”），但发给谁、标题是什么，这些数据存在于打上 `#Task#` 的具体那个 Block 的属性列里。

在「方案 3」中，解决这个问题的标准做法是**引入“模板变量插值 (Template Variable Interpolation)”与“上下文对象 (Context Object)”**。

具体机制如下：

### 1. 结构设计：Payload 不存写死的数据，存“变量表达式”
我们继续在 **`Command DB`** 中配置 Payload。但此时，Payload 的 JSON 值不仅可以是静态字符串，还可以是用特殊符号（如 `{{ }}` Mustache 语法）包裹的**上下文变量路径**。

例如，在 Command DB 配置一个动作叫“根据任务分配人发送提醒”：
*   **Command ID**: `action-send-reminder`
*   **Payload配置**:
    ```json
    {
      "toUser": "{{ av.Assignee }}",
      "message": "任务 {{ block.content }} 即将到期。截止日期: {{ av.DueDate }}"
    }
    ```

### 2. 执行期（Runtime）的“晚绑定 (Late Binding)”装配逻辑
当用户在某个打着 `#Task#` 的 Block 上触发了该命令时，真正的神奇发生在咱们的执行引擎里：

**步骤一：构建上帝上下文 (The God Context)**
调度器拦截到点击后，在执行具体的命令逻辑**之前**，先根据当前的 `CurrentBlockID` 收集所在环境的所有数据，组装成一个巨大的 `Context` 对象字典：
```typescript
const context = {
    // 1. 当前物理块本身的原生数据
    block: {
        id: "20231010120000-xxxxx",
        content: "修复登录接口 Bug",
        updated: "2023-10-10 12:00:00"
    },
    // 2. 当前块在 Type DB (或它所属的任何 AV) 中填写的属性列的值！
    av: {
        "Assignee": "张三",     // 比如对应 Type 库里叫"Assignee"的那一列的值
        "DueDate": "2023-10-15",
        "Priority": "High"
    },
    // 3. 甚至可以注入一些全局环境变量
    env: {
        today: "2023-10-10",
        workspaceId: "ws-xxxxx"
    }
};
```

**步骤二：执行变量解析插值 (String Interpolation)**
调度器将第一步拿到的 `Command DB` 里原封不动的带有 `{{ }}` 的 Payload 字符串，丢给一个模板引擎计算（或者简单的正则替换函数），并传入上面的 `context` 对象。

*Payload 解析前：* `{"toUser": "{{ av.Assignee }}"}`
*Payload 解析后：* `{"toUser": "张三"}`

**步骤三：透传执行**
最终，传递给具体命令底层函数的 `payload` 已经是被真实 Block 数据替换好的、热腾腾的数据了！
`await executeCommand("action-send-reminder", currentBlockId, resolvedPayload)`

### 结论与优越性
通过引入一套清晰的**「上下文变量 `{{ }}`」语法**：
1. **完全不需要在 Type DB 层面配置多余的映射**。关联列（Relation）依然只负责选定“我有这个动作”。
2. **极大的灵活性释放**。同一个“发送提醒”的动作可以在 Command DB 里被配置一次；当它被 `#Task#` 使用时，`{{ av.DueDate }}` 取的是任务表里的期限；如果它又被 `#Contract#` 关联使用了，只要合同表里也有 `DueDate` 这个列，这个动作不用改一行代码就能直接复用！
3. **心智模型对齐**。这种通过“占位符提取当前实例属性”的做法，完美契合面向对象编程中 `this.propertyName` 的核心思想（这里的 `context.av.xxx` 就是 `this`），是低代码/无代码平台的标准做法（如 Notion 的 Database Automation 配置里的蓝框变量）。
