## 给思源源码开发者的 Debug 提示 (关于 Builder 模板渲染问题)

**当前进展**: 
我们已经成功解决了模板路径问题（通过补全 `dataDir` 和 `/templates` 前缀），现在调用 `/api/template/render` 可以正确返回模板内容。

**新遇到的问题**:
- **现象**: `render` 接口返回的是渲染后的 **DOM 字符串**（即 `<div data-node-id="...">...</div>` 格式的 HTML），而非 Markdown。
- **操作**: 我们目前将这个 DOM 字符串直接作为 `markdown` 参数传递给了 `/api/filetree/createDocWithMd`。
- **结果**: 新创建的文档内容是**未经解析的 HTML 代码块**（即用户看到的是 `<div>...</div>` 源码），而不是渲染后的块结构。

**我们的疑问**:
1.  **API 选型**: `createDocWithMd` 是否仅支持纯 Markdown？如果传入的是 Protyle DOM，应该使用哪个接口？
    - 是否应该使用 `createDocWithContent`（如果存在）？
    - 或者是否需要先调用 Lute 将 DOM 转换为 Markdown？（前端环境中如何安全调用 Lute？）
2.  **渲染接口**: `/api/template/render` 是否支持直接返回 Markdown 格式？（目前 `preview: false` 返回的是 DOM）。
3.  **参考场景**: SiYuan 自身的“日记创建”或“应用模板”功能，底层是先获取 DOM 然后用什么 API 写入文档的？

**请求**: 请提供将 `renderTemplate` 返回的 DOM 内容正确写入新文档的 API 调用链路或示例代码。

## 关于项目架构与重构的思考 (Refactoring & Architecture)

### 1. `events.ts` 的存留问题
**结论**: `events.ts` **不能删除**，它是 Attribute View 交互的“总调度中心 (Controller)”。

**理由**:
- **事件捕获**: 它负责监听全局 `mousedown`、`click` 和 `contextmenu` 事件。只有在这里才能捕获到用户是否按下了 `Alt` 键并点击了数据库单元格。
- **上下文识别**: 它包含 `getAVCell` 和 `getProtyleByElement` 等逻辑，用于从 DOM 元素溯源到具体的数据库 ID、行 ID 和 Protyle 实例。
- **插件集成**: `src/index.ts` 中注册的 `open-menu-av` 事件直接绑定到此文件的 `addAVMenuItems`。
- **职责**: 现在的 `events.ts` 已经变得非常精简，它不再包含复杂的同步算法，而是专注于“识别交互 -> 构建菜单 -> 调用功能模块”。

### 2. `utils.ts` 的迁移建议
**结论**: 建议将其移至 `src/shared/utils/av-utils.ts`。

**理由**:
- **跨功能共享**: `getColIDMap`（获取列名到 ID 的映射）和 `cleanValue`（规范化单元格数据）不仅在 `attribute-view` 内部使用，未来在 `src/features/data/list/action.ts`（如列表聚焦数据库）中也会用到。
- **降低耦合**: 按照 Feature-Oriented 架构，`shared` 应该存放那些“不属于特定业务，而是作为基础设施”的工具。AV 的数据解析协议（Standard Pose）属于这类基础设施。
- **架构一致性**: 我们的 `shared/utils` 已经有了 `dom-utils`、`markdown-utils` 等，新增 `av-utils` 能够让数据处理逻辑更加统一。

---
**后续行动**:
- [ ] 将 `src/features/data/attribute-view/utils.ts` 移动并重命名为 `src/shared/utils/av-utils.ts`。
- [ ] 更新 `attribute-view` 目录下所有文件的引用路径。
- [ ] 检查 `src/features/data/list/action.ts` 是否可以改用这些工具以简化代码。
