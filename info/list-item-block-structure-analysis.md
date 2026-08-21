# 思源笔记 列表/列表项/段落块 三层结构与命令交互深度剖析与架构方案

## 一、思源底层列表的三层 DOM 与 AST 架构

在思源笔记源码中（参见 `app/src/protyle/wysiwyg/` 与 `app/src/block/util.ts`），一个任务列表在底层具有严格的**三层嵌套物理结构**：

```
层级 1: NodeList (.list[data-type="NodeList"])          ➔ 列表总容器 (type = 'l')
   └── 层级 2: NodeListItem (.li[data-type="NodeListItem"])    ➔ 任务项/列表项 (type = 'i')，携带复选框与挂钩 handle
          └── 层级 3: NodeParagraph (.p[data-type="NodeParagraph"]) ➔ 任务文字内容段落 (type = 'p')
```

---

## 二、现状痛点与矛盾深度剖析

### 1. 块标 (Gutter Icon) 挂载策略的非对称现象
* **单项列表时（只有一个列表项）**：
  - 思源渲染逻辑只会在最外层 `NodeList` 显示一个总块标，中间的 `NodeListItem` 和内部的 `NodeParagraph` 均不展示独立块标。
* **多项列表时**：
  - 每一个 `NodeListItem` 均展现独立的条目块标，但内部的 `NodeParagraph`（纯文本）仍然不显示独立块标。
* **Icon Menu 触发绑定**：
  - 点击列表条目块标时，事件触发的实体 ID 是 **`NodeListItem`（`type = 'i'`）**。

### 2. 实际执行命令时的“偷梁换柱”与“空壳残留”现象（核心 Bug）
* **现象**：
  - 用户触发“将内容移动到”等命令时，光标往往在文字段落内，或者调度器提取了 `NodeParagraph`（`type = 'p'`）的 ID；
  - 思源后端的 `/api/block/moveBlock` 原生 API 执行了针对 `NodeParagraph` 的物理移动；
  - **结果**：只有里面的纯文本被挪移到了目标位置，而外层的 `NodeListItem`（任务复选框容器）依然空空荡荡地留在原地，产生了一个没有文字的空白 `[ ]` 任务框！

---

## 三、方案建议 (Proposed Solutions)

### 方案 A：原子实体自动提权机制（Atomic Item Elevation - 推荐）
在命令分发与参数准备阶段（如 `move-content.ts` 或 `context-builder.ts`）：
1. 当检测到目标 `sourceId` 是一个 `NodeParagraph`（`type = 'p'`），且其父级 `parent_id` 是一个 `NodeListItem`（`type = 'i'`），且该段落是列表项的主体内容时；
2. **自动将移动主体提权为 `NodeListItem`（`type = 'i'`）**；
3. 执行移动时连同复选框、任务属性和文字整体迁移，原位置不留空壳。

### 方案 B：双向属性与多态上下文感知（Dual-Layer Context）
1. 在 `context-extractor.ts` 中引入 `getAtomicBlockId(context)`：
   - 区分“微观文本段落”与“宏观任务单元”；
   - 移动、删除类操作针对“任务单元（`NodeListItem`）”；
   - 文本格式化、追加内容类操作针对“段落（`NodeParagraph`）”。
