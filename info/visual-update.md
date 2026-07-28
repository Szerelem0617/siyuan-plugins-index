# IndexOS 极客 UI/UX 工业视觉重构规范与架构方案

本文档记录 IndexOS 全局视觉重构（Geek Tech Industrial Redesign）的设计规范、CSS 架构规划、Token 映射体系及落地方案。

---

## 🎨 一、 极客视觉设计规范 (Geek Tech Design System)

### 1. 色彩与材质 (Color & Materiality)
采用带有金属质感的冷灰蓝调，降低背景彩度，提升高光与状态指示灯的纯度，打造如雕琢过般的精密机械感。

* **主背景层 (`Base Background`)**: `#0F172A`（经典 Slate 钛蓝）
* **次级容器 (`Surface Background`)**: `#1E293B`（钛合金次级面板）
* **文字主色 (`Main Text`)**: `#F8FAFC`（高纯度冷白）
* **文字次色 (`Muted Text`)**: `#64748B`（低饱和石墨蓝）
* **核心高光色 (`Accent Sky`)**: `#38BDF8`（Sky Blue 霓虹高光点亮）
* **微光电光蓝 (`Accent Neon`)**: `#0EA5E9`（边缘流光点缀）
* **材质渐变 (`Titanium Texture`)**: `linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)`

### 2. 几何与边缘 (Geometry & Edges)
* **极小圆角**: 主要面板统一使用 `2px` – `4px` 圆角；代码终端、Command 控制台强制 `0px` 直角。
* **单像素高光边框**: 废弃大面积漫反射阴影，统一使用 `1px` 微亮边框（如 `rgba(255, 255, 255, 0.1)` 或 `rgba(56, 189, 248, 0.3)`）。
* **倒角切角 (`Beveled Corners`)**: 在品牌 Icon、核心标签与状态 Header 使用 `clip-path: polygon` 倒角切角。

### 3. 深度与光影 (Depth & Self-Luminance)
* **像素级自发光**: 选中态/高亮态采用紧凑微发光（`box-shadow: 0 0 4px rgba(56, 189, 248, 0.6)`），模拟 OLED 像素点亮感。
* **拟玻与高模糊**: 全局浮动层（如命令检索 Palette、TopBar 悬浮层）使用低透明度与高模糊（`backdrop-filter: blur(20px)`）。

### 4. 排版与状态 (Typography & Indicators)
* **双字体系统**: 普通文本使用系统无衬线字体；代码、SQL、Block ID、状态指示器强制使用 **Monospace（等宽字体）**。
* **极小全大写排版 (`Tech Label`)**: 辅助标签与表头采用 `10px–11px` + 全大写（Uppercase）+ 宽字间距（`letter-spacing: 0.1em`）。
* **高饱和状态灯**: Status Indicator 采用高饱和霓虹色（Success `#10B981`, Warning `#F59E0B`, Error `#EF4444`），如同精密仪器上的信号灯。

---

## 🏛️ 二、 代码架构与零依赖方案 (CSS Architecture)

### 1. 框架选型思考
* **结论**: **零第三方 CSS 库引入 (0 Extra Bundle Size)**。
* **放弃 Tailwind / Component UI 库的理由**:
  1. 会增加 50KB ~ 200KB 不等的构建打包体积。
  2. 易引发思源原生 `:root` 主题样式冲突或 Reset 破坏。
  3. 极客工业设计（如单像素高光、倒角切角、OLED 发光）在通用 CSS 框架中很难原生表达。
* **实现机制**: 原生 Vanilla CSS + CSS Variable Token 驱动 + Svelte 局部 Scope。

### 2. 样式目录划分 (Three-Tier Style Architecture)

```
src/ui/styles/
├── tokens.css       # [Layer 1] 设计 Token (颜色、字体、边框、发光、渐变变量)
├── utilities.css    # [Layer 2] 极客材质与原子类 (钛合金面板、倒角切角、发光点亮)
├── components.css   # [Layer 3] 插件全局通用极客基础组件 (Tech Dialog, Tech Button, Code Input)
└── index.css        # 样式汇总入口 (插件 onload 时动态注入 HEAD)
```

---

## 🔧 三、 灵活调适原则 (Adaptation Principles)

设计规范为指导性原则，在实际落地中遵循以下适度调适：

1. **思源主题兼容性**：
   - 极客控制面板（如 SQL 控制台、Supertag 编排器、Command-DB）采用 **Dark-First 钛蓝沉浸模式**（与 Chrome DevTools / Raycast 保持一致）。
   - 编辑器内嵌入样式（如 Supertag 胶囊、斜杠建议框）保留对思源日间/夜间主题变量的柔和映射，防止破坏原生阅读体验。
2. **渐进式重构**：
   - 第一阶段：建立 `src/ui/styles/` Token 系统并注入。
   - 第二阶段：重构 SQL 运维终端与 Commands 管理面板 (`sqlite-status.svelte`)。
   - 第三阶段：重构 Supertag 管理器与规则配置弹窗 (`supertag-manager-dialog.svelte`)。
   - 第四阶段：重构全局命令选择器 (`command-palette.ts`) 与 `#` 悬浮建议框 (`tag-suggestion.ts`)。
