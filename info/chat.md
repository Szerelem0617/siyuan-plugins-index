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

## 关于获取数据库全量数据与列映射的疑问 (Batch Processing)



**当前背景**:

我们在开发“批量同步到后代”功能时，需要获取数据库（Attribute View）中的**所有行**（包括被当前视图筛选器隐藏的行），以便查找并更新后代项。



**我们尝试的方案**:

1.  创建一个临时视图 (`addAttributeViewView`)。

2.  使用 `renderAttributeView` 读取该临时视图的数据（期望是没有筛选的全量数据）。

3.  操作完成后删除临时视图。



**遇到的问题**:

- **列索引不匹配**: 我们发现源视图（用户当前看到的）和临时视图返回的数据中，`columns` 的顺序可能不一致。导致我们用源视图计算出的 `colIndex` 去读取临时视图的 `cells` 时取到了错误的数据（或空数据）。

- **数据获取**: 我们不确定这是否是获取全量数据的最佳实践。



**我们的疑问**:

1.  **全量数据获取**: 有没有更优雅的 API 来获取指定 AV (`avID`) 的所有行数据（忽略 View 的 Filters）？

    - 比如 `renderAttributeView` 是否支持忽略 `viewID` 直接获取原始数据？

    - 或者是否有 SQL 查询方案可以直接构建出 AV 的行结构？

2.  **列 ID 映射**: 不同 View 返回的 `columns` 顺序是否是不确定的？

    - 最佳实践是否是：每次 `renderAttributeView` 后，都必须根据返回的 `view.columns` 重新建立 `ColumnID -> Index` 的映射表？

3.  **性能优化**: 如果数据库很大（几千行），创建临时视图 -> 渲染 -> 删除 的开销是否过大？是否有针对纯数据读写的轻量级接口？



**请求**: 请指点获取 AV 全量数据的标准姿势，以及如何稳健地处理跨视图的列数据映射。
