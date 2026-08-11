# Supertag 动态约束与智能感知架构设计 (Plan C)

## 一、 背景与设计理念

在 IndexOS 中，命令 (Command) 拥有明确的 `constraints` 定义（`environment: "ui" | "universal"`, `targetScope: "none" | "block" | "doc" | "any"`）。

Supertag 作为 Layer 3 的逻辑容器，绑定了一组 Pipeline 命令与条件触发规则。为了减少用户手动配置的心智负担，Supertag 采用 **Plan C（自动推导 + 智能感知）** 机制：
1. **零配置推导**：Supertag 的 `derivedScope` 完全由它绑定的 Command 列表的 `targetScope` 动态推导计算，无需在数据库中存储冗余字段；
2. **100% 数据自洽**：避免用户手动选择的作用域与实际绑定的命令产生矛盾；
3. **智能感知与推荐**：在 `@` 呼出 Supertag 面板与 Hover 卡片中提供直观的作用域提示与匹配推荐。

---

## 二、 推导算法规则 (`derivedScope`)

给定 Supertag 绑定的命令集合 $C = \{c_1, c_2, ..., c_n\}$：

```ts
export type SupertagDerivedScope = "none" | "block" | "doc" | "any";

export function deriveSupertagScope(commandIds: string[]): SupertagDerivedScope {
    const scopes = commandIds
        .map(id => commandRegistry.getCommand(id)?.constraints?.targetScope)
        .filter(Boolean);

    const hasDoc = scopes.includes("doc");
    const hasBlock = scopes.includes("block");

    if (hasDoc && hasBlock) return "any"; // 多态交错
    if (hasDoc) return "doc";             // 页面专属类
    if (hasBlock) return "block";         // 块专属类
    if (scopes.every(s => s === "none")) return "none";
    return "any";                         // 默认多态
}
```

---

## 三、 交互与体验落地点 (Plan C 场景)

1. **`command-db` / `supertag-db` Hover 卡片**：
   - 悬浮在 Supertag 上时展示：`📄 页面类 Supertag (基于 3 个页面命令自动推导)` 或 `🧩 块级类 Supertag`。
2. **`@` 超级标签呼出面板**：
   - 当在文档标题等页面上下文呼出 `@` 时，优先推荐 `doc` 与 `any` 的 Supertag；
   - 当在普通段落块呼出 `@` 时，优先推荐 `block` 与 `any` 的 Supertag。
