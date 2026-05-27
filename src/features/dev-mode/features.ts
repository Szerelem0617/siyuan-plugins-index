export type PluginFeature =
    | "commands.pull"          // 从 Layer 1 拉取命令到 Layer 2
    | "commands.management"    // 管理/编辑已注册命令的元数据
    | "database.diagnose"      // 打开 SQL Explorer 诊断面板
    | "database.reset"         // 重置 SQLite 数据库
    | "outline.reverse"        // 生成大纲列表模式
    | "data.addTemplateCols"   // 自动添加模板列
    ;
