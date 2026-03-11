const siyuan = require("siyuan");

const { Plugin, showMessage, Dialog } = siyuan;



class CommandLister extends Plugin {

    onload() {
        this.backendAPIs = [
            // Block
            { name: "获取文档信息", path: "/api/block/getDocInfo", desc: "获取文档的元数据信息" },
            { name: "获取块信息", path: "/api/block/getBlockInfo", desc: "获取特定块的元数据" },
            { name: "获取块Kramdown", path: "/api/block/getKramdown", desc: "获取块的 Kramdown 源码" },
            { name: "获取块属性", path: "/api/block/getBlockAttrs", desc: "获取指定块的所有属性" },
            { name: "设置块属性", path: "/api/block/setBlockAttrs", desc: "更新或添加块的属性值" },
            // FileTree
            { name: "获取文档内容", path: "/api/filetree/getDoc", desc: "根据文档 ID 获取其所有的块内容" },
            { name: "创建文档", path: "/api/filetree/createDoc", desc: "在指定目录下创建一个新文档" },
            { name: "删除文档", path: "/api/filetree/removeDoc", desc: "将指定路径的文档移入回收站" },
            { name: "重命名文档", path: "/api/filetree/renameDoc", desc: "更改文档标题或路径名" },
            { name: "移动文档", path: "/api/filetree/moveDoc", desc: "在笔记本之间或目录之间移动文档" },
            // Search
            { name: "搜索块", path: "/api/search/searchBlock", desc: "全文搜索块内容" },
            { name: "搜索引用块", path: "/api/search/searchRefBlock", desc: "搜索用于块引用的候选块" },
            { name: "搜索标签", path: "/api/search/searchTag", desc: "搜索已有标签列表" },
            // Notebook
            { name: "列出笔记本", path: "/api/notebook/lsNotebooks", desc: "获取当前所有笔记本列表" },
            { name: "打开笔记本", path: "/api/notebook/openNotebook", desc: "挂载一个笔记本" },
            { name: "关闭笔记本", path: "/api/notebook/closeNotebook", desc: "卸载一个笔记本" },
            // Query & Attr
            { name: "SQL 查询", path: "/api/query/sql", desc: "使用 SQL 语句查询块信息" },
            { name: "获取属性定义", path: "/api/av/getAttributeView", desc: "获取属性视图定义" },
            // System
            { name: "系统版本", path: "/api/system/version", desc: "获取内核当前版本号" },
            { name: "获取配置", path: "/api/system/getConf", desc: "获取内核详细配置信息" },
            { name: "内核退出", path: "/api/system/exit", desc: "安全关闭内核进程" }
        ];
        this.transactionActions = [
            "insert", "update", "delete", "move", "foldHeading", "unfoldHeading",
            "setAttrs", "updateAttrs", "append",
            "insertAttrViewBlock", "removeAttrViewBlock", "addAttrViewCol", "removeAttrViewCol",
            "addFlashcards", "removeFlashcards",
            "updateAttrViewCell", "updateAttrViewCol", "updateAttrViewColTemplate",
            "sortAttrViewRow", "sortAttrViewCol", "sortAttrViewKey",
            "setAttrViewColPin", "setAttrViewColHidden", "setAttrViewColWrap", "setAttrViewColWidth",
            "updateAttrViewColOptions", "removeAttrViewColOption", "updateAttrViewColOption",
            "setAttrViewName", "doUpdateUpdated", "duplicateAttrViewKey", "setAttrViewColIcon",
            "setAttrViewFilters", "setAttrViewSorts", "setAttrViewColCalc",
            "updateAttrViewColNumberFormat", "replaceAttrViewBlock",
            "addAttrViewView", "setAttrViewViewName", "removeAttrViewView", "setAttrViewViewIcon",
            "duplicateAttrViewView", "sortAttrViewView", "setAttrViewPageSize",
            "updateAttrViewColRelation", "moveOutlineHeading", "updateAttrViewColRollup",
            "hideAttrViewName", "setAttrViewCardSize", "setAttrViewCoverFrom", "setAttrViewGroup"
        ].map(name => ({ name, desc: "内核底层数据操作动作", meta: "Action" }));

        this.slashCommands = [
            { id: "template", label: "模板", meta: "Constants.ZWSP" },
            { id: "widget", label: "挂件", meta: "Constants.ZWSP + 1" },
            { id: "assets", label: "资源文件", meta: "Constants.ZWSP + 2" },
            { id: "ref", label: "块引用", meta: "((" },
            { id: "blockEmbed", label: "嵌入块", meta: "{{" },
            { id: "database", label: "数据库", meta: "AV" },
            { id: "heading1", label: "一级标题", meta: "#" },
            { id: "heading2", label: "二级标题", meta: "##" },
            { id: "heading3", label: "三级标题", meta: "###" },
            { id: "list", label: "无序列表", meta: "-" },
            { id: "orderedList", label: "有序列表", meta: "1." },
            { id: "check", label: "任务列表", meta: "[]" },
            { id: "quote", label: "引述", meta: ">" },
            { id: "code", label: "代码块", meta: "```" },
            { id: "table", label: "表格", meta: "|" },
            { id: "emoji", label: "表情", meta: ":" },
            { id: "link", label: "链接", meta: "a" },
            { id: "bold", label: "粗体", meta: "strong" },
            { id: "italic", label: "斜体", meta: "em" },
            { id: "underline", label: "下划线", meta: "u" },
            { id: "strike", label: "删除线", meta: "s" },
            { id: "mark", label: "标记", meta: "mark" },
            { id: "tag", label: "标签", meta: "tag" },
            { id: "math", label: "数学公式", meta: "$$" },
            { id: "line", label: "分隔线", meta: "---" },
            { id: "calloutNote", label: "提示 (Note)", meta: "callout" },
            { id: "infoStyle", label: "信息样式", meta: "style" },
            { id: "errorStyle", label: "错误样式", meta: "style" }
        ];

        console.log("Command Lister 插件已加载");
        this.addTopBar({
            icon: "iconSettings",
            title: this.i18n?.listCommands || "命令列表",
            position: "right",
            callback: () => this.showAllCommandsDialog()
        });
    }

    showAllCommandsDialog() {
        if (!this.sniffedUIResults) this.sniffedUIResults = [];
        if (!this.sniffedSlashResults) this.sniffedSlashResults = [];
        let currentTab = "plugin";

        const updateDialog = (dialog) => {
            const titleEl = dialog.element.querySelector(".b3-dialog__header");
            const contentEl = dialog.element.querySelector(".b3-dialog__body");

            if (!titleEl || !contentEl) return;

            let data = [];
            let titleText = "";

            if (currentTab === "plugin") {
                titleText = "插件命令";
                this.app.plugins?.forEach(p => {
                    p.commands?.forEach(cmd => {
                        data.push({
                            label: this.getCommandLabel(cmd, p),
                            desc: `插件: ${p.displayName || p.name} | ID: ${cmd.id || cmd.langKey}`,
                            meta: cmd.customHotkey || cmd.hotkey || "",
                            callback: () => {
                                if (cmd.callback) cmd.callback();
                                else if (cmd.globalCallback) cmd.globalCallback();
                                else if (cmd.editorCallback) {
                                    const protyle = window.siyuan.editor?.currentEditor?.protyle;
                                    if (protyle) cmd.editorCallback(protyle);
                                }
                            }
                        });
                    });
                });
            } else if (currentTab === "system") {
                titleText = "系统命令";
                const keymap = window.siyuan?.config?.keymap || {};
                const traverseKeys = (obj, path = "") => {
                    for (let k in obj) {
                        const val = obj[k];
                        if (val && typeof val === 'object') {
                            if (val.default !== undefined || val.custom !== undefined) {
                                data.push({
                                    label: path ? `${path}.${k}` : k,
                                    desc: `System Hotkey`,
                                    meta: val.custom || val.default || "None",
                                    callback: () => window.siyuan.globalCommand?.(k, this.app)
                                });
                            } else {
                                traverseKeys(val, path ? `${path}.${k}` : k);
                            }
                        }
                    }
                };
                traverseKeys(keymap);
            } else if (currentTab === "slash") {
                titleText = "编辑器斜杠功能";
                this.slashCommands.forEach(s => data.push({ label: `/${s.id}`, desc: s.label, meta: s.meta }));
                this.app.plugins?.forEach(p => {
                    p.protyleSlash?.forEach(s => {
                        data.push({ label: `/${s.id}`, desc: `来自插件: ${p.displayName || p.name}`, meta: "Plugin Slash" });
                    });
                });
            } else if (currentTab === "api") {
                titleText = "后端 API 清单";
                data = this.backendAPIs.map(api => ({ label: api.name, desc: api.desc, meta: api.path }));
            } else if (currentTab === "transaction") {
                titleText = "事务动作类型";
                data = this.transactionActions.map(op => ({ label: op.name, desc: op.desc, meta: op.meta }));
            } else if (currentTab === "uisniff") {
                titleText = "UI 菜单嗅探 (深度)";
                data = this.sniffedUIResults;
            } else if (currentTab === "slashsniff") {
                titleText = "斜杠命令嗅探 (深度)";
                data = this.sniffedSlashResults;
            }

            titleEl.textContent = `${titleText} (${data.length})`;

            const headerHtml = `
                <div class="fn__flex" style="padding: 8px; border-bottom: 1px solid var(--b3-border-color); overflow-x: auto; white-space: nowrap; gap: 4px;">
                    ${["plugin", "system", "slash", "api", "transaction", "uisniff", "slashsniff"].map(t => `
                        <button class="b3-button ${currentTab === t ? '' : 'b3-button--outline'}" style="flex-shrink:0" data-tab="${t}">
                            ${t === 'plugin' ? '插件' : t === 'system' ? '系统' : t === 'slash' ? '斜杠(定)' : t === 'api' ? 'API' : t === 'transaction' ? '事务' : t === 'uisniff' ? '菜单嗅探' : '斜杠嗅探'}
                        </button>
                    `).join("")}
                </div>`;

            let actionBtnHtml = "";
            if (currentTab === "uisniff") {
                actionBtnHtml = `<div style="padding: 10px; text-align: center;">
                    <button class="b3-button" id="startUISniff" style="width: 220px;">开始捕获“内容菜单”项</button>
                    <p style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 8px;">
                        模拟对文本块执行右键操作，嗅探源码硬编码的所有菜单功能。
                    </p>
                </div>`;
            } else if (currentTab === "slashsniff") {
                actionBtnHtml = `<div style="padding: 10px; text-align: center;">
                    <button class="b3-button" id="startSlashSniff" style="width: 220px;">开始捕获“斜杠命令”项</button>
                    <p style="font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 8px;">
                        模拟输入 / 字符，嗅探内核及其它插件注入的所有斜杠指令。
                    </p>
                </div>`;
            }

            contentEl.innerHTML = `
                ${headerHtml}
                ${actionBtnHtml}
                <div style="max-height:60vh; overflow-y:auto; padding:8px;">
                    ${data.map((item, index) => `
                        <div class="b3-list-item list-item-action" data-index="${index}" style="padding:8px; cursor:pointer; border-bottom:1px solid var(--b3-border-color-low);">
                            <div class="fn__flex">
                                <div style="font-weight:bold; flex: 1;">${item.label}</div>
                                <div style="color:var(--b3-theme-on-surface-light); font-size:12px;">${item.meta || ""}</div>
                            </div>
                            <div style="font-size:11px; color:var(--b3-theme-on-surface-light); margin-top:2px;">${item.desc || ""}</div>
                        </div>
                    `).join("")}
                    ${data.length === 0 && (currentTab === "uisniff" || currentTab === "slashsniff") ? "<div style='padding:20px; text-align:center;'>点击上方按钮运行探测器</div>" : ""}
                </div>
                <div style="padding:10px; font-size:12px; border-top:1px solid var(--b3-border-color); color:var(--b3-theme-on-surface-light); text-align:center;">
                    <div style="margin-bottom: 8px;">
                        ${currentTab === 'uisniff' || currentTab === 'slashsniff' ? '嗅探到的项目表示 UI 源码中硬编码的功能' : '点击复制路径/名称，或执行命令'}
                    </div>
                    <button class="b3-button b3-button--outline" id="exportData" style="font-size: 11px; padding: 4px 12px;">导出全量指令集 (JSON)</button>
                </div>
            `;

            contentEl.querySelectorAll("button[data-tab]").forEach(btn => {
                btn.onclick = () => {
                    currentTab = btn.dataset.tab;
                    updateDialog(dialog);
                };
            });

            const uiSniffBtn = contentEl.querySelector("#startUISniff");
            if (uiSniffBtn) {
                uiSniffBtn.onclick = async () => {
                    uiSniffBtn.textContent = "嗅探中...";
                    this.sniffedUIResults = await this.performHeadlessSniff();
                    updateDialog(dialog);
                };
            }

            const slashSniffBtn = contentEl.querySelector("#startSlashSniff");
            if (slashSniffBtn) {
                slashSniffBtn.onclick = async () => {
                    slashSniffBtn.textContent = "嗅探中...";
                    this.sniffedSlashResults = await this.performSlashSniff();
                    updateDialog(dialog);
                };
            }

            const exportBtn = contentEl.querySelector("#exportData");
            if (exportBtn) {
                exportBtn.onclick = () => this.exportAllData();
            }

            contentEl.querySelectorAll(".list-item-action").forEach(el => {
                el.onclick = () => {
                    const idx = el.dataset.index;
                    const item = data[idx];
                    if (item.callback) {
                        try { item.callback(); showMessage(`已触发: ${item.label}`); }
                        catch (e) { showMessage(`执行失败: ${e.message}`, -1, "error"); }
                    } else {
                        const copyVal = (currentTab === 'api' || currentTab === 'uisniff') ? (item.meta || item.label) : item.label;
                        navigator.clipboard.writeText(copyVal);
                        showMessage(`已复制: ${copyVal}`);
                    }
                };
            });
        };

        const dialog = new Dialog({
            title: "SiYuan 开发者探索 - 深度模式",
            content: "<div style='padding:40px; text-align:center;'>加载中...</div>",
            width: window.siyuan.isMobile ? "95%" : "750px",
        });
        updateDialog(dialog);
    }

    getProtyle() {
        let protyle = window.siyuan.editor?.currentEditor?.protyle;
        if (!protyle) {
            const findProtyle = (layout) => {
                if (!layout) return null;
                if (layout.model?.editor?.protyle) return layout.model.editor.protyle;
                if (layout.children) {
                    for (const child of layout.children) {
                        const res = findProtyle(child);
                        if (res) return res;
                    }
                }
                return null;
            };
            protyle = findProtyle(window.siyuan.layout.centerLayout);
        }
        return protyle;
    }

    async performHeadlessSniff() {
        console.log("[CommandLister] Starting Headless Sniff (Dual Mode)...");
        const protyle = this.getProtyle();
        if (!protyle) {
            showMessage("未发现打开的编辑器");
            return [];
        }

        const results = [];
        const seen = new Set();
        const menu = window.siyuan.menus.menu;
        const oAppend = menu.append;
        const oAddItem = menu.addItem;
        const oPopup = menu.popup;

        const tabName = protyle.path ? protyle.path.split('/').pop() : '编辑器';

        const sniffer = (el) => {
            if (!el) return;
            const label = (el.querySelector(".b3-menu__label")?.textContent || el.textContent || "").trim();
            const id = el.getAttribute("data-id") || "no-id";
            const key = label + id;
            if (label && label !== "返回" && !seen.has(key)) {
                seen.add(key);
                results.push({
                    label,
                    desc: `来自页签: ${tabName}`,
                    meta: id
                });
            }
        };

        menu.append = (el) => sniffer(el);
        menu.addItem = (opt) => {
            const btn = document.createElement("button");
            btn.setAttribute("data-id", opt.id || "");
            btn.innerHTML = `<span class="b3-menu__label">${opt.label}</span>`;
            sniffer(btn);
            return btn;
        };
        menu.popup = () => { };

        const trigger = (isSelect) => {
            const mockNode = document.createElement("div");
            mockNode.setAttribute("data-node-id", "sniff-" + Date.now());
            mockNode.setAttribute("data-type", "NodeParagraph");
            if (isSelect) mockNode.className = "protyle-wysiwyg--select";
            mockNode.innerHTML = "Sniffing...";

            protyle.wysiwyg.element.appendChild(mockNode);
            const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
            Object.defineProperty(ev, 'detail', { value: { target: mockNode, x: 100, y: 100 } });
            mockNode.dispatchEvent(ev);
            mockNode.remove();
        };

        try {
            // 模式 1: 模拟块内右键 (内容菜单)
            trigger(false);
            // 模式 2: 模拟块选中右键 (动作菜单 - 包含 转换为/移动 等核心功能)
            trigger(true);
        } catch (e) {
            console.error("Sniff error", e);
        } finally {
            menu.append = oAppend; menu.addItem = oAddItem; menu.popup = oPopup;
            menu.remove();
        }

        showMessage(`探测完成：共捕获 ${results.length} 个 UI 命令`);
        return results;
    }

    async performSlashSniff() {
        console.log("[CommandLister] Starting SlashSniff...");
        const protyle = this.getProtyle();
        if (!protyle) {
            showMessage("未发现打开的编辑器");
            return [];
        }

        const results = [];
        const tabName = protyle.path ? protyle.path.split('/').pop() : '编辑器';
        const hint = protyle.hint;
        const oGenHTML = hint.genHTML;
        const oEnableSlash = hint.enableSlash;
        const oEnableExtend = hint.enableExtend;

        hint.genHTML = (data) => {
            data.forEach(item => {
                if (item.html === "separator") return;
                const tmp = document.createElement("div");
                tmp.innerHTML = item.html;
                const label = (tmp.querySelector(".b3-list-item__text")?.textContent || tmp.textContent || "").trim();
                results.push({
                    label,
                    desc: item.filter ? `触发词: ${item.filter.join(", ")}` : `来自页签: ${tabName}`,
                    meta: item.value || "no-value"
                });
            });
        };

        try {
            hint.enableSlash = true;
            hint.enableExtend = true;
            const mockNode = document.createElement("div");
            mockNode.setAttribute("data-node-id", "slash-sniff-" + Date.now());
            mockNode.setAttribute("data-type", "NodeParagraph");
            mockNode.innerHTML = '/';
            protyle.wysiwyg.element.appendChild(mockNode);

            const range = document.createRange();
            if (mockNode.firstChild) {
                range.setStart(mockNode.firstChild, 1);
                range.collapse(true);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                hint.render(protyle);
            }
            mockNode.remove();
        } catch (e) {
            console.error("[CommandLister] SlashSniff error", e);
        } finally {
            hint.genHTML = oGenHTML;
            hint.enableSlash = oEnableSlash;
            hint.enableExtend = oEnableExtend;
            hint.element.classList.add("fn__none");
        }

        showMessage(`嗅探到 ${results.length} 个斜杠命令`);
        return results;
    }


    exportAllData() {
        const allData = {
            exportTime: new Date().toLocaleString(),
            categories: {
                pluginCommands: [],
                systemKeymaps: [],
                slashCommands: [],
                apiEndpoints: this.backendAPIs,
                transactionActions: this.transactionActions,
                sniffedUI: this.sniffedUIResults,
                sniffedSlash: this.sniffedSlashResults
            }
        };

        // 收集插件命令
        this.app.plugins?.forEach(p => {
            p.commands?.forEach(cmd => {
                allData.categories.pluginCommands.push({
                    plugin: p.name,
                    label: this.getCommandLabel(cmd, p),
                    id: cmd.id || cmd.langKey,
                    hotkey: cmd.customHotkey || cmd.hotkey || ""
                });
            });
        });

        // 收集系统命令
        const keymap = window.siyuan?.config?.keymap || {};
        const traverse = (obj, path = "") => {
            for (let k in obj) {
                const val = obj[k];
                if (val && typeof val === 'object') {
                    if (val.default !== undefined) {
                        allData.categories.systemKeymaps.push({ id: path ? `${path}.${k}` : k, hotkey: val.custom || val.default });
                    } else traverse(val, path ? `${path}.${k}` : k);
                }
            }
        };
        traverse(keymap);

        // 收集斜杠预览
        this.slashCommands.forEach(s => allData.categories.slashCommands.push({ id: s.id, label: s.label }));

        const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `siyuan-discovery-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage("全量数据已导出为 JSON");
    }

    getCommandLabel(cmd, plugin) {
        return cmd.langText || plugin.i18n?.[cmd.langKey] || cmd.langKey || cmd.id;
    }
}

module.exports = CommandLister;