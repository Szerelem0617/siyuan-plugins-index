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

## 关于数据库属性视图 (Attribute View) 筛选器 (Filters) 的疑问

**当前背景**:
我们正在实现一个“聚焦后代”的功能。为了支持递归筛选所有层级的后代，我们引入了一个 `Path` 字段，存储格式为 `/祖先ID/父项ID/当前ID`。

**遇到的问题**:
- **现象**: 调用 `/api/av/setAttrViewFilters` 时，我们尝试使用 `operator: "contains"`，但筛选结果不符合预期（或者无效）。
- **核心矛盾**: 我们不确定 SiYuan 数据库筛选器支持哪些操作符，以及它们的精确语法。

**我们的疑问**:
1.  **操作符列表**: `setAttrViewFilters` 接口中的 `operator` 字段支持哪些值？
    - 是否支持 `contains`, `like`, `regex`, `prefix`, `suffix`？
    - 对于文本类型和数字类型，分别有哪些可用的操作符？
2.  **包含匹配**: 如果要实现“包含且不等于”的效果，推荐的写法是什么？
    - 比如：`Path` 包含 `/某个ID/`。
3.  **多重筛选**: `setAttrViewFilters` 的 `data` 参数是一个数组，多个筛选条件之间是 `AND` 还是 `OR` 关系？如何指定逻辑关系？
4.  **架构建议**: 在思源的数据库中，实现“筛选某个节点的所有后代”最标准/性能最好的做法是什么？是否有内置的层级筛选支持？

**请求**: 请提供 `setAttrViewFilters` 的详细参数说明，特别是 `operator` 的取值范围和文本匹配的正确姿势。