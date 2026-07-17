# Layer 3 语义工作流引擎重构规划 (Workflow Orchestration)

本项目对 IndexOS 的 Layer 3 触发与管道机制进行深度重构，将其从简单的“命令链”升级为基于“共享上下文（Context）”与“声明式流控制（Flow Control）”的轻量级工作流编排引擎。

---

## 一、 核心设计要点

### 1. 运行时共享上下文 (ExecutionContext)
* **目标**：解耦步骤之间的传参。所有命令的签名统一为 `execute(params, context)`。
* **数据流**：指令向 `context.vars`（内存变量池）中读写变量，后续指令通过模板参数（如 `{{vars.completed}}`）进行绑定消费。

### 2. 声明式流控制与逻辑截断 (CommandResult)
* **状态定义**：指令返回 `{ success: boolean, value?: any, continue?: boolean }`。
* **中断判定**：如果执行失败（`success === false`）或逻辑判定返回假值（`value === false` / `continue === false`），PipelineRunner 自动中断流转，静默退出而不弹出系统 Error Toast。

---

## 二、 重构任务分解 (TODOs)

- [ ] **【第一阶段】底层接口与 Context 定义重构**
  - [ ] 升级 `command-dispatcher.ts` 中的 `ExecutionContext` 接口，正式引入 `vars: Record<string, any>`。
  - [ ] 调整 `DispatchResult` 返回类型，使其支持声明式的 `value` 与流控。
  - [ ] 更新 `resolveTemplate` 或参数解析引擎，支持对 `{{vars.xxx}}` 进行运行时解析取值。

- [ ] **【第二阶段】PipelineRunner 调度流升级**
  - [ ] 修改 `supertag.ts` 的 `triggerConditionalCommands` 循环。
  - [ ] 确保前驱命令的 `value === false` 被捕获，并安静地 `break` 流程，同时不影响正常的 `success === false` 的系统报错气泡显示。

- [ ] **【第三阶段】系统命令与 Executor 改造**
  - [ ] 升级内置命令注册接口与具体执行器（如 `checkTaskCompleted`），在完成时将结果写入 `ctx.vars.completed`。
  - [ ] 验证 `siyuan.ui.toast` 等通用 API 能够通过 `{{vars.completed}}` 动态渲染提示消息。

- [ ] **【第四阶段】Layer 4 声明式属性同步映射 (选做扩展)**
  - [ ] 支持在 `supertag-db` 同步后置勾子中自动把 `ctx.vars` 写入对应 AV 数据库。

---

## 三、 验证方案

1. **基本冒烟测试**：修改任务块内容并打勾 $\rightarrow$ 触发完成检测 $\rightarrow$ 弹出烟花 $\rightarrow$ 弹出含有动态变量的 Toast 气泡。
2. **逻辑截断测试**：取消勾选任务 $\rightarrow$ 再次触发检测 $\rightarrow$ 烟花不弹出 $\rightarrow$ 控制台无红色 Error 报错，屏幕无错误气泡。
