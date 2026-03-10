# 思源命令白名单分类与分析 (Command Whitelist Analysis)

基于 `siyuan-discovery.json` 中的命令集合，结合 Tana 和 Notion 的常规交互逻辑，对系统底层命令和插件命令进行“白、灰、黑”分类。
我们的目标是：筛选出最适合放在 **Type DB / Command DB** 中，供用户作为 **“块级动作 (Block Actions)”** 调用的能力。

---

## 1. Tana / Notion 常用块级动作参考
在 Tana 和 Notion 中，用户点击 Block 周围的“六点”菜单或打标签后，最常见的动作包括：
*   **转换类 (Turn int/Transform)**：将当前块转为标题、待办、引述、或者特定的 Database 记录。
*   **结构类 (Structure)**：插入子项 (Insert Sub-block)、在上方/下方插入、复制 (Duplicate)、移动到 (Move to)、删除 (Delete)。
*   **链接类 (Linking)**：复制块链接 (Copy Block Ref)、带入上下文引用。
*   **业务状态类 (Business Logic, Tana 特有)**：设为完成 (Mark done)、延期至明天 (Postpone)、分配给某人 (Assign)。
*   **视图类 (View)**：在右侧面板打开 (Open in split view)、聚焦放大 (Focus/Zoom in)。

结合这个思路，我们对思源的系统和插件命令进行以下筛选：

---

## 2. 🟢 白名单 (White List：高频次、安全、契合 ECS 架构)
这些命令**强烈建议**允许用户默认添加到 `Command DB` 中，因为它们直接作用于“当前选中的 Block（Entity）”，非常适合转化为右键动作面板。

### 2.1 结构与内容操作 (Structural & Content)
*   `editor.general.duplicate` (复制块) - **核心**：快速 clone 一条任务。
*   `editor.general.insertAfter` / `insertBefore` (下方/上方插入) - 适合工作流节点的延展。
*   `editor.general.insertBottom` / `insertRight` (里层/右侧插入)
*   `editor.general.collapse` / `expand` (折叠/展开)
*   `general.newFile` (新建文档) - 结合特定的 Type，可以通过新建文档命令触发连带构建。

### 2.2 转换与渲染 (Transform / Format)
这类多数来自 `slashCommands` 或插入快捷键，用于把当前块变为其它样式。
*   转换格式：`heading1...6`, `list`, `check` (任务列表), `quote` (引述)
*   `editor.list.checkToggle` (切换任务完成状态) - **极高频**，是所有 Task 相关的核心动作。

### 2.3 关联与引用 (Link & Ref)
*   `editor.general.copyBlockRef` (复制块引用) - **核心**：将其做成一个“分享链接”按钮。
*   `editor.general.copyBlockEmbed` (复制块嵌入)
*   `general.addToDatabase` (添加到属性视图) - 我们的老本行，将块数据化。

### 2.4 特定插件能力 (Plugin Actions)
*   `shortcutSetBlockAsTask` (设置为任务，来自任务管理插件) - 完美的 ECS Component 动作。

---

## 3. 🟡 灰名单 (Grey List：功能强大但偏全局或较重)
这些命令可以提供配置，但不建议默认开放给普通用户满面堆砌。它们更多是操作**文档整体**或**工作区 UI**，而不是操作单一的 Block。

### 3.1 页面/视图导航 (Page & Navigation)
*   `editor.general.graphView` (打开图谱) / `general.globalGraph` (全局图谱)
*   `editor.general.backlinks` (打开反链面板)
*   `general.splitLR` / `general.splitTB` (左右/上下分屏) - 用于制作“在右侧查看详情”这种高级动作。
*   `editor.general.fullscreen` (全屏沉浸模式)

### 3.2 功能聚合与检索 (Aggregation & Search)
*   `general.globalSearch` (全局搜索)
*   `plugin.siyuan-plugins-index.insertIndex` / `insertoutline` (插入目录) - 这是宏指令，更适合在文档大纲处一键调用，不适合绑定在极小颗粒的 Block 状态上。
*   `general.syncNow` (立刻同步) - 工具类行为。

---

## 4. 🔴 黑名单 (Black List：危险、不相关或纯 UI 操作)
这些命令**禁止**或**无意义**加入块级动作菜单。如果放入动作绑定，会引发用户体验错乱。

### 4.1 纯文本与排版快捷键 (Pure Text Editing)
*   `editor.insert.bold` / `italic` / `underline` (加粗/斜体) - 这是划词工具条干的事，无需通过动作菜单执行。
*   `editor.general.alignCenter` / `alignLeft` (对齐居中) 

### 4.2 窗口与编辑器布局管控 (Layout & Destructive)
*   `general.closeTab`, `general.closeAll`, `general.closeOthers` (关闭页签系列) - 把这种操作绑在块动作上会让人迷惑。
*   `general.lockScreen` (锁定屏幕)
*   `general.toggleDock` (切换布局边栏)
*   `general.config` (打开设置)

### 4.3 离线与资源操作 (Asset Management)
*   `editor.general.netImg2LocalAsset` / `netAssets2LocalAssets` (云端资源本地化) - 属于低频维护操作。
*   `editor.general.rename` / `newNameFile` (通常指文件重命名) 

---

## 总结
在未来的 Command DB 拦截器里，我们重点关注**“白名单”**（如状态切换、属性读取、新建衍生块、复制引用）。

**Tana 带来的最大的启发是：**
Notion 的菜单是一成不变的（所有块右键都一样）。而 Tana 和我们的 ECS 模型，菜单是由 **Tags** 决定的。
因此，我们可以组合这些白名单系统命令：例如，我们配置一个叫 `[派发任务]` 的命令，底层它其实是在调用多次思源的原生 API：
1. 调用 `editor.general.duplicate` (复制出一个块)。
2. 给新块赋一个 `Assignee` 列。
3. 调用 `editor.general.copyBlockRef` 放入剪贴板。
这就是系统级原生白名单命令，经过二次组合后，爆发出的巨大威力。
