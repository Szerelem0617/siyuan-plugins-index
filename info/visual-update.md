# IndexOS 极客 UI/UX 工业视觉重构规范与架构方案

本文档记录 IndexOS 全局视觉重构（Geek Tech Industrial Redesign）的设计规范、CSS 架构规划、Token 映射体系及落地方案。

---

## 🎨 一、 极客视觉设计规范 (Geek Tech Design System)

### 1. 1:1 镜面对称 Token 体系 (Mirrored Dual-Theme Architecture)

#### ☀️ LIGHT MODE (Industrial Geek Tech 浅色控制台)
* **弹窗/页面大底色 (`--indexos-bg-base`)**: `#EBF2F7`（灰蓝沉降底层）
* **次级面板 (`--indexos-bg-surface`)**: `#F4F8FA`
* **核心数据列表卡片 (`--indexos-bg-container`)**: `#FFFFFF`（纯白提亮）
* **选中行 / Hover 衬底 (`--indexos-bg-highlight`)**: `#F0F7FF`
* **1px 皇家蓝微边框 (`--indexos-border-light`)**: `rgba(40, 81, 127, 0.15)`
* **单行分割线 (`--indexos-border-divider`)**: `rgba(40, 81, 127, 0.08)`
* **主文本 (`--indexos-text-main`)**: `#0F243B`（深海蓝黑）
* **次要文本 / Monospace 表头 (`--indexos-text-muted`)**: `#5A7A95`（石墨灰蓝）
* **Primary 按钮 / Active 指示 (`--indexos-accent-primary`)**: `#28517F`（皇家蓝原色）
* **Primary 按钮文字 (`--indexos-btn-primary-text`)**: `#FFFFFF`（纯白字）
* **Count 胶囊/标签衬底 (`--indexos-accent-badge-bg`)**: `#EBF5FE`
* **Count 胶囊/标签文字 (`--indexos-accent-badge-text`)**: `#28517F`

#### 🌙 DARK MODE (Dark Titanium Slate 深色钛蓝赛博)
* **弹窗/页面大底色 (`--indexos-bg-base`)**: `#0B1120`（深邃钛黑蓝）
* **次级面板 (`--indexos-bg-surface`)**: `#0F172A`（Slate 钛蓝）
* **核心数据列表卡片 (`--indexos-bg-container`)**: `#1E293B`（钛合金面板提亮 #1E293B）
* **选中行 / Hover 深蓝微高光衬底 (`--indexos-bg-highlight`)**: `#2A3B53`
* **1px 电光微亮边框 (`--indexos-border-light`)**: `rgba(56, 189, 248, 0.20)`
* **单行分割线 (`--indexos-border-divider`)**: `rgba(255, 255, 255, 0.08)`
* **主文本 (`--indexos-text-main`)**: `#F8FAFC`（高纯度冷白）
* **次要文本 / Monospace 表头 (`--indexos-text-muted`)**: `#94A3B8`（钛灰）
* **Primary 按钮 / Active 指示 (`--indexos-accent-primary`)**: `#38BDF8`（Sky Blue 霓虹高光）
* **Primary 按钮文字 (`--indexos-btn-primary-text`)**: `#0B1120`（钛深黑字，高对比度）
* **Count 胶囊/标签衬底 (`--indexos-accent-badge-bg`)**: `rgba(56, 189, 248, 0.15)`
* **Count 胶囊/标签文字 (`--indexos-accent-badge-text`)**: `#38BDF8`

---

## 🏛️ 二、 4 大跨主题落地法则 (Mirroring Rules)

1. **组件级类名“零逻辑分支”**：所有组件 CSS 100% 依赖 `var(--indexos-*)` 变量驱动，不再写主题分支；
2. **几何骨架 1:1 统一**：弹窗/卡片统一 `4px` 圆角，按钮/胶囊统一 `3px` 或 `2px`；
3. **Monospace 等宽控制台基因**：数据、ID、表头全全使用等宽字体；
4. **Primary 按钮文字反色**：浅色模式下配 `#FFFFFF` 纯白字；深色模式下配 `#0B1120` 钛深黑字，极度清晰舒适！
