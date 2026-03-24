# 思源笔记插件命令与 UI 注册入口汇总

基于对思源笔记 v3.5.10 源码（`app/src/plugin/index.ts` 及 `index.d.ts`）的分析，以下是插件可以注册命令、菜单和 UI 元素的官方及隐性入口。

## 1. UI 注册 API (Plugin 类内置方法)

这些方法是 `Plugin` 基类直接提供的标准接口，用于在主界面注入 UI。

| API 方法 | 说明 | 应用场景 |
| :--- | :--- | :--- |
| `addTopBar(options)` | 在顶栏（左侧或右侧）添加图标按钮。 | 插件主入口、快速操作按钮。 |
| `addStatusBar(options)` | 在页面底部状态栏添加 HTML 元素。 | 显示实时状态、后台任务进度。 |
| `addDock(options)` | 注册一个侧边栏面板（类似文件树、大纲）。 | 复杂的持久化管理视图、辅助工具栏。 |
| `addTab(options)` | 注册一个可以在中心区域打开的自定义页签。 | 独立的编辑页、数据看板。 |
| `addIcons(svg)` | 注册自定义 SVG 图标库。 | 为插件按钮提供视觉资源。 |
| `addFloatLayer(options)` | 触发一个悬浮预览层。 | 快速预览块、引用、备注。 |

## 2. 逻辑与编辑器钩子 (Plugin 类属性/方法)

插件可以通过重写或修改以下属性来深度介入编辑器行为。

| 钩子名称 | 类型 | 说明 |
| :--- | :--- | :--- |
| `addCommand(ICommand)` | 方法 | 注册全局/局部快捷键，并出现在“命令面板”中。 |
| `protyleSlash` | 数组属性 | 注册 `/` 斜杠命令。用户在编辑器输入 `/` 时弹出。 |
| `updateProtyleToolbar` | 方法重写 | 修改编辑器上方的浮动工具栏（B/I/U 菜单）。 |
| `customBlockRenders` | 映射属性 | 注册自定义块渲染逻辑（用于自定义块类型或增强现有块）。 |

## 3. EventBus 事件钩子 (深度扩展入口)

这是插件最强大的扩展方式，通过 `this.eventBus.on(event, callback)` 监听。

### 📌 菜单类事件 (ContextMenu)
通过监听这些事件，可以在思源的原生菜单中注入自定义的 `MenuItem`。
- `click-blockicon`: 点击块侧边（Gutter）的图标时触发。**（Supertag 逻辑常用入口）**
- `open-menu-av`: 数据库（属性视图）菜单打开时。
- `open-menu-doctree`: 文档树（左侧目录）右键菜单。
- `open-menu-content`: 编辑器正文右键菜单。
- `open-menu-blockref`: 块引用菜单。
- `open-menu-tag`: 标签菜单。
- `open-menu-link`: 链接菜单。
- `open-menu-image`: 图片菜单。
- `open-menu-breadcrumbmore`: 面包屑“更多”菜单。
- `open-menu-inbox`: 收集箱菜单。

### 📌 交互类事件
- `switch-protyle`: 切换页签（文当）时触发。**（核心：用于更新 UI 状态）**
- `loaded-protyle-static`: 文档静态内容加载完毕后。
- `loaded-protyle-dynamic`: 文档动态（通过网络或流）载入后。
- `destroy-protyle`: 文档页签关闭前。
- `paste`: 拦截并处理粘贴行为。
- `input-search`: 监听全局搜索框的输入。

### 📌 系统/数据类事件
- `ws-main`: **终极监听器**。监听思源 WebSocket 推送的所有事务（Transaction）。可以捕获到任何文档、属性、文件的增删改查。
- `sync-start / sync-end / sync-fail`: 云端同步状态监听。
- `opened-notebook / closed-notebook`: 笔记本开启或关闭。
- `code-language-change`: 代码块语言改变时。

## 4. 其它隐性入口

### 🔗 URL 协议 (Protocol Handlers)
- `open-siyuan-url-plugin`: 允许通过浏览器或外部链接 `siyuan://plugins/[plugin_name]/...` 唤起插件逻辑。

## 5. 架构分类：插槽家族 (Family Slots) 系统

为了避免单一字段过载，我们将入口划分为四大“家族”。每个家族在数据库中体现为一个独立的字段，通常为多选（Checkbox）或文本。

### 🌍 Layer 2: Command-DB (Global 基础设施层)

| 家族字段 | 选项 (Options) | 说明 |
| :--- | :--- | :--- |
| **按钮位 (UI Buttons)** | `Top Bar`, `Dock`, `Status Bar` | 物理存在的、可见的按钮图标。 |
| **召唤位 (Access)** | `Palette`, `Global Hotkey`, `Protocol` | 隐藏但随时可调起的指令入口。 |
| **驱动位 (Drivers)** | `Startup`, `Timer`, `WS Monitor` | **静默/幕后**执行的自动化逻辑。 |
| **定时配置 (Timer CFG)** | `Cron 表达式 / 间隔秒数` | **【独立文本列】** 用于配置 Timer 家族的频率。 |

### 📍 Layer 3: Type-DB (Local 语义逻辑层)

| 家族字段 | 选项 (Options) | 说明 |
| :--- | :--- | :--- |
| **菜单位 (Menus)** | `Gutter`, `Text Context`, `Tag Menu` | 鼠标点击触发的交互扩展。 |
| **流式位 (Flows)** | `Slash`, `Floating Toolbar`, `Context Hotkey` | 在写作流、编辑流中无缝调出的逻辑。 |
| **联动位 (Hooks)** | `Auto-Sync`, `On Paste`, `On Loaded` | **反应式逻辑**。根据文档状态切换自动触发。 |
| **策略逻辑 (Policy)** | `JSON / Filter String` | **【独立文本列】** 用于配置复杂钩子的触发条件。 |

---

## 6. 用户配置示例流程

### 场景 A：全局“闪念胶囊” (Global)
- **Layer 2 (Command-DB)** 配置：
    - **按钮位**: 勾选 `Top Bar`
    - **召唤位**: 设置快捷键 `Alt+C`
- **结果**: 顶栏出现药丸图标，随时按 `Alt+C` 也能闪现收集框。

### 场景 B：项目自动同步功能 (#Project) (Local)
- **Layer 3 (Type-DB)** 配置：
    - **菜单位**: 勾选 `Gutter` (手动入口)
    - **联动位**: 勾选 `Auto-Sync` (静默联动)
- **结果**: 打标 `#Project` 后，系统自动后台入库。

### 场景 C：周报自动提醒 (Timer)
- **Layer 2 (Command-DB)** 配置：
    - **驱动位**: 勾选 `Timer`
    - **定时配置**: `0 9 * * 1` (每周一早上 9 点)
- **结果**: 每周一早晨自动弹出周报生成提示。
