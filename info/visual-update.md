# IndexOS 极客 UI/UX 工业视觉重构规范与架构方案

本文档记录 IndexOS 全局视觉重构（Geek Tech Industrial Redesign）的设计规范、CSS 架构规划、Token 映射体系及落地方案。

---

## 🎨 一、 极客视觉设计规范 (Geek Tech Design System)

### 1. 色彩与材质 (Color & Materiality)
插件支持全自动双主题映射，在极客工业风基调下，兼顾暗黑沉浸与日间高对比度控制台体验：

#### ☀️ 浅色主题 (Light Mode - Industrial Geek Tech 工业控制台规范)
* **弹窗大背景 (`--indexos-bg-base`)**: `#EBF2F7`（冰灰蓝底色：拉开对比沉降感，作为沉静的底层舞台）
* **列表主容器卡片 (`.tag-list-container` / `--indexos-bg-container`)**: `#FFFFFF`（高光纯白提亮！搭配 `1px solid rgba(40, 81, 127, 0.18)` 精密微边框 + `4px` 硬朗极小圆角）
* **列表单行 (`.b3-list-item`)**: `border-bottom: 1px solid rgba(40, 81, 127, 0.08)` 分割线；Hover 时呈现 `#F0F7FF` 碧落浅色衬底
* **文字主色 (`--indexos-text-main`)**: `#0F243B`（深海蓝黑：皇家蓝极暗衍生色，替代纯黑，清晰高对比度）
* **文字次色 (`--indexos-text-muted`)**: `#5A7A95`（石墨蓝灰：用于代码行号、Monospace 标签与表头）
* **表头控制台排版 (`.table-header`)**: 强制使用 `Monospace` + `11px` + `600` + `UPPERCASE` + `letter-spacing: 0.08em` + `#5A7A95`
* **数据文本与 ID (`.tag-name`, `.bind-info`)**: 强制启用 `Monospace` + `#0F243B`
* **核心高光/Primary 按钮 (`--indexos-accent-primary` / `.btn-primary`)**: `#28517F`（皇家蓝原色填充 + `#FFFFFF` 纯白字 + `3px` 硬朗圆角）
* **Active Tab & Count 胶囊**: Tab 使用 `#28517F` 700 粗字与 `2px` 皇家蓝指示线；胶囊使用 `#EBF5FE` 碧落浅色背景 + `#28517F` 文字
* **Switch 开关与 Tag 图标**: 开启态使用皇家蓝 `#28517F` 点缀

#### 🌙 深色主题 (Dark Mode - Dark Titanium Slate 钛蓝赛博风)
* **主背景层 (`--indexos-bg-base`)**: `#0F172A`（经典 Slate 钛蓝）
* **次级容器 (`--indexos-bg-surface`)**: `#1E293B`（钛合金次级面板）
* **文字主色 (`--indexos-text-main`)**: `#F8FAFC`（高纯度冷白）
* **文字次色 (`--indexos-text-muted`)**: `#94A3B8`（低饱和石墨蓝）
* **核心高光色 (`--indexos-accent-primary`)**: `#38BDF8`（Sky Blue 霓虹高光点亮）

---

## 🏛️ 二、 代码架构与零依赖方案 (CSS Architecture)

### 1. 框架选型
* **零第三方 CSS 库引入 (0 Extra Bundle Size)**。
* 原生 Vanilla CSS + 双主题 CSS Variable Token 驱动 (`src/ui/styles/tokens.css`) + Svelte 全域覆盖。

### 2. 样式目录划分 (Three-Tier Style Architecture)

```
src/ui/styles/
├── tokens.css       # [Layer 1] 设计 Token (双主题色彩、字体、边框、高光变量)
├── utilities.css    # [Layer 2] 极客材质与原子类 (双主题强 Style 对话框、弱 Style 编辑器浮层)
├── components.css   # [Layer 3] 插件全局通用极客基础组件
└── index.css        # 样式汇总入口 (插件 onload 时动态注入)
```
