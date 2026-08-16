# IndexOS 命令开发与注册规范 SOP (Command Guide SOP)

本文档是 IndexOS 命令系统 (Command System) 的官方开发标准与规范流程，旨在规范新命令的开发、注册、出入参定义及调度执行，确保系统架构清晰、职责单一且无冗余代码。

---

## 1. 核心架构与职责分工原则

在 IndexOS 命令分层体系中，必须严格恪守**“各司其职”**原则，严禁跨层越界：

```
                ┌──────────────────────────────────────────────────┐
                │      builtin/{command-name}.json (单一真理源)     │
                │  - 定义命令元数据、输入参数 Schema、出参 Outputs     │
                └────────────────────────┬─────────────────────────┘
                                         │
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │        command-dispatcher.ts (统一调度器)        │
                │  - 负责参数解析、模版变量替换 (如 {{time}})       │
                │  - 负责 Auto-Context 链式推导与上下文块 ID 注入    │
                │  - 严格准备好 resolvedParams 传递给执行器        │
                └────────────────────────┬─────────────────────────┘
                                         │
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │          effect/*.ts (命令执行器)                │
                │  - 100% 纯粹业务执行，直接使用 resolvedParams   │
                │  - 严禁私自写二次兜底 (如 a || b || c)            │
                │  - 参数缺失直接抛错暴露问题，返回 DispatchResult  │
                └──────────────────────────────────────────────────┘
```

### 三大铁律：
1. **严禁在命令执行器内部做上下文推导**：执行器不得私自调用 `getBlockId()` 或从 `context.vars` 中拼凑字段，一切参数均由调度器 `command-dispatcher` 在前置阶段完成解析与注入。
2. **严禁写各种 `||` 兜底代码**：参数缺失应直接 throw Error 抛出问题，把逻辑漏洞暴露在阳光下。
3. **块 ID 默认占位符必须标准化**：任何涉及块操作的命令，其 `id` 参数在 Schema 中的 `default` 必须显式声明为 `"{{block_id}}"`。

---

## 2. 命令设计的核心边界律（Three Boundary Rules）

设计或审查一个命令时，必须严格通过以下三条边界律检验：

### 规则 1：一句话原则（One-Sentence Rule）
一个命令必须能用一句自然语言描述清楚，且句中**不出现“并且”、“然后”**。
> **检验方法**：用“这个命令做什么？”提问，如果回答里需要“并且”或“同时”，说明它承载了两个意图，必须拆分。
> 
> - ✅ **合格**：“给这个块设置一个属性”、“在下方插入一个块”、“打开这个页面”
> - ❌ **不合格**：“给这个块设置属性并且发一条通知”（通知应由 Pipeline 下一步骤承载）、“插入一个块然后打上标签”

### 规则 2：选择无困惑原则（No-Confusion Rule）
用户在命令列表中看到任意两个命令时，**不应该犹豫该用哪个**。
> **检验方法**：把两个命令名放在一起，问非技术用户：“你觉得这俩有什么区别？”如果答不出来或答错，说明命令划分有问题。
> 
> - **推论 A**：若两个命令区别只是参数不同（如插入段落 vs 插入标题），应合并为一个命令，通过参数区分。
> - **推论 B**：若两个命令区别是根本性意图差异（如设置属性 vs 添加标签），应保持独立。

### 规则 3：参数极简原则（Minimal Parameters Rule）
一个命令的**用户必填参数不超过 3 个**。高级参数必须有合理默认值，用户可以完全忽略。
> - **核心参数**：不填就无法执行（如 `attrName`, `attrValue`），始终显示，最多 2-3 个。
> - **高级参数**：90% 场景无需修改，折叠在“高级设置”中。
> - **系统参数**：由调度器自动注入（如 `id = {{block_id}}`），对普通用户不可见。

---

## 3. 两层扁平命名空间规范 (Two-Tier Namespace RFC)

IndexOS 采用极简的两层扁平动宾体系 `[namespace].[verbNoun]`：

```
规范格式:  [namespace].[verbNoun]
```

### 命名空间划分：
1. **`index.*`**：IndexOS 内置增强原子命令（源自 `builtin/*.json`，如 `index.insertBlockBelow`）；
2. **`user.*`**：用户在界面自建的客制化原子命令（如 `user.dailyArchive`）；
3. **`composite.*`**：复合命令编排流水线（具有沙箱规则脚本与多步骤调度特性）；
4. **`[plugin-id].*`**：第三方插件扩展接入命令。

### 内置原子命令全量矩阵表：

| 命令 ID | 显示名称 | 类别 (`category`) | 目标作用域 (`targetScope`) | 说明 |
|---|---|---|---|---|
| `index.insertBlockBelow` | ➕ 在下方插入块 | edit | any | 在指定块/页面下方插入新块或子页面 |
| `index.safeUpdateBlock` | 📝 更新块内容 | edit | any | 安全更新块 Markdown 或页面标题，保留自定义属性 |
| `index.setBlockAttribute`| 🏷️ 设置块属性 | manipulation | block | 统一设置/更新块属性 (Upsert 模式) |
| `index.openTarget` | 🚀 打开目标 | navigation | any | 在页签中打开页面或定位高亮内容块 |
| `index.addSupertag` | 🏷️ 添加超级标签 | edit | any | 为块添加 Supertag 并挂载 DOM 标头 |
| `index.visualEffect` | 🎆 视觉特效 | view | none | 触发粒子动画特效（烟花/流星/扫描/气泡/微风/细雨/篝火） |
| `index.showToast` | 💬 消息通知 | view | none | 多态消息通知（前台气泡 / 后台系统横幅 / 内核广播 / 审计日志） |
| `index.openGraph` | 🕸️ 全局关系图 | navigation | none | 呼出全局块关系图面板 |
| `index.openInbox` | 📥 打开收集箱 | navigation | none | 打开每日收集箱 |
| `index.splitRight` | 📑 在右侧分屏打开 | view | doc | 将当前文档在右侧新面板打开 |
| `index.copyBlockRef` | 🔗 复制块引用 | edit | block | 将块引用链接复制到剪贴板 |
| `index.duplicateBlock` | 📑 复制当前块 | edit | block | 快速复制当前块并插入其下方 |
| `index.insertBlock` | 🧩 插入原生块 | api | any | 调用原生 API 插入块 |
| `index.setAttributes` | ⚙️ 批量设置块属性 | api | any | 调用原生 API 批量写入 IAL 属性 |

---

## 4. 新增命令的标准 4 步 SOP

### Step 1: 在 `builtin/` 下创建独立的 `{command-name}.json`
文件位置：`src/features/command/registry/builtin/{command-name}.json`

```json
{
    "id": "index.setBlockAttribute",
    "name": "设置块属性",
    "description": "统一设置/更新块属性 (Upsert 模式)。",
    "dispatch": {
        "method": "custom"
    },
    "params": [
        {
            "key": "id",
            "type": "blockid",
            "paramMode": "template",
            "default": "{{block_id}}",
            "description": "目标块 ID。默认自动绑定当前上下文块或前序创块。"
        },
        {
            "key": "attrName",
            "type": "string",
            "paramMode": "template",
            "default": "custom-status",
            "description": "属性名称，如 status 或 custom-status。"
        },
        {
            "key": "attrValue",
            "type": "string",
            "paramMode": "template",
            "default": "pending",
            "description": "属性值，如 pending / done / {{time}}。"
        }
    ],
    "outputs": [
        {
            "key": "attrValue",
            "type": "string",
            "label": "更新后的属性值",
            "default": "attrValue"
        }
    ],
    "constraints": {
        "environment": "universal",
        "targetScope": "block",
        "comment": "统一设置块属性"
    },
    "meta": {
        "contextNeed": "block",
        "category": "manipulation",
        "source": "builtin"
    },
    "seeds": [
        {
            "rowID": "20260813180000-setattr0001",
            "label": "🏷️ 设置块属性",
            "commandID": "index.setBlockAttribute",
            "paramMapping": "{}"
        }
    ]
}
```

---

### Step 2: 编写纯粹的命令执行器 (Effect)
文件位置：`src/features/command/effect/<command-name>.ts`

```ts
import { post } from "../../../shared/api-client/request";
import { sanitizeBlockAttrName } from "../utils/attribute-sanitizer";
import type { CommandContext, DispatchResult } from "../dispatcher";

export async function setBlockAttribute(
    params: { id?: string; attrName?: string; attrValue?: string },
    context?: CommandContext
): Promise<DispatchResult> {
    // 1. 直接获取已解析好的参数，不写任何多层兜底
    const rawId = String(params?.id || "").trim();
    const rawName = String(params?.attrName || "").trim();
    const rawVal = params?.attrValue !== undefined ? String(params.attrValue) : "";

    // 2. 参数缺失直接抛错，暴露问题
    if (!rawId) throw new Error("[SetBlockAttribute] 缺少必要的目标块 ID (id)");
    if (!rawName) throw new Error("[SetBlockAttribute] 缺少必要的属性名 (attrName)");

    const cleanAttrName = sanitizeBlockAttrName(rawName);

    // 3. 执行核心业务逻辑
    await post("/api/attr/setBlockAttrs", {
        id: rawId,
        attrs: { [cleanAttrName]: rawVal }
    });

    // 4. 将出参注入到 context.vars 中供后续 Pipeline 消费
    if (context) {
        if (!context.vars) context.vars = {};
        context.vars.attrValue = rawVal;
    }

    // 5. 返回标准 DispatchResult
    return {
        success: true,
        method: "custom",
        detail: `Set attribute ${cleanAttrName} on block ${rawId}`,
        value: { attrName: cleanAttrName, attrValue: rawVal },
        id: rawId
    };
}
```

---

### Step 3: 在插件主入口绑定执行器
文件位置：[src/index.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/index.ts)

在 `onload` 阶段完成动态绑定：

```ts
const setAttrCmd = commandRegistry.getCommand("index.setBlockAttribute");
if (setAttrCmd) {
    const { setBlockAttribute } = await import("./features/command/effect/set-block-attribute");
    setAttrCmd.dispatch.executor = setBlockAttribute;
}
```

---

### Step 4: 注册默认关系与 Seed 数据 (可选)
文件位置：[src/features/command/indexos/seed-data.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/command/indexos/seed-data.ts)

```ts
export const DEFAULT_RELATION_BINDINGS: DefaultRelationRule[] = [
    {
        typeLabel: "task",
        iconMenuCmdIds: ["index.setBlockAttribute"],
        relationCmdIds: [
            "index.visualEffect",
            "index.setBlockAttribute"
        ]
    }
];
```

---

## 5. 双轨上下文体系 (Dual-Track Context)

调度器分发命令时，提供统一标准化的双轨上下文 (`CommandContext`)：

| 上下文轨道 | 包含字段 | 用途与消费规则 |
| :--- | :--- | :--- |
| **逻辑数据轨 (Logical Track)** | `blockId`, `supertag`, `vars`, `executionMode` | 专供纯数据命令（如 `setBlockAttribute`），由 Dispatcher 解析后注入 `params`。 |
| **空间物理轨 (Spatial Track)** | `geometry: { x, y, width, height, centerX, centerY }`, `triggerEl`, `blockEl` | 专供视效与 UI 类命令（如 `visualEffect`），由 Dispatcher **自动预计算绝对屏幕坐标**，执行器 0 样板代码。 |

---

## 6. 出入参设计与命名规范

| 规范项目 | 命名规则 | 说明与范例 |
| :--- | :--- | :--- |
| **命令 ID** | `[namespace].[verbNoun]` | 统一两层动宾小驼峰，如 `index.setBlockAttribute`、`index.insertBlockBelow` |
| **块 ID 参数** | `key: "id"`, `type: "blockid"` | 默认值必须统一为 `default: "{{block_id}}"` |
| **普通入参** | `key: "data"`, `key: "attrName"` 等 | 小驼峰，如需模板解析设置 `paramMode: "template"` |
| **出参定义** | `key: "<name>"`, `type: "string"` | 出参 key 会自动暴露为 `{{var.<key>}}`（如 `{{var.createdblock}}`） |
| **属性名称洗涤** | `sanitizeBlockAttrName(attrName)` | 必须经过统一洗涤函数处理，自动规范化为 `custom-` 标准前缀 |

---

## 7. 调试与排错 CheckList

- [ ] **参数是否接收正常**：观察控制台 `[ParamResolver STEP B] 处理参数 "xxx" (原始模板值: "...")` 是否输出期望值；
- [ ] **空间几何是否自动注入**：检查视效执行器中 `context.geometry` 是否能直接读到 `{ centerX, centerY, x, y }`；
- [ ] **出参是否透传成功**：在 Pipeline 下游步骤中检查 `state.vars?.<outputKey>` 是否成功接力；
- [ ] **执行器是否纯粹**：检查执行器内部是否没有冗余的 `getBlockId` 探测代码，纯粹依赖调度器传递的 `params` 或 `context.geometry`。
