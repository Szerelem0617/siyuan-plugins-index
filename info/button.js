const siyuan = require("siyuan");

const Plugin = siyuan.Plugin;
const showMessage = siyuan.showMessage;
const Dialog = siyuan.Dialog;

class MyPlugin extends Plugin {
    
    onload() {
        console.log("🚀 智能按钮插件 (v1.5.0 Gold) 已加载");

        this.protyleSlash = [{
            filter: ["btn", "button", "按钮"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">插入智能按钮</span><span class="b3-list-item__meta">插件</span></div>`,
            id: "insert-smart-button",
            callback: (protyle) => {
                // 1. 抓取光标位置
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    this.openButtonCreator(protyle, range);
                }
            }
        }];

        this.handleBlockClick = this.handleBlockClick.bind(this);
        window.addEventListener("click", this.handleBlockClick, true);
    }

    onunload() {
        window.removeEventListener("click", this.handleBlockClick, true);
    }

    openButtonCreator(protyle, savedRange) {
        const dialog = new Dialog({
            title: "🔘 创建智能按钮",
            content: `
                <div class="b3-dialog__content" style="display: flex; flex-direction: column; gap: 15px; padding-top: 20px;">
                    <label class="fn__flex" style="align-items: center;">
                        <span style="width: 100px">按钮文字</span>
                        <input class="b3-text-field fn__flex-1" id="btn-label" value="点击我">
                    </label>
                    <label class="fn__flex" style="align-items: center;">
                        <span style="width: 100px">选择功能</span>
                        <select class="b3-select fn__flex-1" id="btn-action">
                            <option value="showMessage">💬 弹出消息</option>
                            <option value="copyContent">📋 复制文本</option>
                            <option value="openLink">🔗 打开链接</option>
                        </select>
                    </label>
                    <label class="fn__flex" style="align-items: center;">
                        <span style="width: 100px">参数内容</span>
                        <input class="b3-text-field fn__flex-1" id="btn-param" placeholder="例如：Hello World">
                    </label>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel">取消</button>
                    <button class="b3-button b3-button--text" id="confirm-btn">插入</button>
                </div>
            `,
            width: "500px",
        });

        const contentEl = dialog.element.querySelector(".b3-dialog__content");
        const confirmBtn = dialog.element.querySelector("#confirm-btn");
        const cancelBtn = dialog.element.querySelector(".b3-button--cancel");

        cancelBtn.addEventListener("click", () => dialog.destroy());

        confirmBtn.addEventListener("click", () => {
            const label = contentEl.querySelector("#btn-label").value || "未命名";
            const action = contentEl.querySelector("#btn-action").value;
            const param = contentEl.querySelector("#btn-param").value;

            // 构造配置
            const configObj = { action, param };
            const configStr = JSON.stringify(configObj).replace(/"/g, '&quot;');

            // ⚠️ 样式微调：vertical-align: middle 让它和文字混排时更居中
            // 不需要外层 div，让它成为行内块，这样可以和文字并在
            const rawButtonHTML = `
                <button class="siyuan-plugin-btn" 
                        data-config="${configStr}" 
                        style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            padding: 4px 10px; 
                            margin: 0 4px;
                            border: 1px solid #d1d5db; 
                            background-color: #ffffff; 
                            border-radius: 5px; 
                            cursor: pointer; 
                            font-size: 14px; 
                            line-height: 1.5;
                            color: #374151;
                            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                            transition: all 0.2s;
                            vertical-align: middle;
                            user-select: none;
                        "
                        onmouseover="this.style.backgroundColor='#f3f4f6';this.style.borderColor='#9ca3af'"
                        onmouseout="this.style.backgroundColor='#ffffff';this.style.borderColor='#d1d5db'"
                >
                    ${label}
                </button>
            `;

            // 封装进胶囊
            const encodedContent = this.escapeHtml(rawButtonHTML);
            const blockHTML = `<protyle-html data-content="${encodedContent}"></protyle-html>`;

            try {
                // 1. 恢复焦点
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(savedRange);

                // 2. 尝试清理战场：如果选区内有内容（比如还没消失的 /btn），删掉它
                if (!selection.isCollapsed) {
                    document.execCommand('delete');
                }

                // 3. 插入
                if (typeof protyle.insert === 'function') {
                    // 使用 insert 插入，自动处理块逻辑
                    protyle.insert(blockHTML);
                } else {
                    document.execCommand("insertHTML", false, blockHTML);
                }
            } catch (e) {
                console.error("插入异常:", e);
                showMessage("插入失败", -1, "error");
            }
            
            dialog.destroy();
        });
    }

    handleBlockClick(event) {
        const path = event.composedPath();
        const btn = path.find(element => 
            element instanceof HTMLElement && 
            element.classList.contains("siyuan-plugin-btn")
        );

        if (!btn) return;

        event.stopPropagation();
        event.preventDefault();

        try {
            const configStr = btn.getAttribute("data-config");
            if (!configStr) return;
            const config = JSON.parse(configStr);

            switch (config.action) {
                case "showMessage":
                    showMessage(config.param || "Hello World!");
                    break;
                case "copyContent":
                    this.copyText(config.param);
                    break;
                case "openLink":
                    this.openLink(config.param);
                    break;
                default:
                    showMessage(`未知功能: ${config.action}`, -1, "error");
            }
        } catch (e) {
            console.error(e);
        }
    }

    escapeHtml(string) {
        const entityMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' };
        return String(string).replace(/[&<>"'`=\/]/g, s => entityMap[s]);
    }

    copyText(text) {
        if (!text) { showMessage("内容为空", -1, "error"); return; }
        navigator.clipboard.writeText(text).then(() => showMessage("✅ 已复制"));
    }

    openLink(url) {
        if (!url) { showMessage("URL为空", -1, "error"); return; }
        if (!url.startsWith("http") && !url.startsWith("siyuan")) url = "https://" + url;
        window.open(url, "_blank");
    }
}

module.exports = MyPlugin;