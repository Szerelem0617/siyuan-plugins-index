## 给思源源码开发者的 Debug 提示 (关于 Builder & Emoji 异常)

我们在优化“Document Builder”功能及 Emoji 选择器时遇到了以下技术瓶颈，需要专家通过源码分析给予指导：

### 1. 模板路径权限与 workspace 校验
- **问题**: 调用 `/api/template/render` 时报错 `Path [/Normal/templates/书影/观后感] is not in workspace`。
- **环境**: 用户数据库中存储的模板路径为 `/Normal/templates/书影/观后感`。
- **疑问**:
    - 该 API 期望的 `path` 格式是什么？是否必须相对于特定的 `data/templates` 目录？
    - 是否需要补全 `.md` 后缀？
    - 为什么以 `/` 开头的绝对路径会被判定为“不在工作空间内”？

### 2. 属性更新与图标渲染不一致
- **问题**: 
    - 我们在 `handlePushToDoc` 中为了兼容 `setBlockAttrs`，将图标转换为 Hex 格式（如 `1f61b`）。
    - 但在更新列表项的 Markdown 链接时 `[icon](siyuan://blocks/...)`，如果直接使用 Hex，界面会显示原始字符而不是 Emoji。
- **疑问**:
    - 在 SiYuan 的 `constructListItemMarkdown` 场景下，是否必须将 Hex 转换回 Unicode 字符？
    - 推荐的“Hex 字符串”与“Emoji 字符”互转的标准工具函数（类似 `unicode2Emoji`）在前端 API 中叫什么？

### 3. `setEditorConf` 响应异常
- **问题**: 调用 `fetchSyncPost("/api/system/setEditorConf", ...)` 时报错 `Unexpected end of JSON input`。
- **疑问**:
    - 该接口在执行成功后是否返回空响应（Empty Body）？
    - `fetchSyncPost` 是否不支持处理空响应？如果不支持，插件端应该改用哪个方法来持久化编辑器配置（如最近使用的表情）？

### 4. 题头图 (Title Image) 的设置格式
- **现象**: 题头图目前设置成功了，但想确认：`title-img` 属性的值应该是完整的 CSS `background-image` 字符串（如 `background-image:url(...)`），还是仅为资源路径？

**请求**: 请提供针对以上问题的标准参数示例或源码逻辑参考。
