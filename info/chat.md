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
