# 内置命令分析与新命令提案

## 一、现有命令盘点

当前 [commands.json](../src/features/command/registry/commands.json) 中注册了 **9 条**内置命令：

| ID                              | 名称　　　　　　 | dispatch 方式 | 类别　　　 | 特征标签　 |
| ---------------------------------| ------------------| ---------------| ------------| ------------|
| `general.graphView`             | 全局关系图　　　 | global　　　　| navigation | UI-only　　|
| `general.inbox`                 | 打开收集箱　　　 | global　　　　| navigation | UI-only　　|
| `general.splitLR`               | 右侧分屏打开　　 | global　　　　| view　　　 | UI-only　　|
| `editor.general.duplicate`      | 复制当前块　　　 | keyboard　　　| edit　　　 | 需焦点　　 |
| `editor.general.insertAfter`    | 在下方插入同级块 | keyboard　　　| edit　　　 | 需焦点　　 |
| `editor.general.copyBlockRef`   | 复制块引用　　　 | keyboard　　　| clipboard　| 需焦点　　 |
| `api.block.insertBlock`         | API：插入块　　　| api　　　　　 | edit　　　 | **可调度** |
| `api.block.updateBlock`         | API：更新块内容　| api　　　　　 | edit　　　 | **可调度** |
| `api.attr.setBlockAttrs`        | API：设置块属性　| api　　　　　 | attribute　| **可调度** |
| `plugin.index.effect.fireworks` | 烟花　　　　　　 | custom　　　　| custom　　 | 纯趣味　　 |

### 覆盖缺口分析

从思源源码的 [SIYUAN_KEYMAP](../../../Git-cloned/siyuan/app/src/constants.ts) 和 [globalCommand](../../../Git-cloned/siyuan/app/src/boot/globalEvent/command/global.ts) 中，我们可以看到大量未暴露为内置命令的能力：

- **global 命令共 40+ 个**，我们只暴露了 3 个
- **editor.general 键盘命令共 40+ 个**，我们只暴露了 3 个
- **editor.insert / editor.heading / editor.list / editor.table** 四个子类完全空白
- **api 命令**仅暴露了 3 个基础 CRUD
- **custom 命令**仅 1 个趣味特效

---

## 二、新命令提案

按照三个评价维度打分：⭐实用/有趣 ⭐易用爱用 ⭐探索边界

### 第一梯队：高优先级（建议 v1.10 加入）

#### 1. `plugin.index.block.stampNow` — 时间戳盖章
**创意**：一键在当前块末尾追加 `[2026-07-02 11:16]` 格式的时间戳。用于快速记录"这件事我什么时候看过/改过"。

```json
{
  "id": "plugin.index.block.stampNow",
  "name": "盖时间戳",
  "dispatch": { "method": "custom" },
  "params": [
    { "key": "format", "label": "时间格式", "type": "enum",
      "values": ["datetime", "date", "time", "relative"],
      "default": "datetime", "required": false, "paramMode": "static" }
  ],
  "constraints": { "requiresFocus": false, "uiOnly": false, "schedulable": true },
  "meta": { "scope": "self", "category": "edit", "source": "plugin", "plugin": "index" }
}
```

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐⭐ | 知识管理中"时间追溯"是刚需，思源没有原生一键方案 |
| 易用爱用 | ⭐⭐⭐ | 零配置即用，绑定到 Supertag 后打标签自动盖章 |
| 探索边界 | ⭐⭐ | 测试 `schedulable=true` 的 custom 命令路径；需要读写块内容 |

**实现要点**：executor 中调用 `/api/block/getBlockDOM` → 拼接时间文本 → `/api/block/updateBlock`。支持 `format` 参数控制格式。

---

#### 2. `plugin.index.block.toggleDone` — 完成状态切换
**创意**：在块的 IAL 中切换 `custom-status` 属性值（`todo` ↔ `done`），同时在块上添加/移除删除线样式。可配合 Supertag 实现"打标签标记完成→自动写入数据库状态列"。

```json
{
  "id": "plugin.index.block.toggleDone",
  "name": "切换完成状态",
  "dispatch": { "method": "custom" },
  "params": [
    { "key": "attrKey", "label": "状态属性名", "type": "text",
      "default": "custom-status", "required": false, "paramMode": "static" },
    { "key": "valueA", "label": "状态A", "type": "text",
      "default": "todo", "required": false, "paramMode": "static" },
    { "key": "valueB", "label": "状态B", "type": "text",
      "default": "done", "required": false, "paramMode": "static" }
  ],
  "constraints": { "requiresFocus": false, "uiOnly": false, "schedulable": true },
  "meta": { "scope": "self", "category": "attribute", "source": "plugin", "plugin": "index" }
}
```

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐⭐ | 任务管理核心操作 |
| 易用爱用 | ⭐⭐⭐ | 一键切换，无需打开属性面板 |
| 探索边界 | ⭐⭐⭐ | **Context-aware**: 需读取当前属性值判断方向；测试"有状态的命令"概念；与 Layer 4 数据组件联动时可自动同步 AV 列值 |

---

#### 3. `plugin.index.nav.openBlockInNewTab` — 在新页签打开块所在文档
**创意**：获取当前块的 `root_id`，在新页签中打开该文档并滚动到该块位置。当块来自嵌入块或搜索结果时特别实用。

```json
{
  "id": "plugin.index.nav.openBlockInNewTab",
  "name": "在新页签中打开",
  "dispatch": { "method": "custom" },
  "params": [],
  "constraints": { "requiresFocus": false, "uiOnly": true, "schedulable": false },
  "meta": { "scope": "self", "category": "navigation", "source": "plugin", "plugin": "index" }
}
```

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐⭐ | 解决"在嵌入块上下文中想跳转到原文"的高频需求 |
| 易用爱用 | ⭐⭐⭐ | 右键菜单绑定即可 |
| 探索边界 | ⭐⭐ | 测试使用 `openTab()` 全局 API（petal 导出），需从 dispatcher context 推导 root_id |

**实现要点**：executor 中调用 `/api/block/getBlockInfo` 获取 `rootID`，然后 `openTab({ app, doc: { id: blockId, action: ["cb-get-focus"] } })`。

---

#### 4. `plugin.index.block.moveToDaily` — 移动块到今日日记
**创意**：将当前块从当前位置剪切，追加到今天的每日笔记底部。"在任何地方记录灵感 → 一键归档到日记"。

```json
{
  "id": "plugin.index.block.moveToDaily",
  "name": "移至今日日记",
  "dispatch": { "method": "custom" },
  "params": [],
  "constraints": { "requiresFocus": false, "uiOnly": false, "schedulable": false },
  "meta": { "scope": "self", "category": "edit", "source": "plugin", "plugin": "index" }
}
```

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐⭐ | 极常见工作流：随手记→归档到日记 |
| 易用爱用 | ⭐⭐⭐ | 一键操作，无需手动复制粘贴跨文档 |
| 探索边界 | ⭐⭐⭐ | **跨文档操作**：需调用 `/api/block/moveBlock`；需动态获取 dailyNote 的 ID（通过 `window.siyuan.storage` 或 API `createDailyNote`）；测试命令对"不可见块"（不在当前编辑器的块）的操作能力 |

---

### 第二梯队：中优先级（有趣的边界探索）

#### 5. `plugin.index.block.smartMerge` — 智能合并相邻块
**创意**：将当前块与下方块的内容合并为一个块。

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐ | 整理笔记时常见需求 |
| 探索边界 | ⭐⭐⭐ | **多块操作**：需要读取 siblings、组合内容、删除原块、更新目标块，是 scope=sibling 的典型测试 |

---

#### 6. `plugin.index.block.extractToDoc` — 提取为子文档
**创意**：将选中块的内容提取为一个新的子文档，并在原位留下一个块引用链接。

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐⭐ | 笔记重构核心操作 |
| 探索边界 | ⭐⭐⭐ | **最高难度**：需要 `createDocWithMd` → 读取新文档 ID → `updateBlock` 在原位替换为引用 → `deleteBlock` 原块。涉及 3 个 API 的编排和事务性 |

---

#### 7. `plugin.index.effect.confetti` — 五彩纸屑庆祝
**创意**：烟花的姊妹款。完成任务时下一场五彩纸屑雨。与 `toggleDone` 组合使用时，可以实现"标记完成→自动庆祝"的仪式感。

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐⭐ | 趣味性极强，用户会爱上完成任务 |
| 易用爱用 | ⭐⭐⭐ | 绑定到 Supertag 后零操作自动触发 |
| 探索边界 | ⭐⭐ | 测试**命令链**概念：toggleDone 完成后自动触发 confetti |

---

#### 8. `plugin.index.query.countWords` — 统计块字数
**创意**：统计当前块（或当前文档）的字数/字符数/段落数，以 `showMessage` 形式展示。

| 维度 | 评分 | 理由 |
|------|------|------|
| 实用/有趣 | ⭐⭐ | 写作者常用 |
| 探索边界 | ⭐⭐⭐ | 测试**只读命令**（不修改任何数据，只产出信息）。当前所有命令都是写操作，需要验证 dispatcher 对"无副作用命令"的处理 |

---

### 第三梯队：远期探索（重大能力验证）

#### 9. `plugin.index.block.scheduleReminder` — 定时提醒
**创意**：为当前块设置一个提醒时间。到时后弹出通知。

| 维度 | 评分 | 理由 |
|------|------|------|
| 探索边界 | ⭐⭐⭐ | 测试 `schedulable=true` 的**真实定时调度场景**。需要持久化定时信息（写入 IAL 或 SQLite），并在插件 onload 时恢复所有定时器 |

#### 10. `plugin.index.block.multiCommand` — 组合命令
**创意**：按顺序执行一组子命令。如 `[toggleDone, stampNow, confetti]`。

| 维度 | 评分 | 理由 |
|------|------|------|
| 探索边界 | ⭐⭐⭐ | **命令编排引擎**：验证 dispatcher 能否支持命令链式执行。这是命令系统从"单一操作"升级为"工作流引擎"的关键能力 |

---

## 三、总结矩阵

| 命令 | dispatch | schedulable | 实用 | 易用 | 边界探索 | 优先级 |
|------|----------|-------------|------|------|----------|--------|
| stampNow | custom | ✅ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | 🟢 高 |
| toggleDone | custom | ✅ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 🟢 高 |
| openBlockInNewTab | custom | ❌ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | 🟢 高 |
| moveToDaily | custom | ❌ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 🟢 高 |
| smartMerge | custom | ❌ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 🟡 中 |
| extractToDoc | custom | ❌ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 🟡 中 |
| confetti | custom | ❌ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | 🟡 中 |
| countWords | custom | ❌ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 🟡 中 |
| scheduleReminder | custom | ✅ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 🔴 远期 |
| multiCommand | custom | ✅ | ⭐⭐⭐ | ⭐ | ⭐⭐⭐ | 🔴 远期 |

### 第一批实现建议

如果要选 **3-4 个**先做，推荐：

1. **`stampNow`** — 最简单的 custom 命令，验证 executor 注入 + schedulable 的完整路径
2. **`toggleDone`** — Context-aware 的典型，测试"读取旧状态→判断→写入新状态"的有状态命令
3. **`confetti`** — 趣味命令，与 fireworks 对称，测试特效命令的参数化（颜色/持续时间）
4. **`moveToDaily`** — 跨文档操作，验证命令系统处理"目标不在当前编辑器"场景的能力
