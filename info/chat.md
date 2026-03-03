更新到 1.9.2

## 核心思考：如何实现“类（Naming Class/Supertag）”的深度客制化

目前的 Naming Class 仅能实现“分类”这一单一维度的功能。为了让不同的“类”拥有差异化的属性、形态和功能，我们需要对 Supertag 的底层结构进行重构，并建立权威的分发机制。

### 1. 数据结构升级：从“映射项”到“配置集”

目前 `IDBTypeMapping` 仅包含 `value` 和 `name`。我们需要将其扩展为一个包含各类“类偏好设置”的容器：

```typescript
// src/features/data/av-setting/types.ts
export interface IDBTypeMapping {
    value: string;     // 原始映射值
    name: string;      // 类名（Supertag 名）
    isSupertag: boolean | undefined;
    
    // --- 新增扩展属性 ---
    icon?: string;          // 此类的默认图标
    titleImg?: string;      // 此类的默认题头图
    templateId?: string;    // 此类专属的 Builder 模板 ID
    defaultValues?: Record<string, any>; // 该类被应用时，自动填充的其他列默认值
}
```

### 2. 不同类如何拥有“不同的属性”？

虽然同一个数据库（Attribute View）中的列定义是共享的，但我们可以通过以下方式实现“类级别的差异化”：

*   **默认值重载 (Default Value Overrides)**：
    *   例如：在“任务”类中，“状态”默认设为“待办”；而在“灵感”类中，“状态”默认设为“收集”。
*   **关联列锁定 (Associated Columns)**：
    *   UI 层面：当块隶属于“任务”类时，在属性面板中优先显示“截止日期”相关列；若属于“灵感”类，则隐藏不相关列。
*   **形态决定论**：
    *   **图标与题头图**：让 `Supertag` 掌握 IAL 渲染权重。打上 `#任务#` 后，自动更换图标为 🛠，打上 `#书籍#` 则更换为 📖。

### 3. 不同类如何拥有“不同的功能”？

功能层面的差异主要通过 **逻辑挂钩 (Hooks)** 实现：

*   **构建器行为差异化**：
    *   目前 Builder 只能选一个全局默认模板。
    *   **目标**：如果列表项打上了 `#子页面#` 标签，Builder 自动按子页面模板生成；打上了 `#章节#` 标签，则自动按标题行模式生成。
*   **上下文菜单客制化**：
    *   在 `av-menu` 或 `block-menu` 中，根据当前块所属的 `Supertag` 类型，动态挂载专属的功能按钮。
    *   例如：“书籍”类可以多出一个“自动抓取豆瓣信息”的按钮，而“任务”类则拥有“归档到已完成”的快捷键。
*   **生命周期回调 (Lifecycle Hooks)**：
    *   当一个块被鉴定为某类 Supertag 后，可以触发特定的后置处理逻辑。

### 4. 实施路线图建议

1.  **UI 升级**：在数据库高级设置中，点击“命名类”的项目时不再是简单的输入框，而应弹出一个小型的“类定义”面板。
2.  **SupertagMonitor 增强**：在 `applySupertag` 时，不仅同步 `typeFieldId`，还需要遍历 `defaultValues` 和 `icon` 进行批量下发。
3.  **模板逻辑解耦**：改造 `src/features/builder/builder.ts` 中的 `processRecursive`，使其查询 `itemResolvedAttrs` 中的 `templateId` 优先级高于数据库配置中心。

### 5. 交互形式进化与源码级脑暴：“所见即所得 (Live View Configuration)”

你提出的方案——**直接在数据库视图中进行配置并保存，可以隐藏还是删掉？配置反正存在config里**，这是一个非常极客精神且符合“以数据为核心”的思路。

结合思源内核关于 `AttributeView` 的处理机制，我经过头脑风暴，否定了长久保留隐藏视图的做法，并推导出了**最干净、最优雅的实现路线**：

#### 为什么不推荐“建一个表格然后隐藏它”？
*   **垃圾留存问题**：在原文档中留下加了 `display: none` 的块很容易被用户不小心用 Backspace 误删。建立专门页面存放也会给用户带来心理负担（"这个文件是啥？可以删吗？"）。
*   **思源 AV 的强绑定**：思源的 AV 有严格的实体文件对应在 `data/storage/av/` 目录下。如果我们仅仅是在页面上隐藏块，后端的 JSON 数据会一直积压。

#### 最佳实践：“沙盒召唤与销毁”模型 (Sandbox & Snapshot)

既然我们最终需要的是 JSON 配置，那么“视图”在非编辑期间完全没有存在的必要。最终设计链路如下：

1.  **第一步：召唤沙盒 (Summon Sandbox)**
    当用户点击【配置 `任务` 类】时，插件调用向后端 API，不影响原视图，也不新开文档，而是在当前文档底部（或者直接在用户的界面弹出一个内置 `protyle` 的 Dialog）**凭空生成一个“临时数据库（Sandbox DB）”**。
    这个临时数据库的列定义，完全克隆自当前的“主数据库”。并且自带一个空块（临时输入行）。
2.  **第二步：捏造形态 (Design & Play)**
    用户在这个表格里，像平常使用思源一样，任意隐藏不需要的列，拖拽排好顺序。并且在第一行样本里面，敲入默认的文本、打上默认星级、选择默认头像等。这是完全 100% 的原生体验。
3.  **第三步：快照提取 (Capture Snapshot)**
    用户点击表格上方的【保存配置】大按钮。插件介入，通过 `getAttributeView` API 获取这个沙盒 DB 的当前 View 结构（列可见性：`hideAttrViewName` / `filters` / 排序）和那一行样本块的内容快照。并将他们浓缩打包保存到我们的 `config` 中。
4.  **第四步：销毁沙盒 (Destroy)**
    快照捕获完毕，插件立即调用 `deleteBlock` 或者 `removeAttributeViewBlocks` 清除这个临时的块，沙盒粉碎，无痕退出。整个主文档干干净净。
5.  **第五步：重塑沙盒 (Re-summon)**
    当用户下次想要再编辑这个类时怎么办？利用保存的 `config` 再次逆向构建出（Render）这个表格给用户修改。由于配置在我们手里，表格的生死完全被我们掌控。

### 6. 技术实现路线图

1.  **数据层**：升级 `IDBTypeMapping`：
    ```typescript
    export interface IDBTypeMapping {
        value: string;
        name: string;
        // ... 原来的字段
        templateId?: string; // 如果此类关联专门子文档模板
        viewConfig?: any;    // 存储隐藏列和排序的快照
        defaultValues?: any; // 存储提取出来的一行属性默认值快照
    }
    ```
2.  **UI 层级 Sandbox**：研究能不能用原生的 `Dialog`，在里面 `new Protyle()` 专门展示我们这单独生成的一行沙盒块，这样连用户的文档都不会弄脏。如果渲染有局限，就老老实实插入在当前光标下方，配置完一键删块。
3.  **分发动作**：当触发一个对应 `Supertag` 时：
    *   通过 `transactions` 执行 `batchSetAttributeViewBlockAttrs` 以灌入默认值。
    *   克隆 `viewConfig` 也许不需要，因为最终这些块还要进同一个主表格，它们的显示方式是由主表格当前的视图决定的（同一表里的块共享列显隐）。
    *   *注意：如果是一个表里的数据，A行和B行在同一个视图里是不可能拥有不同的“列显隐”的，列显隐是由当前的 View 决定的，而非具体的块。这也就意味着，定制类时我们提取的视图状态，主要是用于用户将来针对这一类建立专门过滤视图时，方便**一键生成专属视图**。*