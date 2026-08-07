# 命令 Pipeline（复合命令）设计文档

> 状态：架构终稿 v2
> 范围：多命令按序执行的参数流转、存储、注册与可视化配置

## 1. 背景与目标

当前多命令编排包含多种形态：supertag 条件触发（结构化行文本 + TS 脚本）、全局后台调度（TS 脚本）以及复合命令。

目标：

1. **单 source of truth（不增加 JSON 中介层）**：无论 GUI 勾选配置还是用户手写复杂逻辑，全量存储与执行均基于 **TS 脚本 DSL**，不强行引入 JSON 描述层或复杂解释器。
2. **零门槛 GUI + 自由扩展**：系统通过 GUI 自动渲染生成规范的 TS 脚本；反向解析成功时提供可视化勾选/参数填充面板；解析失败（手写代码）时无缝降级为代码编辑器。
3. **公共 State 参数流转**：摒弃繁琐的 `stepN.key` 级联，采用极简的公共 `state.vars` 状态池机制（类似 ECS 系统状态覆盖），出参直接更新到公共 state，后续命令直接引用。
4. **可复用注册**：pipeline 配置存为 Command-DB 的一条记录，注册成命令后，顶栏、行内按钮、Icon Menu、supertag 触发、后台调度都能无缝绑定。

## 2. 设计原则

### 2.1 以 TS 脚本 DSL 为唯一存储与执行源

绝不引入中介 JSON DSL。Command-DB 的 "Pipeline 定义" 列直接存储标准 TS 脚本文本。

- **gui 生成模式**：由界面自动拼装出特定规范格式的 `async ({ dispatch, state, eventName }) => { ... }` 文本。
- **自定义代码模式**：用户可任意书写 JS/TS 语句（循环、条件、调用外部 API），执行引擎以统一沙箱运行。

### 2.2 简单平坦的参数流转（公共 State 覆盖机制）

摒弃复杂的 `stepN.key` 作用域映射，参数池 `state.vars` 是一个平坦且全局共享的上下文（类似 ECS 系统中的公共 Component）：

1. 每个命令执行完成后，出参（如 `id`、`createdblock`、`value`）直接写入/覆盖公共 `state.vars`。
2. 后续步骤命令入参可通过 `{{id}}` / `{{createdblock}}` 或 `{{var.x}}` 直接读取最新的状态。
3. 用户或自定义 TS 脚本亦可随时修改 `state.vars`。

### 2.3 参数优先级

运行时按优先级**逐键合并**（后覆盖前）：

1. **#1 脚本内联参数（manual）**：`dispatch("cmd", { key: "val" })` 显式传递的入参。
2. **#2 Command-DB 配置**：该命令在 Command-DB "Param Mapping" 列的默认配置。
3. **#3 变量解析内嵌**：所有字符串参数统一解析 `{{date}}/{{time}}/{{block_id}}/{{root_id}}/{{parent_id}}/{{attr:KEY}}/{{var.x}}/{{custom_alias}}`。
4. **#4 Schema 默认**：`commands.json` 里的 `params[].default`。

---

## 3. 脚本规范与 DSL 格式

### 3.1 GUI 生成的标准 TS 范式

可视化编辑器生成的标准脚本结构：

```ts
// 名称: 创建任务并更新
async ({ dispatch, state, eventName }) => {
    await dispatch("api.block.insertBlock", {
        "data": "[新任务] {{time}}",
        "previousID": "{{block_id}}"
    });
    await dispatch("plugin-index.command.safeUpdateBlock", {
        "id": "{{createdblock}}"
    });
}
```

### 3.2 沙箱运行环境 (Environment Context)

脚本由 `runRuleScript` 在统一沙箱中执行，注入以下内置变量：

| 变量名 | 类型 | 说明 |
|---|---|---|
| `dispatch` | `(cmdId: string, params?: object) => Promise<DispatchResult>` | 执行指定命令，成功后自动将出参更新至 `state.vars` |
| `state` | `{ vars: Record<string, any> }` | 共享状态池对象 |
| `delay` | `(ms: number \| string) => Promise<void>` | 延迟函数，支持 `500` 或 `"1s"` / `"2m"` |
| `context` | `CommandContext` | 包含 `blockEl` / `protyleEl` / `supertag` 等上下文 |
| `eventName` | `string` | 触发事件名（仅条件触发时使用） |

---

## 4. 可视化编辑与反向解析机制

### 4.1 双态降级策略

系统不使用复杂的 AST 词法树分析库，而是采用**封闭格式解析 + 容错降级**：

```
+----------------------------------------------------+
|               读取 Command-DB 中的 TS 脚本          |
+----------------------------------------------------+
                          |
                          v
         +----------------------------------+
         | parseRuleScript (匹配模板/JSON) |
         +----------------------------------+
                /                    \
         (解析成功)                (解析失败/手写逻辑)
              /                        \
              v                         v
+---------------------------+  +---------------------------+
| GUI 可视化模式            |  | 自由代码编辑模式           |
| (展示命令勾选/顺序/入参)  |  | (展示 Ace/Monaco 代码框)  |
+---------------------------+  +---------------------------+
```

1. **GUI 勾选模式**：当代码符合 `dispatch("cmdId", { JSON })` 标准模板时，反向解析提取出命令序列和入参，在 UI 上提供勾选列表、排序与入参配置框。
2. **代码编辑模式**：一旦脚本中包含手写的逻辑（如 `if` 条件、`for` 循环、非 JSON 的 JS 动态表达式），反编译逻辑返回 `null`，UI 自动切换为脚本文本编辑器。两种模式均保存为 TS 脚本，无缝兼容。

### 4.2 智能默认填充 (Smart Fill)

在 GUI 勾选界面，系统按如下启发式规则为新勾选的命令补全入参：
1. 提取前序命令在其 `outputs` 中声明的规范 key 或用户别名（`_outputMapping`）。
2. 类型匹配：`blockid` 类型优先填入 `{{createdblock}}` 或 `{{id}}`。
3. 输入框高亮显示当前使用的状态引用。

---

## 5. 存储与注册

### 5.1 存储

- 位置：Command-DB 一行记录的 **"Pipeline 定义"列**（TS 代码字符串）。
- Command ID 规范：`pipeline.<shortHash(rowID)>`。
- 其他列：主键 = 名称，Param Mapping = 全局默认参数，UI 入口列决定展示位置。

### 5.2 注册

```ts
commandRegistry.registerCommand({
  id: pipelineCommandId(rowId),
  name: pipelineName,
  description: `复合命令（Pipeline）：${pipelineName}`,
  dispatch: {
    method: "custom",
    executor: async (params, ctx) => {
      return runRuleScript(script, ctx);
    }
  },
  params: [],
  constraints: { requiresFocus: false, environment: "universal" },
  meta: { contextNeed: "none", category: "custom", source: "user", plugin: "pipeline" }
});
```

注册后，任何绑定点（顶栏按钮、Icon Menu、Supertag 触发器、后台定时任务）均可以统一方式调度该复合命令。

---

## 6. 演进说明

- 本设计作为测试版本的唯一标准架构，彻底废弃原草案中的 JSON Schema 编排与 `stepN.key` 作用域说明。
- 后续如需增加步间控制（如忽略错误继续执行），可在 `dispatch` 辅助函数中增加可选配置参数（如 `dispatch("cmd", params, { ignoreError: true })`），保持整体代码精简一致。

