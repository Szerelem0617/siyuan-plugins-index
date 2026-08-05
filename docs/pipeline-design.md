# 命令 Pipeline（复合命令）设计文档

> 状态：设计稿 v1（待评审）
> 范围：多命令按序执行作为一个行为的参数流转、存储、注册与可视化配置

## 1. 背景与目标

当前多命令编排有两种形态：supertag 条件触发（结构化行文本 + TS 脚本）和全局后台调度（TS 脚本）。两者都把配置存成 AV 单元格里的**带注释文本**，存在解析脆弱、无法校验、无法版本化、无法可视化编辑、无法复用的问题。

目标：

1. **极简默认**：用户只需按序勾选命令，系统自动完成参数匹配（"创建新块后更新块内容"这类场景开箱即用）。
2. **深度可选**：用户可打开"更新参数配置"面板，手动连线/填写参数；复杂逻辑可内嵌 TS 脚本。
3. **可复用**：pipeline 配置存为 Command-DB 的一条记录，注册成命令后，顶栏、行内按钮、Icon Menu、supertag 触发、后台调度都能绑定。

## 2. 设计原则

### 2.1 以 param-mapping 为核心

不引入 guard、条件跳转等"控制台思维"。pipeline 的本质是**参数流转**：每个命令的入参 = 自己填，或引用前一步的出参。用户心智模型是"勾选命令 + 连线"。

### 2.2 双轨：JSON 编排 + script 算法

- **编排**（高频、需要可视化/校验/复用）：存 JSON。
- **算法**（低频、个性强：循环、复杂条件、外部 API）：存 TS 脚本，作为 pipeline 的一种步骤类型。

划界原则：绝不试图用 JSON 造一门通用编程语言；凡是高频可配置的将来做成 JSON 原语 + UI 控件，其余一律 script。

### 2.3 参数优先级

运行时按优先级**逐键合并**（后覆盖前）：

1. **#1 Pipeline 人为规划**：步骤 params 中显式填写的值 / 绑定的出参引用。
2. **#2 Pipeline 自动赋予**：前序步骤出参经 `stepN.key` 变量引用自动注入。
3. **#3 Command-DB 配置**：该命令在 Command-DB "Param Mapping" 列的配置（唯一持久化配置源）。
4. **变量解析（内嵌）**：所有字符串参数值统一解析 `{{date}}/{{time}}/{{block_id}}/{{root_id}}/{{parent_id}}/{{attr:KEY}}/{{var.x}}/{{stepN.key}}`。
5. **#5 Registry 默认**：`commands.json` 的 `params[].default` 与 seed paramMapping，仅作初始模板，不参与运行时优先级。

## 3. 数据模型（v1）

### 3.1 JSON Schema

```json
{
  "version": 1,
  "name": "创建任务并更新",
  "steps": [
    {
      "type": "command",
      "commandRef": "api.block.insert",
      "enabled": true,
      "delayMs": 0,
      "params": {
        "data": "[新任务] {{time}}",
        "previousID": "{{block_id}}"
      }
    },
    {
      "type": "command",
      "commandRef": "plugin-index.command.safeUpdateBlock",
      "enabled": true,
      "delayMs": 0,
      "params": {
        "id": "{{step0.id}}"
      }
    }
  ]
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | number | 是 | 模型版本，演进用 |
| `name` | string | 是 | pipeline 显示名 |
| `steps` | array | 是 | 按序执行的步骤 |
| `steps[].type` | `"command" \| "script"` | 否 | 默认 `"command"` |
| `steps[].commandRef` | string | command 必填 | 已注册命令 ID（可以是另一个复合命令，允许嵌套，需循环检测） |
| `steps[].enabled` | boolean | 否 | 是否执行本步，默认 `true` |
| `steps[].delayMs` | number | 否 | 执行本步前等待毫秒，默认 `0` |
| `steps[].params` | object | 否 | 命令入参，逐键覆盖 Command-DB 配置 |
| `steps[].code` | string | script 必填 | TS 脚本正文（`async ({ dispatch, state, eventName }) => {...}`） |

### 3.3 params 的三态

| 状态 | 写法 | 运行时 |
|---|---|---|
| 空/缺键 | 不写该键 | 用 Command-DB paramMapping → schema 默认 |
| 字面量 | `"data": "固定内容 {{time}}"` | 直接传值，字符串做占位符解析 |
| 出参引用 | `"id": "{{step0.id}}"` | 解析为前序步骤出参 |

### 3.4 保留控制字段

`enabled` / `delayMs` 是**步骤级控制字段**，引擎拦截，不转发给命令。避免用 `pause`/`continue` 这类可能与命令真实参数冲突的命名。

## 4. 出参与变量池

- 每步执行完，出参按 `step<序号>.<输出名>` 写入 pipeline 变量池（如 `step0.id`、`step0.createdblock`）。
- 出参来源：`CommandDef.outputs` schema；无 schema 时默认暴露 `id` / `createdblock`（与现 ParamConfigDialog 的出参命名一致）。
- 变量池仅当次执行有效，不持久化；跨执行共享需显式写回 Command-DB / Layer 4。
- script 步骤可通过 `state.vars` 读写同一变量池，`stepN.key` 与其打通。

## 5. 智能默认匹配（极简入口的核心）

勾选命令后自动生成初始 params。启发式（按优先级排序）：

1. **类型匹配**：入参类型（blockid / text / boolean...）对应出参类型；
2. **最近前驱优先**：优先绑定最近的前序步骤；
3. **名字相似**：`id` ↔ `id` / `createdblock` 等。

示例："创建新块后更新块内容"：

- step0 `api.block.insert` 出参：`id`（blockid）
- step1 `plugin-index.command.safeUpdateBlock` 入参 `id`（blockid）
- 匹配：向前找最近的 blockid 出参 → 自动写 `"id": "{{step0.id}}"`

规则：**默认绑定只是建议，始终可视化可见、可改**。系统不做隐式自动接线，避免"系统擅自控制某一步"的歧义。

## 6. 执行引擎

### 6.1 双轨执行

```
runPipeline(config, context):
  pool = { ...context.vars }
  for each step:
    if !step.enabled: continue
    await sleep(step.delayMs)
    if step.type == "script":
      result = executeTsScript(step.code, { dispatch, state: pool, eventName })
    else:
      result = dispatchCommand(step.commandRef, null, context, {
        manual: step.params || {},
        commandDb: COMMAND_BINDINGS 中该命令的 paramMapping  // 引擎侧解析
      })
    pool[`step${i}.*`] = result 出参
```

### 6.2 与现有代码衔接

- 参数合并/解析：复用 `resolveCommandParams()` / `mergeParamSources()`（`command-dispatcher.ts`）。
- 占位符解析：复用 `resolveTemplate()`，扩展 `{{stepN.key}}` 变量来源。
- script 执行：复用 `executeTsScript()`（`supertag-sandbox.ts`），统一 `dispatch` 助手。
- 命令库 paramMapping：从 `COMMAND_BINDINGS` 按 commandRef 反查（复合命令自身的 paramMapping 作为全局默认，被步骤 params 覆盖）。

### 6.3 错误处理（v1 从简）

- 步骤失败：默认中断整条 pipeline，抛出错误并提示。
- `enabled=false` 跳过；`delayMs` 等待。
- retry / onFail / 并行：**v1 不实现**，将来以加字段方式演进（见 §8）。

## 7. 存储与注册

### 7.1 存储

- 位置：Command-DB 一行记录的 **"Pipeline 定义"列**（JSON 字符串）。
- 该行其他列照常：主键 = 名称，Command ID = `pipeline.<行ID>`，Param Mapping = pipeline 全局默认参数，UI 入口列决定展示位置。
- script 代码内嵌在 JSON 的 `steps[].code`，随 pipeline 一起存储/复制/迁移（可视化编辑器内用代码编辑器渲染，用户不直接面对转义）。

### 7.2 注册

保存时：

```ts
commandRegistry.registerCommand({
  id: "pipeline.<rowID>",
  name: pipeline.name,
  dispatch: { method: "custom", executor: (params, ctx) => runPipeline(config, ctx) },
  params: [],  // pipeline 自身的参数 schema（后续可支持参数化入口）
  constraints: { requiresFocus: false, environment: "universal" },
  meta: { scope: "global", category: "custom", source: "user" }
});
```

注册后即被现有绑定点（顶栏 / 行内按钮 / Icon Menu / supertag / 后台）无差别使用，消费方零改动。

## 8. 能力边界与演进

### v1 能做的

- 按序执行、参数绑定（字面量/出参引用/命令库默认）
- 手动禁用某步、步间延迟
- 复用/嵌套（复合命令作为步骤）
- 内嵌 TS 脚本实现任意逻辑

### v1 不做的（将来按需加字段）

- `retry`（失败重试/直到成功）：`{ untilSuccess, maxAttempts, intervalMs }`
- `onFail`（失败跳转/备用命令）
- 并行步骤（容器原语）
- 条件分支/跳转原语
- 动态步骤（运行中增删）

模型演进方式：加可选字段 + `version` bump，已存 JSON 兼容。

## 9. 可视化面板交互

### 9.1 流程

1. 用户勾选命令（按序）→ 系统按 §5 智能生成初始 params。
2. 点"更新参数配置"→ 面板展示每步默认绑定（智能自动的以连线/高亮标出）。
3. 用户修改：
   - 点某步的**入参** → 点另一步的**出参端点** = 绑定（写入 `{{stepN.key}}`）；
   - 直接输入框填写 = 字面量；
   - 清空 = 恢复使用 Command-DB 配置。
4. 保存 → 写 Command-DB "Pipeline 定义"列 → 注册命令。

### 9.2 交互细节

- 出参端点类型感知：blockid 入参高亮 blockid 出参端点，boolean 类似。
- 被 pipeline 覆盖的参数在面板中标注"已被 pipeline 覆盖"，避免与 Command-DB 配置混淆。
- 每步头部显示 `enabled` 开关与 `delayMs` 输入。
- 支持"转为脚本"：把整条 pipeline 或单步切换为 script 模式（编辑现有 TS 文本）。

## 10. 待决问题

1. 复合命令作为步骤时，其出参如何暴露（默认：内部最后一步出参，或显式声明导出）。
2. pipeline 自身是否支持参数化入口（`params` schema），以便同一 pipeline 被不同场景以不同参数调用。
3. 结构化行文本（`// [事件] -> 命令(参数)`）与旧 TS 文本的迁移策略（测试版本可不做向后兼容，直接以 script 步骤包装）。
