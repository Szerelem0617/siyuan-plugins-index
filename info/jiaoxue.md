# 教学插件 (Teaching Plugin) 架构与头脑风暴

> 基于现有 Python 桌面程序 `physdb_python` 的功能分析，结合思源笔记生态与 IndexOS ECS 架构，设计下一代教学辅助插件。

---

## 一、现有 Python 项目功能拆解

### 1.1 备课程序 (main.py) — 课前

| 功能模块 | 实现方式 | 核心数据 |
|:---|:---|:---|
| **题库搜索** | SQLite 全文搜索 MCQ/SQ，支持关键词+号连接、级别过滤 | `physdb.db` (8.8MB) |
| **收藏树管理** | JSON 树结构：`Lessons → Module → Lesson → Topic → Segment`；`Students → Class → Student` | `favorites.json` (933KB) |
| **图片/视频收藏** | 拖拽/粘贴上传到分支 + 双份存储 (本地+widget) | `uploaded_images/`, `uploaded_videos/` |
| **文字笔记** | 纯文本笔记，按 NOTE_ID 分割存储在 `all_notes.txt` | `notes/all_notes.txt` |
| **Richtext 注释** | 每个收藏项可附加富文本注释 | `notes/all_richtext.txt` |
| **标签系统** | 对 segment 层级的收藏打标（evo_formation 等进化标签） | 内嵌在 favorites.json |

### 1.2 上课程序 (widget_main.py) — 课中

| 功能模块 | 实现方式 | 说明 |
|:---|:---|:---|
| **悬浮窗** | `Qt.WindowStaysOnTopHint` + 半透明背景 | 始终在最前，不遮挡主屏 |
| **段落导航** | 按 Topic/Segment 列表过滤 + 键盘上下翻页 | 按 essential/optional/ignored 优先级过滤 |
| **图片预览** | hover 预览按钮触发，支持滚动大图 | 复制后自动跳转下一未复制项 |
| **文字预览** | hover 笔记按钮触发 | 同样支持复制+自动推进 |
| **转盘选人** | 物理模拟转盘 (StudentWheelWidget)，支持拖拽旋转 | Space 键偏向选择功能 |
| **快捷键评分** | a/b/c/d/e 快速记录学生表现到 Excel | 简写字典展开为完整评语 |
| **反馈录入** | 选中学生 → 快捷键 → 写入 Excel 对应行列 | 按知识点列+学生行定位 |

### 1.3 自动反馈 (autofeedback/) — 课后

| 功能模块 | 实现方式 | 说明 |
|:---|:---|:---|
| **通用反馈生成** | DeepSeek API 生成知识点总结+课堂内容概要 | 基于知识树 + 课堂记录 |
| **学生个性反馈** | DeepSeek API 为每个学生生成个性化课堂表现评语 | 140-160字，含学术英文 |
| **Excel 模板** | openpyxl 读写 xlsx 模板文件 | 按行列定位写入反馈 |
| **知识树参考** | 硬编码物理/生物 IG/AL 知识树 | 用于 LLM 上下文参考 |

---

## 二、迁移到思源插件的架构映射

### 2.1 核心思路：笔记即数据库

Python 版的痛点：
- `favorites.json` 是私有格式，不可搜索、不可跨应用
- 图片是文件系统副本，与笔记内容割裂
- 知识树硬编码在代码里，不能动态编辑
- Excel 反馈文件是独立产物，不与知识体系关联

**思源版的优势**：
- 知识树 = 文档树/大纲，天然可编辑
- 题目/图片 = 思源块，可引用、可搜索、可双链
- 收藏分支 = 属性视图 (AV) 数据库行
- 学生记录 = AV 数据库行，与知识点列交叉
- 反馈 = 文档块，可追溯、可版本控制

### 2.2 数据模型映射表

| Python 概念 | 思源映射 | 存储方式 |
|:---|:---|:---|
| `Lessons` 树 | **课程笔记本** 下的文档树 (Module → Lesson → Topic → Segment) | 思源文档层级 |
| `Students` 树 | **学生 AV 数据库**，每行=一个学生，列=属性 | Attribute View |
| `favorites.json` 分支收藏 | **教学资源 AV**，每行=一个资源块的引用 | AV + 块引用 |
| 题目图片 | **思源资源文件** (assets/) 或嵌入块 | 思源原生 |
| 文字笔记 | **嵌入块/子块** 在对应 Segment 文档下 | 思源原生 |
| Excel 反馈记录 | **课堂记录 AV**，行=学生，列=知识点+表现 | AV + SQLite 索引 |
| 知识树 (ktree) | **课程文档树本身** + 块属性标记 | 文档结构 + 自定义属性 |

### 2.3 与 IndexOS 四层架构的集成

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 教学命令注册                                        │
│  teach.search / teach.startLesson / teach.pickStudent /     │
│  teach.grade / teach.generateFeedback                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 命令变体 (Command-DB)                               │
│  "搜索MCQ" / "搜索SQ" / "开始授课-物理IG" / "生成周报"          │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 教学类注册 (Type-DB)                                │
│  #KnowledgePoint → [teach.grade, teach.search]              │
│  #Student → [teach.grade, teach.generateFeedback]           │
│  #LessonPlan → [teach.startLesson]                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 数据库配置                                          │
│  Student-DB: {name, class, linked_module, performance}      │
│  Resource-DB: {block_ref, type, label, priority}            │
│  Session-DB: {date, class, topic, records[]}                │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、核心功能规划（已有 + 新增）

### 3.1 已有功能迁移（6 个）

#### F1: 知识树管理与备课资源匹配

**Python 原有**: 搜索题库 → 收藏到 Lesson/Topic/Segment → 打标 label

**思源版设计**:
- 用户在课程笔记本中正常编写知识树（文档层级 = Module/Lesson/Topic/Segment）
- 用 `#KnowledgePoint` 类标记关键块
- 搜索题库？→ 思源本身就是搜索引擎，题目可以是思源文档/块
- "收藏" = 在该 Segment 文档下创建块引用指向题目
- Priority（essential/optional/ignored）= 块属性或 AV 列

**价值**: ★★★★★ — 这是基础，没有它其他功能都无法运作

#### F2: 课中教学面板 (Floating Lesson Panel)

**Python 原有**: Qt 悬浮窗展示备课图片/笔记，hover 预览

**思源版设计**:
- 使用思源 `Dialog` 或自定义 `Dock` 面板作为教学面板
- 面板内嵌 Protyle 编辑器只读渲染当前 Segment 内容
- 支持全屏/画中画模式（`Window.open()` 弹出独立窗口）
- 按钮控制：上一段/下一段、复制当前图片、切换预览模式
- 内容源：当前选中 Lesson 文档下的 Topic → Segment 按序展示

**价值**: ★★★★★ — 课堂核心工具

#### F3: 转盘选人与点名系统

**Python 原有**: 物理模拟转盘，支持偏向选择

**思源版设计**:
- 在教学面板中用 Canvas/SVG 实现转盘动画
- 学生列表从 Student-DB (AV) 读取，按当前班级过滤
- 选中后自动高亮该学生行，方便后续评分
- 偏向选择：根据历史答题次数自动加权（答少的概率更高）
- 可选：简单随机列表模式（无动画，更快）

**价值**: ★★★★☆ — 互动性强，但技术难度中等

#### F4: 快捷评分与课堂记录

**Python 原有**: 快捷键 a/b/c/d 记录表现到 Excel

**思源版设计**:
- 教学面板中选中学生后，侧边展示评分快捷面板
- 预定义评分模板（如 a=答对, b=引导后答对, c=混淆, d=答错, e=不认真）
- 评分数据写入 **Session-DB (AV)**，行=学生×知识点
- 支持自定义评分维度（不限于 a-e）
- 语音转文字集成：按住录音按钮 → Web Speech API / Whisper 转文字 → 作为补充评语

**价值**: ★★★★★ — 课堂效率的核心差异化功能

#### F5: 语音转文字 (Speech-to-Text)

**Python 原有**: 无（需求中提到的新功能）

**思源版设计**:
- 使用 Web Speech API (`SpeechRecognition`) 实现浏览器端短语音识别
- 按住按钮录音 → 松开后转文字 → 插入到当前学生的评分备注
- 备选方案：调用 Whisper API 做更准确的转录
- 转录的文字自动追加到 Session-DB 对应单元格

**价值**: ★★★★☆ — 解放双手，但依赖浏览器/API 支持

#### F6: LLM 自动生成课后反馈

**Python 原有**: DeepSeek API 生成通用反馈 + 学生个性化反馈

**思源版设计**:
- 命令 `teach.generateFeedback`，输入：Session-DB 某次课的所有记录
- 调用 LLM API（可配置：DeepSeek / OpenAI / 本地模型）
- 生成两类内容：
  1. **知识点总结**：基于课程文档树自动提取知识树上下文
  2. **学生个性反馈**：基于该学生本次课的评分记录 + 知识点
- 输出写入思源文档（可选 AV 列），支持人工编辑修改
- 一键导出为 Excel/PDF（兼容原有反馈模板格式）

**价值**: ★★★★★ — 课后流程的巨大效率提升

---

### 3.2 新增功能头脑风暴（3 个核心功能）

#### F7: 知识点掌握度热力图 (Knowledge Mastery Heatmap)

**概念**:
将知识树的每个节点（Topic/Segment）在所有学生维度上的答题正确率可视化为热力图。横轴=知识点，纵轴=学生，颜色深浅=掌握度。

**实现细节**:
- 数据源：Session-DB 所有课堂记录，按知识点 × 学生交叉汇总
- 汇总逻辑：
  - 绿色 = 多次答对（≥2次答对且无答错）
  - 黄色 = 有混淆但最终答对
  - 红色 = 多次答错或从未被考查
  - 灰色 = 未涉及
- 可视化：用 SVG/Canvas 在 Dock 面板或独立窗口中渲染
- 交互：
  - 点击某个格子 → 展开该学生在该知识点的所有历史记录
  - 右键 → 生成该知识点的补充练习建议
  - 选一行（学生） → 生成个性化复习计划
  - 选一列（知识点） → 查看全班掌握情况统计

**价值评估**: ★★★★★
- **实现价值极高**：这是从"记录"到"洞察"的质变。Python 版的 Excel 数据其实已经有了，但缺少可视化和交互
- **技术可行性**：中等。核心是 SQLite 聚合查询 + SVG 渲染，不依赖外部服务
- **差异化**：市面上几乎没有针对小班/一对多教学的知识点级掌握度追踪工具

#### F8: 选择题实时互动系统 (Live Quiz System)

**概念**:
课堂中发起即时选择题/判断题，学生通过手机/平板扫码作答，教师端实时看到统计结果。答完后平台自动判题（选择题）或 LLM 判题（简答题），自动录入成绩。

**实现细节**:
- 教师端：
  - 从当前 Segment 的备课资源中选一道题 → 发起 Quiz
  - 教学面板显示题目 + 实时统计图（柱状图/饼图）
  - 截止答题后显示正确率 + 每位学生的答案
  - 自动将答题结果写入 Session-DB
- 学生端：
  - 方案 A（简单）：思源挂件 widget 生成二维码，学生手机扫码打开简易网页答题
  - 方案 B（进阶）：WebSocket 实时通信，实现类 Kahoot! 体验
  - 方案 C（最简）：无学生端，教师口头提问 → 转盘选人 → 手动判定 a/b/c/d（保留现有流程）
- 判题逻辑：
  - 选择题：标准答案比对（从 AV 的 answer 列读取）
  - 简答/大题：调用 LLM API，输入题目+标准答案+学生答案 → 输出评分+点评

**价值评估**: ★★★★☆
- **实现价值高**：选择题判题自动化节省大量时间，简答LLM判题是创新点
- **技术可行性**：
  - 方案 C（最简）几乎零成本，就是现有流程的数字化
  - 方案 A（扫码答题）需要一个简单的 HTTP/WebSocket 服务端，思源插件可以开 Express 端口
  - 方案 B（实时Kahoot）复杂度最高但体验最好
- **建议**：Phase 1 做方案 C，Phase 2 做方案 A

#### F9: 课堂时间线与回顾系统 (Session Timeline & Replay)

**概念**:
自动记录一堂课的完整时间线：什么时间讲了哪个段落、在哪里点名了哪个学生、哪道题全班正确率是多少、哪里花了最多时间。上完课后可以"回放"这堂课的流程。

**实现细节**:
- 自动采集事件：
  - `[T+00:00]` 开始授课，班级=XX，课程=YY
  - `[T+05:23]` 切换到 Segment "Newton's Third Law"
  - `[T+08:15]` 展示题目 MCQ-0625_s24_q12
  - `[T+09:30]` 选人：张同学 → 评分：b（引导后答对）
  - `[T+12:00]` 语音备注："张同学容易混淆作用力和反作用力的方向"
  - `[T+15:00]` 切换到下一 Segment…
- 数据存储：Session-Timeline AV，每行=一个事件，列=timestamp, event_type, detail, related_student, related_topic
- 课后回顾：
  - 时间线视图：竖向时间轴 + 事件卡片
  - 统计摘要：本节课=45min，覆盖 5 个 Segment，点名 8 次，答对率 62%
  - 对比视图：上次同一课程 vs 这次，哪些段落花了更多时间
  - 直接输入 LLM 生成反馈的上下文（替代手动记录）

**价值评估**: ★★★★☆
- **实现价值高**：从"被动记录"到"主动感知"课堂节奏
- **技术可行性**：中等。事件采集简单（每次操作追加记录），时间线可视化用 SVG 即可
- **独特优势**：Python 版完全没有的维度——Python 版只记录了"结果"（谁答了什么），不记录"过程"（什么时候发生的）
- **LLM 协同**：时间线本身就是最好的 LLM prompt 上下文，比简写字典（a/b/c/d）包含更丰富的教学信息

---

## 四、功能优先级与实现价值矩阵

| # | 功能 | 实现价值 | 技术难度 | 优先级 | 依赖 |
|:---|:---|:---|:---|:---|:---|
| F1 | 知识树管理与备课资源匹配 | ★★★★★ | ★★☆☆☆ | **P0** | 无 |
| F2 | 课中教学面板 (悬浮窗) | ★★★★★ | ★★★☆☆ | **P0** | F1 |
| F4 | 快捷评分与课堂记录 | ★★★★★ | ★★★☆☆ | **P0** | F2, F3 |
| F3 | 转盘选人 | ★★★★☆ | ★★☆☆☆ | **P1** | F2 |
| F9 | 课堂时间线与回顾 | ★★★★☆ | ★★★☆☆ | **P1** | F4 |
| F6 | LLM 课后反馈生成 | ★★★★★ | ★★★☆☆ | **P1** | F4, F9 |
| F5 | 语音转文字 | ★★★★☆ | ★★★☆☆ | **P2** | F4 |
| F7 | 知识点掌握度热力图 | ★★★★★ | ★★★★☆ | **P2** | F4 (大量数据积累) |
| F8 | 实时互动答题系统 | ★★★★☆ | ★★★★★ | **P3** | F2, F4 |

---

## 五、插件架构总览

### 5.1 模块划分

```
siyuan-plugin-teaching/
├── src/
│   ├── core/
│   │   ├── plugin.ts              # 插件入口，生命周期管理
│   │   ├── teaching-state.ts      # 全局教学状态机 (idle/preparing/teaching/reviewing)
│   │   └── config.ts              # 配置管理 (LLM API Key, 默认模板等)
│   │
│   ├── features/
│   │   ├── knowledge-tree/        # F1: 知识树管理
│   │   │   ├── tree-parser.ts     # 解析文档树为知识结构
│   │   │   ├── resource-linker.ts # 资源匹配与引用管理
│   │   │   └── priority-system.ts # essential/optional/ignored 过滤
│   │   │
│   │   ├── lesson-panel/          # F2: 教学面板
│   │   │   ├── panel.svelte       # 主面板 UI (Dock/Dialog)
│   │   │   ├── segment-nav.ts     # 段落导航逻辑
│   │   │   ├── preview-engine.ts  # 图片/笔记预览引擎
│   │   │   └── floating-mode.ts   # 画中画/悬浮窗模式
│   │   │
│   │   ├── student-picker/        # F3: 选人系统
│   │   │   ├── wheel.svelte       # 转盘 UI 组件
│   │   │   ├── wheel-physics.ts   # 物理模拟引擎
│   │   │   └── student-db.ts      # 学生数据库接口
│   │   │
│   │   ├── grading/               # F4: 评分系统
│   │   │   ├── grade-panel.svelte # 评分快捷面板
│   │   │   ├── shorthand.ts       # 简写字典管理
│   │   │   ├── session-recorder.ts# 课堂会话记录器
│   │   │   └── session-db.ts      # Session-DB AV 读写
│   │   │
│   │   ├── speech/                # F5: 语音转文字
│   │   │   ├── recorder.svelte    # 录音 UI
│   │   │   └── stt-engine.ts      # Web Speech API / Whisper 适配
│   │   │
│   │   ├── feedback/              # F6: LLM 反馈生成
│   │   │   ├── feedback-panel.svelte # 反馈预览/编辑面板
│   │   │   ├── prompt-builder.ts  # Prompt 构建器（知识树+记录→prompt）
│   │   │   ├── llm-adapter.ts     # LLM API 适配层
│   │   │   └── export.ts          # 导出为 Excel/PDF
│   │   │
│   │   ├── heatmap/               # F7: 掌握度热力图
│   │   │   ├── heatmap.svelte     # 热力图 UI
│   │   │   └── aggregator.ts      # 数据聚合查询
│   │   │
│   │   ├── quiz/                  # F8: 互动答题 (Phase 3)
│   │   │   ├── quiz-host.svelte   # 教师端 Quiz 面板
│   │   │   ├── quiz-server.ts     # 简易 HTTP 答题端点
│   │   │   └── auto-judge.ts      # 自动判题 (规则+LLM)
│   │   │
│   │   └── timeline/              # F9: 课堂时间线
│   │       ├── timeline.svelte    # 时间线可视化
│   │       ├── event-collector.ts # 事件自动采集器
│   │       └── session-replay.ts  # 课堂回放逻辑
│   │
│   ├── data/
│   │   ├── av-schemas.ts          # 所有 AV 数据库的 Schema 定义
│   │   ├── sqlite-index.ts        # SQLite 索引表 (跨 AV 聚合查询)
│   │   └── migration.ts           # 数据迁移 (从 Python 版 JSON 导入)
│   │
│   └── i18n/
│       ├── zh_CN.json
│       └── en_US.json
│
├── widget/                        # 挂件 (可选)
│   └── quiz-answer/               # 学生答题挂件 (扫码后展示)
│       └── index.html
│
└── info/
    └── jiaoxue.md                 # 本文件
```

### 5.2 数据库 Schema 设计

#### Student-DB (学生数据库 AV)

| 列名 | 类型 | 说明 |
|:---|:---|:---|
| **学生名** | block (主键) | 学生块（可包含头像、个人信息） |
| **班级** | select | 所属班级 |
| **关联课程** | relation → Module 文档 | 对应 Lessons 树的 Module |
| **总课时** | rollup | 自动统计参与课时数 |
| **平均掌握度** | number | 由系统计算 |
| **最近出勤** | date | 上次上课时间 |

#### Session-DB (课堂记录 AV)

| 列名 | 类型 | 说明 |
|:---|:---|:---|
| **课堂ID** | block (主键) | 每次上课自动创建的课堂记录块 |
| **日期** | date | 上课日期 |
| **班级** | select | 上课班级 |
| **课程** | relation → Lesson 文档 | 对应哪节课 |
| **时长** | number | 课堂时长(分钟) |
| **知识点覆盖** | mSelect | 本次覆盖的知识点列表 |
| **状态** | select | 进行中/已完成/已生成反馈 |

#### Grade-DB (评分记录 AV)

| 列名 | 类型 | 说明 |
|:---|:---|:---|
| **记录ID** | block (主键) | 每条评分记录 |
| **所属课堂** | relation → Session-DB | 关联课堂 |
| **学生** | relation → Student-DB | 被评学生 |
| **知识点** | relation → Segment 文档 | 涉及的知识点 |
| **评分** | select | a/b/c/d/e 或自定义 |
| **评语** | text | 手动输入或语音转文字 |
| **题目引用** | block ref | 关联的具体题目块 |
| **时间戳** | date | 精确到秒 |

### 5.3 状态机设计

```
     ┌──────┐
     │ Idle │ ←────────────────────────────────────┐
     └──┬───┘                                      │
        │ 选择班级+课程                               │
        ▼                                          │
  ┌───────────┐                                    │
  │ Preparing │ ←──── 取消 ──→ Idle                 │
  │           │                                    │
  │ · 加载知识树     │                                │
  │ · 初始化资源列表  │                                │
  │ · 创建 Session   │                               │
  └─────┬─────┘                                    │
        │ 点击"开始授课"                              │
        ▼                                          │
  ┌──────────┐                                     │
  │ Teaching │ ←──── 循环操作:                       │
  │          │   切换段落 / 选人 / 评分 / 语音备注     │
  │ · 事件采集器运行中  │                              │
  │ · 段落导航激活     │                              │
  │ · 评分面板激活     │                              │
  └─────┬────┘                                     │
        │ 点击"结束授课"                              │
        ▼                                          │
  ┌───────────┐                                    │
  │ Reviewing │ ←──── 循环:                         │
  │           │   编辑反馈 / 重新生成                  │
  │ · 生成时间线摘要   │                               │
  │ · 调用LLM生成反馈  │                              │
  │ · 支持人工修改     │                              │
  └─────┬─────┘                                    │
        │ 保存并关闭                                  │
        └──────────────────────────────────────────┘
```

---

## 六、开发 Milestone 与技术难点

### Phase 0: 数据基础 (Week 1-2)

**目标**: 建立数据模型和 AV Schema

| 任务 | 交付物 | 难点 |
|:---|:---|:---|
| 定义 Student-DB / Session-DB / Grade-DB Schema | `av-schemas.ts` | AV 列类型选择与 relation 设计 |
| 实现从 Python `favorites.json` 的数据迁移脚本 | `migration.ts` | JSON 树结构 → AV 行 的映射逻辑 |
| 建立知识树文档解析器 | `tree-parser.ts` | 解析思源文档层级为结构化知识树 |
| SQLite 索引表设计 | `sqlite-index.ts` | 跨 AV 聚合查询的索引策略 |

**关键技术难点**:
- 🔴 **知识树解析**：思源文档树不是严格的 Module/Lesson/Topic/Segment 四级，需要设计一种灵活的"层级标记"方案（基于文档属性 or 块标签）来识别每级的语义
- 🟡 **AV Relation 建立**：Grade-DB 需要同时 relation 到 Student-DB 和 Session-DB，确保三表联查性能

### Phase 1: 课前 + 课中 MVP (Week 3-5)

**目标**: 实现备课 → 上课的核心流程

| 任务 | 交付物 | 难点 |
|:---|:---|:---|
| 教学面板 (Dock) | `panel.svelte` | Svelte 组件集成思源 Dock API |
| 段落导航与内容渲染 | `segment-nav.ts`, `preview-engine.ts` | 在面板中嵌入 Protyle 只读渲染 |
| 转盘选人 | `wheel.svelte`, `wheel-physics.ts` | Canvas 物理动画在思源内的性能 |
| 简单评分流程 | `grade-panel.svelte` | 评分 → 写入 AV → 刷新面板 |
| 基础快捷键支持 | `keyboard.ts` | 思源快捷键冲突处理 |

**关键技术难点**:
- 🔴 **Protyle 嵌入渲染**：教学面板需要只读渲染文档内容。思源没有公开的"嵌入 Protyle 到自定义面板"API，需要研究 `Protyle` 类的构造或使用 `renderBlockRef` 等工具函数
- 🔴 **快捷键冲突**：教学模式下的快捷键（a/b/c/d 评分）会与思源编辑器冲突。方案：教学面板 focus 时拦截键盘事件，失焦时恢复
- 🟡 **Canvas 转盘性能**：思源基于 Electron，Canvas 性能应该足够，但需注意不要阻塞主线程

### Phase 2: 课后 + 智能化 (Week 6-8)

**目标**: 实现课后反馈 + 智能分析

| 任务 | 交付物 | 难点 |
|:---|:---|:---|
| 课堂时间线自动采集 | `event-collector.ts` | 事件粒度控制 |
| 时间线可视化 | `timeline.svelte` | SVG 时间轴渲染+交互 |
| LLM 反馈生成 | `prompt-builder.ts`, `llm-adapter.ts` | Prompt 工程优化 |
| 反馈预览与编辑 | `feedback-panel.svelte` | 编辑器集成 |
| 导出为 Excel | `export.ts` | xlsx 生成 (SheetJS) |

**关键技术难点**:
- 🔴 **LLM API 集成**：需要适配多个 LLM 提供商（DeepSeek、OpenAI、本地 Ollama）。思源插件的网络请求需通过 `fetch` 或思源的 `fetchPost` 代理
- 🟡 **Prompt 工程**：从知识树+课堂记录构建有效 prompt。需要控制 token 数量（知识树可能很长），可能需要先摘要再生成反馈
- 🟡 **Excel 导出**：在浏览器环境中生成 xlsx 需要 SheetJS (xlsx-js) 库，需确保与思源的打包方式兼容

### Phase 3: 高级功能 (Week 9-12)

**目标**: 实现差异化高价值功能

| 任务 | 交付物 | 难点 |
|:---|:---|:---|
| 知识点掌握度热力图 | `heatmap.svelte`, `aggregator.ts` | 数据聚合 + SVG 渲染 |
| 语音转文字 | `recorder.svelte`, `stt-engine.ts` | 浏览器 API 兼容性 |
| 实时 Quiz 系统 (方案A) | `quiz-host.svelte`, `quiz-server.ts` | 思源内开 HTTP 端口 |
| LLM 判题 | `auto-judge.ts` | 开放式题目的评分准确性 |

**关键技术难点**:
- 🔴 **热力图交互性能**：当学生×知识点的矩阵较大时（如 30 学生 × 100 知识点 = 3000 格），SVG 渲染需要虚拟化或分页
- 🔴 **Quiz 服务端**：思源插件在 Electron 中运行，可以通过 `require('http')` 开端口，但需要处理防火墙、动态 IP 等问题。替代方案：用思源自身的 HTTP API + 自定义端点
- 🟡 **语音 API**：`SpeechRecognition` 在 Chrome (Electron) 中支持度好，但中英混杂的物理教学语音识别准确度可能不够。可能需要 Whisper + 后处理

---

## 七、总体技术风险评估

| 风险 | 等级 | 缓解方案 |
|:---|:---|:---|
| Protyle 嵌入渲染无公开 API | 🔴 高 | 研究源码 / 用 `lute.Md2BlockDOM` + 手动 innerHTML 替代 |
| 快捷键与思源编辑器冲突 | 🟡 中 | 使用 focus 机制 + EventBus 组合键前缀 |
| AV 数据实时同步 | 🟡 中 | 复用 IndexOS 已有的 `ws-main` 事件监听 + SQLite 索引 |
| LLM API 网络失败 | 🟡 中 | 离线回退 + 手动编辑模式 + 重试机制 |
| 语音识别中英混杂准确度 | 🟡 中 | 提供手动修正 UI + Whisper 备选 |
| Quiz 局域网通信 | 🟡 中 | 使用思源 WebSocket 或降级为无学生端方案 |

---

## 八、与 Python 版的差异对比

| 维度 | Python 版 | 思源插件版 |
|:---|:---|:---|
| **数据持久性** | JSON/Excel 文件，易损坏 | 思源 AV + SQLite，自动同步 |
| **知识树** | 硬编码在代码/JSON 中 | 用户可编辑的文档树，活的知识库 |
| **题目管理** | 独立 SQLite 数据库 + 图片文件 | 嵌入思源的块，可双链、可搜索、可引用 |
| **课堂记录** | Excel 单文件 | AV 数据库 + 时间线事件流 |
| **反馈生成** | 独立脚本调用 | 集成在课堂流程中，一键生成 |
| **跨设备** | 仅桌面 | 思源同步 + 浏览器适配 |
| **可扩展性** | 需改代码 | L2 命令变体 + L3 类注册 |
| **生态集成** | 孤立应用 | 与思源文档/反链/搜索/导出全面集成 |

---

## 九、推荐开发路径

```
Phase 0 (W1-2)          Phase 1 (W3-5)          Phase 2 (W6-8)         Phase 3 (W9-12)
┌──────────────┐     ┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ 数据模型定义    │     │ 教学面板 + 段落导航 │    │ 时间线自动采集    │    │ 掌握度热力图      │
│ AV Schema     │ ──→ │ 转盘选人          │ ──→│ LLM 反馈生成     │ ──→│ 语音转文字        │
│ 知识树解析器   │     │ 快捷评分 MVP      │    │ Excel 导出       │    │ 实时 Quiz 系统    │
│ 数据迁移脚本   │     │ 基础快捷键        │    │ 反馈编辑面板      │    │ LLM 判题         │
└──────────────┘     └──────────────────┘    └─────────────────┘    └──────────────────┘
        ↓                    ↓                        ↓                       ↓
   可以开始备课          可以上课 + 评分          可以生成课后反馈        完整智能教学系统
```

> **建议**：Phase 0-1 是 MVP，完成后就能替代 Python 版的核心功能并具备更好的数据可持续性。Phase 2 的 LLM 反馈生成是最大的效率提升点。Phase 3 的热力图和 Quiz 系统是真正的差异化功能。
