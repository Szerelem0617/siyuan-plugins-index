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

### 边界律速查清单 (Pre-flight Checklist)
新增或修改命令前，必须过一遍：
- [ ] **一句话检验**：能否用一句不含“并且/然后”的话描述该命令？
- [ ] **无困惑检验**：命令列表中是否存在另一个让用户犹豫“该用哪个”的相似命令？
- [ ] **参数极简检验**：必填参数是否 ≤ 3 个？高级参数是否都有合理默认值？

---

## 3. 新增命令的标准 4 步 SOP

创建或接入一个新命令，严格按照以下 4 步进行：

### Step 1: 在 `builtin/` 下创建独立的 `{command-name}.json`
文件位置：`src/features/command/registry/builtin/{command-name}.json`

每个命令独立维护单一 json 文件，并在 `builtin/index.ts` 中完成聚合导入。标准 JSON 格式：

```json
{
    "id": "plugin-index.command.setBlockAttribute",
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
    "seed": {
        "rowID": "20260813180000-setattr0001",
        "label": "🏷️ 设置块属性",
        "paramMapping": "{}"
    }
}
```

---

### Step 2: 编写纯粹的命令执行器 (Effect)
文件位置：`src/features/command/effect/<command-name>.ts`

执行器编写规范范例：

```ts
import { post } from "../../../shared/api-client/request";
import { sanitizeBlockAttrName } from "../utils/attribute-sanitizer";
import type { CommandContext, DispatchResult } from "../command-dispatcher";

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
        context.vars["var.attrValue"] = rawVal;
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
const setAttrCmd = commandRegistry.getCommand("plugin-index.command.setBlockAttribute");
if (setAttrCmd) {
    const { setBlockAttribute } = await import("./features/command/effect/set-block-attribute");
    setAttrCmd.dispatch.executor = setBlockAttribute;
}
```

---

### Step 4: 注册默认关系与 Seed 数据 (可选)
文件位置：[src/features/command/indexos/seed-data.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/command/indexos/seed-data.ts)

将新命令的 ID 登记到相关 Supertag 的预设关系中：

```ts
export const DEFAULT_RELATION_BINDINGS: DefaultRelationRule[] = [
    {
        typeLabel: "task",
        iconMenuCmdIds: ["plugin-index.command.setBlockAttribute"],
        relationCmdIds: [
            "plugin-index.effect.visualEffect",
            "plugin-index.command.setBlockAttribute"
        ]
    }
];
```

---

## 4. 双轨上下文体系 (Dual-Track Context)

调度器分发命令时，提供统一标准化的双轨上下文 (`CommandContext`)：

| 上下文轨道 | 包含字段 | 用途与消费规则 |
| :--- | :--- | :--- |
| **逻辑数据轨 (Logical Track)** | `blockId`, `supertag`, `vars`, `executionMode` | 专供纯数据命令（如 `setBlockAttribute`），由 Dispatcher 解析后注入 `params`。 |
| **空间物理轨 (Spatial Track)** | `geometry: { x, y, width, height, centerX, centerY }`, `triggerEl`, `blockEl` | 专供视效与 UI 类命令（如 `visualEffect`），由 Dispatcher **自动预计算绝对屏幕坐标**，执行器 0 样板代码。 |

---

## 5. 出入参设计与命名规范

| 规范项目 | 命名规则 | 说明与范例 |
| :--- | :--- | :--- |
| **命令 ID** | `plugin-index.command.<actionName>` | 统一小驼峰，如 `setBlockAttribute`、`insertBlockBelow` |
| **块 ID 参数** | `key: "id"`, `type: "blockid"` | 默认值必须统一为 `default: "{{block_id}}"` |
| **普通入参** | `key: "data"`, `key: "attrName"` 等 | 小驼峰，如需模板解析设置 `paramMode: "template"` |
| **出参定义** | `key: "<name>"`, `type: "string"` | 出参 key 会自动暴露为 `{{var.<key>}}`（如 `{{var.createdblock}}`） |
| **属性名称洗涤** | `sanitizeBlockAttrName(attrName)` | 必须经过统一洗涤函数处理，自动规范化为 `custom-` 标准前缀 |

---

## 6. 调试与排错 CheckList

- [ ] **参数是否接收正常**：观察控制台 `[ParamResolver STEP B] 处理参数 "xxx" (原始模板值: "...")` 是否输出期望值；
- [ ] **空间几何是否自动注入**：检查视效执行器中 `context.geometry` 是否能直接读到 `{ centerX, centerY, x, y }`；
- [ ] **出参是否透传成功**：在 Pipeline 下游步骤中检查 `state.vars?.<outputKey>` 是否成功接力；
- [ ] **执行器是否纯粹**：检查执行器内部是否没有冗余的 `getBlockId` 探测代码，纯粹依赖调度器传递的 `params` 或 `context.geometry`。
