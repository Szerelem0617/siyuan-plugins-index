# Walkthrough - `supertag-av-projector.ts` 模块化重构大功告成

本次重构成功将原 1070 行的虚拟投影核心大文件（`supertag-av-projector.ts`）解耦拆分为 5 个独立高内聚子模块，各司其职，极大提高了代码的可维护性、可测试性与扩展性，同时保证外部调用方 100% 零修改兼容。

---

## 1. 重构架构全景

```
src/features/unified-attributes/projection/
├── types.ts                   # 1.【类型与元数据仓库】(VirtualAVBinding, VirtualColumnMeta, columnMetaRegistry)
├── fetch-interceptor.ts       # 2.【网络拦截网关】(Hook window.fetch，拦截 /renderAttributeView 与 /transactions)
├── iav-builder.ts             # 3.【IAV 协议合成器】(纯函数：从 SQLite 结果集组装思源原生 Table/Column/Cell/Option 结构)
├── hot-table-engine.ts        # 4.【SQLite 热表引擎】(proj_xxx 热表建表、全量扫描、单块同步、反向编辑与延迟回写)
├── rerender-dispatcher.ts     # 5.【就地重绘调度器】(递归遍历活动 Protyle 编辑器实例，派发原生 WebSocket 消息即时局部刷新)
├── av-projection-toggle.ts    # 6.【UI 模式切换器】(AV 顶栏 ⚡ 模式切换按钮组件)
└── supertag-av-projector.ts   # 7.【统一门面 Facade】(组合各子模块，对外提供 supertagAVProjector 单例)
```

---

## 2. 新增与重构文件明细

1. **[types.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/projection/types.ts)**：
   - 提取了所有与虚拟投影相关的接口定义；
   - 维护了全局列元数据注册表 `columnMetaRegistry`（`registerColumnMeta`, `getColumnMeta`）。

2. **[iav-builder.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/projection/iav-builder.ts)**：
   - `buildVirtualIAVFromSQL(...)`: 纯函数式组装思源原生 IAV 表格、视图、列、行与单元格；
   - `buildEmptyIAV(...)`: 组装空虚拟视图。

3. **[rerender-dispatcher.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/projection/rerender-dispatcher.ts)**：
   - `getAllActiveEditors()`: 递归遍历 Tab 树、浮窗 Dialog、块面板与移动端编辑器；
   - `notifyFrontendToRerender(...)`: 派发原生 WebSocket `refreshAttributeView` 消息并清除 `data-render` 标记，实现 0 闪烁就地重绘。

4. **[hot-table-engine.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/projection/hot-table-engine.ts)**：
   - 封装 SQLite 驱动层（`projectSupertagToSQLite`、`syncBlockToSQLite`、`removeBlockFromSQLite`、`handleCellUpdateInSQLite`、`flushDirtyBlocks`、`dropHotTable`）。

5. **[fetch-interceptor.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/projection/fetch-interceptor.ts)**：
   - `installFetchInterceptor(...)`: 专职网关拦截与事务放行/改写。

6. **[supertag-av-projector.ts](file:///Users/feng/Desktop/项目/思源项目/siyuan-plugins-index/src/features/unified-attributes/projection/supertag-av-projector.ts)**：
   - 门面 Facade，行数大幅缩减至 ~200 行；
   - 对外公开接口与调用约定 100% 保持不变。
