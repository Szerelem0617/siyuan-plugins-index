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

## 关于数据库绑定的修复记录

**问题描述**:
当用户手动删除了已绑定的数据库块（Dead Link）后，再次点击“创建数据库”时，插件会创建一个新数据库，但列表项**没有**被添加到新数据库中。

**原因分析**:
1.  列表项（ListItem）的 DOM 中保留了旧数据库的 `data-custom-av-item-id` 属性。
2.  在创建新数据库时，代码读取了这些旧 ID，并试图用它们去更新新数据库。
3.  由于新数据库中不存在这些 ID 对应的行，且代码逻辑认为“既然有 ItemID 就不需要执行插入（NewSrcs）”，导致操作实际上被忽略，新数据库为空。

**修复方案**:
- 在 `createDatabaseWithBlocks` 中，当判定为创建新数据库（`!existingAvID`，包含 Dead Link 导致的新建）时，强制清空所有列表项的 `savedItemID`。
- 这迫使代码生成新的 ItemID，并将这些项作为新数据插入到新数据库中。