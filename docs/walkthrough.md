# Walkthrough - 修复未定义函数报错与 Binder 刷屏循环

本次更新修复了虚拟投影初次组装时的函数调用异常，并彻底消除了 Binder 绑定时的日志刷屏与级联触发问题。

---

## 1. 修复与治理清单

### ① 修复 `TypeError: this.initSQLiteTableForTag is not a function`
- **根因**：`supertag-av-projector.ts` 中在检查表存在性或重启冷启动时，调用了不存在的方法名 `initSQLiteTableForTag`。
- **修复**：修正为正规的 `this.projectSupertagToAV(binding.tagName, avId)`，恢复了冷启动自愈与初次渲染能力。

### ② 治理 `[Supertag-Binder]` 刷屏与循环调用
- **根因**：
  1. `getUnifiedSupertagList` 列表循环在每次读取列表时都对每个标签调用 `supertagBinder.setPref(...)`；
  2. `supertag-binder.ts` 的 `setPref` 未作幂等判断，每次均触发完整持久化保存与控制台输出，导致 DOM 变更与重新加载死循环。
- **修复**：
  1. 在 `supertag-binder.ts` 的 `setPref` 中加入前置幂等判断（若值未变化直接退出）；
  2. 在 `getUnifiedSupertagList` 读取流程中仅调用内存 Map 注册 `supertagAVProjector.bindTagToAV`，移除副作用与存储写入；
  3. 清理冗余的控制台刷屏日志。
