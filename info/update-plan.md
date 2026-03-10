# 插件总架构设计与演进路线 (Architecture & ECS Mappings)

本插件的核心目标是结合 **“ECS (Entity-Component-System)”** 和 **“无代码 (No-Code)”** 思想，为思源笔记的各种离散 Block 提供灵活的数据绑定（Supertag）和完整的结构化页面映射（Builder）。

## 1. 核心分层与存储架构 (Storage Design)

*   **Type DB (类型大盘)**: 负责注册所有的标签 (如 `#任务#`, `#项目#`) 及其映射到的 AV 库。这是**组件 (Component)**的声明处。
*   **Command DB (命令大盘)**: 负责定义所有的动作模板和执行逻辑 (System)。通过 Payload 占位符如 `{{av.Assignee}}` 解耦参数。这也是纯函数库的载体。
*   **物理 Block (实体 Entity)**: 用户文档中的段落或列表项。

## 2. 关键引擎与应用场景 (Core Engines)

1.  **Supertag 引擎 (微型组件/Thin Type 模式)**
    *   **机制**：捕获用户打标行为 (依赖 Mutation/WebSocket)。通过查询 Type DB，将普通的 Block 隐式拉入 Attribute View，赋予其自定义的列数据。
    *   **场景**：赋予散落的笔记段落状态（如 `#需复核#`，挂载变色操作）或特定责任人（ `#Assignee#`，挂载发邮件操作）。
2.  **Builder 引擎 (巨型实体/Fat Type 模式)**
    *   **机制**：当遇到知识库/日历等重量级概念时，不仅仅落入 AV，还会基于配置好的继承规则 (`inheritanceRules`)，向上拉取父级的结构数据，并自动建立一个庞大宽敞的子文档 (Document/Page) 来承载长篇正文。
    *   **场景**：如 `#月度计划#`，打标签后不仅在总表中有数据追踪，还能点击跳转到一个包含万字的专属双链大页面中。
3.  **Command 拦截器 (动作执行中枢)**
    *   **机制**：负责在 Block 右键弹出相应的操作面板。根据 Block 身上的 Tags 取并集，利用鸭子类型 (**Duck Typing**) 的灵活性，只要当前 Block 所在 AV 满足 Command 的入参要求，即可调用对应的功能。

## 3. 痛点解决与架构对比 (Vs. OOP)

相比于传统的面向对象编程（OOP）：
*   **摒弃类继承树**：彻底解决钻石继承和强耦合的“多态”冲突。
*   **打标混入(Mixin)**：采用扁平的组合模式，让 Block 组合 `#A` 和 `#B` 标签瞬间拥有两者的所需数据表头和动作菜单。
*   **消除重构噩梦**：支持修改一处基础类或动作配置包，全世界所有应用了该标签的实例瞬间更新能力。

## 4. 阶段性重构计划 (Implementation Steps)

在未来的开发中，要全面走向上述理想状态，我们需要分四个核心阶段推进：

*   **阶段 1 [Breaking Change]: 基座重构**
    *   废弃基于 `custom-index-db-config` IAL 的散装 TypeMapping，彻底移除旧的找表逻辑。
    *   在插件专属配置笔记本下建立并读取中心化的 **Type DB** 表与 **Command DB** 表。
*   **阶段 2: 引擎换源**
    *   改造 `SupertagMonitor`，让它的匹配源和归类动作直接指向中心化的 Type DB。
*   **阶段 3: 调度层构建**
    *   研发基于鸭子类型的右键 Command 调度执行菜单，完成 Payload `{{ }}` 的多维表值替换与解析。
*   **阶段 4: 生态大融合**
    *   整合 Builder 与 Command，打通“胖类”的深度数据视图和动态页面生成，并且让由 Builder 生成的页面也能享用 Command 库的方法体系。