# IndexOS: Supertag 命令触发架构与上下文指南

本文档定义了 IndexOS 系统中将命令绑定到 Supertag（超级标签/属性）的所有可能触发机制。涵盖了不同维度的触发位置、可获取的 Context（上下文）参数以及实现建议。

---

## 1. 触发位置与上下文映射 (Context Mapping)

### A. 块级触发 (针对特定 Block ID)
这些触发方式直接作用于内容块，能够精准获取当前块的 ID 和属性。

| 触发位置 | 类型 | 上下文参数 (Context) | 建议程度 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| **块图标菜单 (Gutter)** | 主动 | `blockIDs[]`, `protyle` | **核心 (S)** | 通过 `click-blockicon` 监听。支持批量处理。 |
| **Slash 命令 (/)** | 主动 | `nodeElement`, `protyle` | **核心 (S)** | 注册于 `protyleSlash`。发现性最强，适合插入组件。 |
| **属性视图 (AV) 关联列** | 主动 | `rowID`, `avID`, `blockIDs[]` | **核心 (S)** | 专门用于“点击执行”。关系列是存储命令 ID 的最佳地点。 |
| **自定义语法 (如 `;;`)** | 主动 | `matchedText`, `cursorOffset` | **高级 (A)** | 利用 `protyle.hint.extend` 实现。比 Slash 更高效。 |
| **气泡工具栏 (Bubble)** | 主动 | `range`, `parentBlockID` | **次要 (B)** | 文本选区后弹出。适合“提取选区到卡片”等逻辑。 |
| **粘贴行为 (Paste)** | 钩子 | `clipboardData`, `targetID` | **高级 (A)** | 监听 `paste` 事件。可自动识别链接、代码并打标。 |
| **快捷键 (Hotkey)** | 主动 | `focusedBlockID`, `protyle` | **高级 (A)** | 全局或局部快捷键。需通过 API 获取当前焦点块。 |
| **视口滚动 (Scroll)** | 隐式 | `blockID`, `viewDuration` | **实验 (C)** | 监测块进入视野的时长。可用于阅读统计。 |

### B. 页面级触发 (针对当前文档 Document)
这些触发方式侧重于文档全局状态、元数据或项目流转。

| 触发位置 | 类型 | 上下文参数 (Context) | 建议程度 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| **文档标题菜单** | 主动 | `docID`, `protyle` | **核心 (S)** | `open-menu-breadcrumbmore`。适合重置页面属性。 |
| **文件树右键菜单** | 主动 | `targetPath`, `docIDs[]` | **核心 (S)** | 支持对单个或多个文档进行自动化处理。 |
| **外部协议 (URI)** | 外部 | `urlParams` (Query 键值对) | **必备 (S)** | `siyuan://plugins/index-os/exec?cmd=xxx&id=yyy`。联动 iOS/Alfred。 |
| **文档切换 (Switch)** | 钩子 | `fromDocID`, `toDocID` | **高级 (A)** | 切换页面时自动更新右侧栏、更换 UI 主题或播放音效。 |
| **页面加载 (OnLoad)** | 生命周期| `docAttributes (IAL)` | **高价值 (A)**| 页面完全渲染后执行。可自动弹出该角色的状态看板。 |
| **统计指标 (Passive)** | 隐式 | `typingSpeed`, `docID` | **实验 (C)** | 根据打字速度触发特殊视觉效果（如心流模式变色）。 |

---

## 2. 触发逻辑实现建议

### S级：系统基石 (必须实现)
- **块菜单与 AV 关联列**：这是最稳健的 ID 获取方式。关联列应支持“下拉选择命令”，实现类似于 Notion Button 的效果。
- **Slash 命令**：IndexOS 的“原子插入”入口（如插入一个状态条、一个属性表）。
- **外部 URI 协议**：这是打通移动端和自动化流（iOS 快捷指令、浏览器快捷剪藏）的关键，必须确保协议解析逻辑足够健壮。

### A级：进阶体验 (高度推荐)
- **`;;` 自定义语法**：强烈建议作为默认配置。相比 `/` 的全局混杂，`;;` 专门服务于 IndexOS 内部指令（如 `;;hp+5`），录入速度极快。
- **自动化钩子 (OnBind/Unbind)**：当一个块被打上特殊 Supertag 时，自动为其添加默认属性值或在后台触发一次 API 调用（如同步到日历）。
- **页面加载逻辑**：用于构建“情境感知”笔记。打开 #项目 标签的页时，自动展示进度条；打开 #人物 标签的页时，自动计算等级。

### C级：实验性 (按需谨慎实现)
- **打字速度/心流监测**：这属于有趣但不稳定的“游戏化”功能。应仅作为视觉辅助，不要承载核心的业务逻辑，避免因监听过重导致编辑器卡顿。
- **滚动监测**：用于“完成阅读”统计，但需注意在长文档中频繁滚动可能带来的计算开销。

---

## 3. 统一命令上下文 (CommandContext) 规范化

为了确保命令可以在上述所有位置通用，触发器必须将原始事件标准化为以下 `CommandContext` 对象发往 `Dispatcher`：

```typescript
/**
 * IndexOS 统一命令执行上下文
 */
interface CommandContext {
    targetId: string;           // 核心操作目标 ID (BlockID 或 DocID)
    scope: "block" | "page";    // 执行作用域：块级还是页面级
    triggerSource: string;      // 来源：'gutter' | 'slash' | 'uri' | 'av' | 'pattern' 等
    
    // 执行环境
    protyle?: IProtyle;         // 当前 UI 实例（用于执行插入、弹窗等交互）
    
    // 携带参数
    payload: {
        text?: string;          // 匹配到的语法文本（如 "hp+1"）
        params?: Record<string, string>; // 外部 URI 或按钮定义的参数对
    };
    
    // 元数据快照 (根据需要延迟获取)
    attributes?: Record<string, string>; // 操作目标的 IAL 属性快照
}
```

---

*更新日期：2026-04-02*  
*IndexOS 开发者手册 - 命令触发专卷*
