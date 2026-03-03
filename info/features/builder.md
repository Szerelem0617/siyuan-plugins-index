# Builder 功能逻辑详述

`Builder` 模块负责将层级化的列表块（List）转换为结构化的文档架构（子文档树或标题层级）。

## 核心流程图

```mermaid
sequenceDiagram
    participant User as 用户/事件
    participant Auto as Auto-Update 监控
    participant Proc as ListProcessor (递归)
    participant Core as IBlockProcessor (核心逻辑)
    participant SY as 思源 API

    User->>Auto: 触发更新 (IAL 包含 custom-tree-create)
    Auto->>Auto: 解析配置 (JSON/Fallback)
    Auto->>Proc: 调用 processRecursive(blockId, actionType)
    
    loop 递归遍历列表项
        Proc->>Core: processSingleItem(listItem)
        alt PUSH_TO_DOC (子文档模式)
            Core->>Core: 检查关联文档 (custom-index-subdoc-id)
            alt 存在文档
                Core->>SY: 重命名文档, 同步 Icon/图片
            else 不存在
                Core->>SY: 创建新文档 (createDocWithMd)
                Core->>Core: 绑定 ID 到原列表项
            end
            Core->>Core: 应用继承系统 (Icon, Title-Img, 模板)
        else PUSH_TO_BOTTOM (标题行模式)
            Core->>Core: 检查关联标题 (custom-index-heading-id)
            Core->>SY: 更新或插入对应层级的 Heading (#, ##, ###)
        end
        Core->>SY: 更新列表项 Markdown (添加图标与链接)
    end
    Proc->>SY: 更新文档排序 (changeSort)
```

## 关键逻辑细节

### 1. 内容解析 (Content Parsing)
- **正则表达式提取**：通过 `parseItemContent` 分离列表项中的“文档链接图标”、“分隔符 (➖)”和“实际同步文本”。
- **图标优先级**：属性中的 Icon (AV 数据) > 列表项开头的原生 Emoji > 默认图标 (📄)。

### 2. 属性继承系统 (Inheritance System)
- **强继承 (Strong)**：强制子项与父项保持一致（如分类图标）。
- **弱继承 (Weak)**：仅在子项未设置特定属性时，使用父项的值进行填补。
- **自定义映射**：支持将 AV 中的任意列映射为文档的自定义属性 (`custom-xxx`)。

### 3. 不同场景处理
- **空文档处理**：若目标文档仅包含一个空的段落块，Builder 会在应用模板时自动清理该空块，保持文档整洁。
- **复合模式 (Composite)**：在 `PUSH_COMBINED` 模式下，Builder 会执行双通（Two-Pass）逻辑：先构建底部标题大纲以获取稳定的 ID 索引，再构建子文档树。
- **排序同步**：在构建树结构后，会收集所有子文档路径并调用 `changeSort` API，确保思源侧栏文件树的顺序与列表顺序完全一致。

### 4. 容错逻辑
- **JSON 鲁棒性**：处理 SiYuan 属性中常见的引号转义问题，支持对非标准 JSON 键的自动修复。
- **死循环拦截**：结合 `Data` 模块的 ID 绑定，若内容与属性未发生实际变化，Builder 将跳过昂贵的 API 调用。
