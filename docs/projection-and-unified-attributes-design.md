# IndexOS 虚拟投影与统一属性管理体系架构设计

本文档记录 **Supertag 虚拟 AV 投影系统（Virtual AV Projection）** 与 **统一属性管理体系（Unified Attributes Management）** 的设计原则、核心架构、关键技术实现及未来迭代规划。

---

## 1. 架构愿景与设计哲学

### 1.1 现状与痛点分析
思源笔记当前存在三套相对割裂的属性体系：
1. **原生内置属性**：如 `name`, `alias`, `memo`, `bookmark` 等，存储于块 AST 的 IAL（Inline Attribute List）中；
2. **自定义块属性**：以 `custom-*` 为前缀，散落在各个 `.sy` 文档的块 IAL 中，无类型系统管理（全为字符串）；
3. **原生 AV 数据库**：以独立的 `.av/*.json` 文件存储在数据目录中。

**原生 AV 面临的核心瓶颈**：
* **数据冗余与非正交双存**：同一份属性数据既存在于文档块中，又被复制一份存入 `.av/*.json` 文件；
* **文件膨胀与写放大**：当数据库行数达到上万行时，单次单元格修改需要序列化并落盘数百 KB 甚至数 MB 的单个 JSON 文件；
* **跨文档协作心智负担**：用户在文档中修改了块内容/属性，与数据库中的元数据难以保持天然双向实时一致。

### 1.2 IndexOS 核心设计原则
* **单一真理源（Single Source of Truth）**：以散落在 Markdown 块中的 IAL 属性作为持久化真理源，以内存 SQLite 表（`proj_<avId>`）作为交互运行时的热数据源；
* **零物理磁盘双存（0-Disk Physical Duplication）**：虚拟投影不生成任何 `.av/*.json` 实体文件，完全基于网络拦截与内存 SQL 引擎动态合成 `IAV` 视图协议；
* **100% 原生体验与破坏性创新兼容**：用户在思源前端界面感受不到任何违和感，所有排版、列宽、排序、筛选均完美运行于思源原生数据库渲染器之上。

---

## 2. Hot-SQLite 虚拟投影架构

```
┌──────────────────────────────────────────────────────────────┐
│                    思源笔记前端渲染器 (Protyle)                  │
└──────────────────────────────┬───────────────────────────────┘
                               │ Fetch: /api/av/renderAttributeView
                               ▼
┌──────────────────────────────────────────────────────────────┐
│       SupertagAVProjector (window.fetch 拦截网关)              │
│  ├─ 捕获 /api/av/renderAttributeView ➔ 合成虚拟 IAV 响应       │
│  └─ 捕获 /api/transactions           ➔ 拦截并执行 SQL UPDATE  │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                纯内存 SQLite 热表 (proj_<avId>)               │
│  ├─ 表结构: id, title, _root_id, _updated, _dirty, [attr...] │
│  ├─ 增删改查: 100% 走纯标准 SQL 语句驱动                      │
│  └─ 冷启动自愈: 探测表缺失时 0.5ms 内自动从思源主库重建         │
└──────────────────────────────┬───────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               │                               │
       (realtime 模式)                  (delayed 模式)
               ▼                               ▼
    单次编辑即时回写块属性              保留修改于 SQLite (_dirty=1)
    post("/api/attr/setBlockAttrs")    关闭投影时统一调用 batchSetBlockAttrs
```

### 2.1 运行时热表结构
每个虚拟投影挂载时，在 SQLite 引擎中生成专属数据表 `proj_<avId>`：
```sql
CREATE TABLE "proj_20260823013721_o82i4eo" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT,
    "_root_id" TEXT,
    "_updated" INTEGER,
    "_dirty" INTEGER DEFAULT 0,
    "status" TEXT,
    "priority" TEXT,
    "due" TEXT
);
```

### 2.2 双回写模式（Dual Writeback Modes）
用户可在插件设置（**数据管理 / 数据库**）中自由切换：
1. **实时同步模式 (`realtime`, 默认)**：
   * 在 SQLite 热表中执行 `UPDATE ... SET ... WHERE id = ?`；
   * 同步调用 `/api/attr/setBlockAttrs` 将属性即时写回物理 Markdown 块；
   * 适用场景：单次编辑频率适中、要求其他外部插件或搜索即时感知属性变更。
2. **延迟统一回写模式 (`delayed`)**：
   * 在 SQLite 热表中执行修改并标记 `_dirty = 1`，**期间物理 Markdown 文件保持 0 磁盘 I/O 写入**；
   * 仅在用户从菜单点击“关闭虚拟投影”时，统一筛选 `WHERE _dirty = 1` 的所有记录，通过 `/api/attr/batchSetBlockAttrs` 批量统一落盘，随后清理 SQLite 临时表；
   * 适用场景：高频密集修改、大幅降低 SSD 磁盘磨损与文件版本历史膨胀。

### 2.3 冷启动自愈机制（Auto-Rebuild on Demand）
* 绑定关系持久化于 `localStorage`，而 sql.js 纯内存 SQLite 在思源刷新/重启时会被重置；
* 当收到 `/api/av/renderAttributeView` 渲染请求时，系统首先查询 `sqlite_master` 校验热表是否存在；若缺失，即刻调用 `initSQLiteTableForTag` 扫描主库块属性完成表结构创建与数据秒级灌入，杜绝 `no such table` 异常。

### 2.4 全域就地重绘流水线（Zero-Flicker Live Rerender）
* 采用与思源底层 `getAllModels()` 一致的 `window.siyuan.layout.layout` 递归树遍历，获取主视口、分屏、弹窗中的所有活动 `Protyle` 编辑器；
* 精准调用 `editor.reload(false)`，**在保持用户当前视口滚动条绝对平稳的前提下，就地触发视图拉取与重绘**。

---

## 3. 统一属性管理体系（Unified Attributes Management）

```
                     ┌────────────────────────────────┐
                     │      IndexOS 统一属性层        │
                     └───────────────┬────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│   原生内置属性    │       │  自定义 Supertag  │       │  AV 数据库列属性  │
│ name, memo, alias │       │ custom-status ... │       │ Type-Safe Select  │
└───────────────────┘       └───────────────────┘       └───────────────────┘
```

### 3.1 类型安全系统（Type Safety via Supertag Schema）
* 原生 `custom-*` 属性在底层全部表现为字符串；
* IndexOS 通过 Supertag Schema 注册表注入强类型元数据（`text`, `number`, `select`, `mSelect`, `date`, `blockRef`, `checkbox`）；
* 在视图层与编辑面板中自动渲染对应的类型化控件（如颜色枚举标签、日期选择器、开关等）。

### 3.2 重名与冲突隔离策略（Scoping & Slugging）
* **数据库属性重名**：思源 AV 内部允许多个同名列；IndexOS 在 SQL 热表中自动加上 `col_<attr>` 规范化 Slug，避免 SQL 关键字及命名冲突；
* **IAL 属性合法性校验**：自动遵循思源内核 `isValidAttrName` 规范，对非法字符执行 Slug 转义与还原映射。

### 3.3 属性展示与交互覆盖规划
1. **统一属性展示面板（Unified Attribute Inspector）**：
   * 在编辑器侧边栏或独立悬浮窗中，将选中块的原生内置属性（备注、别名、命名）、已挂载 Supertag 属性及所属数据库视图字段整合为一张响应式属性卡片；
2. **覆写原生块菜单“属性”面板（Native Block Menu Attribute Tab Override）**：
   * 无侵入式拦截/替换思源原生右键块菜单中的“属性”面板；
   * 将原生简陋的 Key-Value 纯文本表格升级为支持**类型校验、颜色标签选择、Supertag 一键绑定的 IndexOS 现代化属性工作台**。

---

## 4. 后续版本更新迭代计划

| 阶段 | 核心任务 | 状态 / 目标 |
| :--- | :--- | :--- |
| **Phase 1 (已完成)** | **Hot-SQLite 虚拟 AV 投影引擎**<br>实现纯内存 SQL 热表驱动、零磁盘双存、双回写模式与即时重绘。 | ✅ 稳定就绪 |
| **Phase 2 (下一步)** | **统一属性展示面板 (Unified Attribute Inspector)**<br>构建独立的块级属性检查器，整合内置属性、Supertag 与类型化字段展示。 | 🚀 规划开始 |
| **Phase 3** | **原生块菜单属性页覆写 (Block Menu Attribute Override)**<br>无侵入替换思源块菜单中的原生属性编辑界面，赋予其强类型与 Supertag 能力。 | 📋 待启动 |
| **Phase 4** | **列表项与段落块层级属性穿透提权**<br>支持列表项与子块自动继承宿主 Supertag 属性与上下文感知。 | 📋 待启动 |
| **Phase 5** | **跨表 Join 与多 Supertag 混合视图**<br>利用 SQLite 引擎原生能力，支持多标签联合查询与虚拟关联视图。 | 🔭 远期规划 |
