# IndexOS Supertag 手动命令 (Manual Command) 架构设计与演进规划

## 1. 概述与核心分类

在 IndexOS 的 Supertag 命令体系中，命令根据触发机制划分为两大核心大类：

1. **`Auto` 自动触发**：基于事件生命周期 (如 `tag_created` / `block_content_changed` 等) 自动分发执行的 Conditional 触发器管道。
2. **`Manual` 手动触发**：由用户在交互界面上手动发起的命令，包含以下 **4 种独立且分工明确的暴露形态**：
   - 👻 **Virtual Button (虚拟悬浮按钮)**
   - 🧱 **Real Button (物理 Block 实体按钮)**
   - 📋 **Icon Menu (图标 / 右键下拉菜单)**
   - ⌨️ **`;; Panel` (键盘快捷面板)**

---

## 2. 4 种 Manual 触发方式对比与架构定位

| 暴露形态 | 存在本质 | 生存空间 | 核心使命与适用场景 | Node Filter 契合度 |
| :--- | :--- | :--- | :--- | :--- |
| **👻 Virtual Button<br>(虚拟悬浮按钮)** | **纯 DOM 挂载 / 渲染态**<br>(不在文档中写入 Block) | **本地附着 (Local Bound)**<br>只能依附在打 Tag 的本块右上角 | **本块高频状态流转**<br>根据块状态动态悬浮出现 (如 `custom-status == 'pending'` 提拔呈现 `☑️ 完成任务`) | ⭐️⭐️⭐️⭐️⭐️ **完美**<br>零 Undo 垃圾，无痕消隐，状态响应式联动 |
| **🧱 Real Button<br>(物理实体按钮)** | **思源物理 Block 节点**<br>(带 `custom-origin-id` 锁) | **跨空间自由 (Spatial Freedom)**<br>可生成在任意页面/仪表盘，可剪切移动 | **跨页面控制、探针回写、SOP 嵌入**<br>1. 跨页面仪表盘生成控制按键<br>2. 带 Context 的随身移动探针<br>3. SOP 流程文档的结构化按键 | ⚠️ **生成时求值**<br>实体节点不作频繁销毁，保持位置稳定 |
| **📋 Icon Menu<br>(图标 / 右键菜单)** | **动态菜单拓展**<br>(Protyle 菜单插槽) | **随点随现**<br>悬浮图标或右键弹出 | **次要/低频命令默认收纳库**<br>收纳不常用的命令，不占用块常驻视线空间 | ⭐️⭐️⭐️⭐️⭐️ **全覆盖**<br>默认呈现或根据状态收纳 |
| **⌨️ `;; Panel`<br>(键盘快捷面板)** | **动态 Overlay 浮层**<br>(键盘 `;;` 键入唤起) | **键盘聚焦处**<br>选完即隐，零物理残留 | **手不离键盘的极速流**<br>键入 `;;` 瞬间检索并回车触发绑定命令 | ⭐️⭐️⭐️⭐️⭐️ **全覆盖**<br>默认提供极速检索与顺位推荐 |

---

## 3. Block Filter (块过滤条件) 动态呈现机制

### 3.1 核心思想与应用边界
- **应用边界**：只有当命令作为常驻/悬浮按钮暴露在块上时，Block Filter 才有真正震撼的意义（未完成显示【完成】按钮，完成后按钮自动隐去或切换为【重置】）。
- **避坑绝招 (虚拟挂载)**：彻底摒弃在文档里用 API 频繁创建/删除物理 Block 按钮的旧路，采用 **Virtual Button 动态挂载**。Block Filter 计算为 `true` 时动态呈现，`false` 时无痕消隐，**绝对不向 `.sy` 文档写入垃圾 Block，不污染 Undo/Redo 历史记录**。

### 3.2 Block Filter 条件语法 Schema (白盒低心智)
- **属性检测**：`custom-status == pending` / `custom-priority == high`
- **内容检测**：`content includes [ ]` (未完成待办)
- **空值检测**：`isEmpty(custom-status)` / `isNotEmpty(custom-status)`

---

## 4. 数据结构 Schema 落地 (`Manual` 列 JSON)
扩展 JSON 结构，支持 `elevation` (展现形态) 与 `filter` (提拔条件)：

```json
[
  {
    "id": "plugin-index.command.safeUpdateBlock",
    "params": { "data": "已完成" },
    "elevation": "virtual_button",
    "filter": "custom-task-status == 'pending'"
  },
  {
    "id": "plugin-index.command.openTarget",
    "elevation": "real_button",
    "targetPage": "Dashboard",
    "passContext": true
  },
  {
    "id": "plugin-index.command.fireworks",
    "elevation": "always_menu"
  }
]
```

### 4.2 配置界面 UI 改动规划 (`IconMenuConfigDialog.svelte`)

在 Supertag 绑定命令配置弹窗中，为用户提供 3 态展现形态选择器：

1. **`📋 默认收纳 (Menu & ;; Panel)`**：收纳在右键菜单与 `;;` 面板中，不占块常驻空间。
2. **`👻 虚拟浮动按钮 (Virtual Button)`**：
   - 展开 **Node Filter 可视化构造器** (提供常用 Pill 胶囊一键插入，如 `[ custom-status == pending ]`)。
3. **`🧱 物理实体按钮 (Real Button)`**：
   - 展开 **高级生成参数配置**：
     - **生成位置**：`[ 当前块下方 ]` / `[ 指定 Dashboard 仪表盘 ]`
     - **探针机制**：`[ 绑定当前 BlockID (originBlockId) ]`
     - **点击后动作**：`[ 更新源块属性 ]` / `[ 分屏打开源块 ]`

---

## 5. 小结与后续步调

本规划完成了从单一实体按钮向 **“虚拟挂载 + 物理探针 + 3 态分流”** 现代架构的升级。后续开发时将优先落实 `;; Panel` 唤起浮层与 `Virtual Button` 的 Protyle 动态组件挂载。
