# IndexOS 命令开发与注册规范 SOP (Command Guide SOP)

本文档是 IndexOS 命令系统 (Command System) 的官方开发标准与规范流程，旨在规范新命令的开发、注册、出入参定义及调度执行，确保系统架构清晰、职责单一且无冗余代码。

---

## 1. 核心架构与职责分工原则

在 IndexOS 命令分层体系中，必须严格恪守**“各司其职”**原则，严禁跨层越界：

```
                ┌──────────────────────────────────────────────────┐
                │          commands.json (单一真理源)               │
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
3. **块 ID 默认占位符必须标准化**：任何涉及块操作的命令，其 `id` 参数在 `commands.json` 中的 `default` 必须显式声明为 `"{{block_id}}"`。

---

## 2. 新增命令的标准 4 步 SOP

创建或接入一个新命令，严格按照以下 4 步进行：

### Step 1: 在 `commands.json` 中声明元数据
文件位置：[src/features/command/registry/commands.json](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/command/registry/commands.json)

在 `commands` 数组中添加标准配置：

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
            "plugin-index.command.turnIntoTask",
            "plugin-index.effect.fireworks",
            "plugin-index.command.setBlockAttribute"
        ]
    }
];
```

---

## 3. 出入参设计与命名规范

| 规范项目 | 命名规则 | 说明与范例 |
| :--- | :--- | :--- |
| **命令 ID** | `plugin-index.command.<actionName>` | 统一小驼峰，如 `setBlockAttribute`、`insertBlockBelow` |
| **块 ID 参数** | `key: "id"`, `type: "blockid"` | 默认值必须统一为 `default: "{{block_id}}"` |
| **普通入参** | `key: "data"`, `key: "attrName"` 等 | 小驼峰，如需模板解析设置 `paramMode: "template"` |
| **出参定义** | `key: "<name>"`, `type: "string"` | 出参 key 会自动暴露为 `{{var.<key>}}`（如 `{{var.createdblock}}`） |
| **属性名称洗涤** | `sanitizeBlockAttrName(attrName)` | 必须经过统一洗涤函数处理，自动规范化为 `custom-` 标准前缀 |

---

## 4. 调试与排错 CheckList

- [ ] **参数是否接收正常**：观察控制台 `[ParamResolver STEP B] 处理参数 "xxx" (原始模板值: "...")` 是否输出期望值；
- [ ] **出参是否透传成功**：在 Pipeline 下游步骤中检查 `state.vars?.<outputKey>` 是否成功接力；
- [ ] **执行器是否纯粹**：检查执行器内部是否没有冗余的 `getBlockId` 探测代码，纯粹依赖调度器传递的 `params`。
