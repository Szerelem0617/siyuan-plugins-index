# Walkthrough - 修复 `supertag-db` 误挂载 `#db (投影)` 按钮

本次更新排查并解释了为什么 `supertag-db` 上会错误出现 `#db` 投影按钮，并彻底修复了该误判问题。

---

## 1. 根因剖析与修复

### ① 为什么会显示 `#db (投影)` 按钮？
- **按钮功能定义**：
  该按钮是 `AVProjectionToggle`（模式切换器），用于在 **“原生物理数据视图”** 与 **“虚拟 Supertag 投影视图”** 之间快速切换；
- **误判根因**：
  在识别 AV 块标题或属性时，正则 `/supertag-([^\s\/\.]+)/i` 匹配到了文档标题 `"supertag-db"`，其中前缀为 `supertag-`，捕获组提取到了 `db`，从而误将 `supertag-db` 当成了 Supertag `#db` 的投影数据库！

### ② 治理措施
1. **显式排除系统表**：将 `supertag-db`、`command-db`、`custom-index-supertag-db` 等 IndexOS 系统内部数据库列入系统级白名单黑名单排除；
2. **阻断错误推断**：针对 `db`、`supertag` 等系统内部标签名阻断按钮挂载与投影绑定。
