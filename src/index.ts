// IndexOS Plugin Entry
import { Plugin, Dialog } from "siyuan";
import { setI18n, setPlugin } from "./shared/utils";
import "./ui/styles/index.css";
import { createDialog, initTopbar } from "./ui/topbar";
import { settings, CONFIG } from "./core/settings";
import { buildDoc as buildDocNew } from "./features/builder/menu";
import { addDataMenuItems } from "./features/av/list/menu";
import { addAVMenuItems, avEventHandler } from "./features/av/attribute-view/events";
import { updateIndex, execAutoUpdate } from "./events/protyle-event";
import { initEmojiEvent, removeEmojiEvent } from "./events/emoji-event";
import { addSlash } from "./core/slash";
import { isDevInitSysEnabled, COMMAND_BINDINGS } from "./features/command/registration";
import { decodeBtnHref } from "./features/command/global-registration/inline-button";
import type { CommandContext } from "./features/command/command-dispatcher";
import { addCommandTestMenuItem, addDoctreeMenuItems, addEditorTitleIconMenuItems, addBlockEntryMenuItems, addPageEntryMenuItems, addEditorEntryMenuItems } from "./features/command/menu-hooks";
import { initEntryConfig } from "./features/command/entry-config";
import { refreshSupertagRegistry, syncGlobalSupertagsCache } from "./features/command/utils/sync-service";
import { commandRegistry } from "./features/command/registry/command-registry";
import { dispatchCommand } from "./features/command/command-dispatcher";
import { 
    supertagMonitor, 
    supertagManager, 
    initTagSuggestion, 
    destroyTagSuggestion,
    setTagSuggestionEnabled,
    SupertagRenderer, 
    initTagMenuInterceptor 
} from "./features/command/supertag";
import { refreshTopBarCommands, destroyTopBarCommands } from "./features/command/global-registration/top-bar";
import { initInlineButtonListener, destroyInlineButtonListener, handleBtnPaste } from "./features/command/global-registration/inline-button";
import { initCommandPalette, destroyCommandPalette } from "./features/command/global-registration/command-palette";
import { backgroundScheduler } from "./features/command/background/background-scheduler";
import { initButtonLinkListener, destroyButtonLinkListener, initHoverTooltipListener, destroyHoverTooltipListener } from "./features/command/av-interaction";
import SQLiteStatus from "./features/sqlite/sqlite-status.svelte";
import { getSqliteEngine, runQuery, executeWritableSql, instantiateAV, registerFriendlyTableName } from "./features/sqlite/sqlite-manager";
import { version } from "../plugin.json";
import { initSystemTables } from "./features/command/indexos/command-sqlite";
import { triggerFireworks } from "./features/command/effect/fireworks";
import { triggerShowMessage } from "./features/command/effect/show-message";
import { triggerTurnIntoTask } from "./features/command/effect/turn-into-task";
import { triggerSafeUpdateBlock } from "./features/command/effect/safe-update-block";

export default class IndexPlugin extends Plugin {
    private switchHandler: any;
    private lastActiveDoc: { rootId: string, notebookId: string, path: string } | null = null;
    private openUrlPluginHandler?: (event: any) => void;

    //加载插件
    async onload() {
        console.log(`IndexPlugin onload v${version}`);
        
        // Expose global database SQL API & Command API
        (window as any).indexOS = {
            db: {
                runQuery,
                executeWritableSql,
                instantiateAV,
                registerFriendlyTableName,
            },
            commands: {
                registerCommand: (def: any) => commandRegistry.registerCommand(def),
                unregisterPlugin: (pluginName: string) => commandRegistry.unregisterPlugin(pluginName),
                getCommand: (id: string) => commandRegistry.getCommand(id),
                executeCommand: (id: string, params?: any, context?: any) => dispatchCommand(id, params, context || { blockEl: document.body, protyleEl: null })
            }
        };
        // 内置命令表先行加载，其他所有模块（Dispatcher、第三方插件）均可安全地调用 getCommand()
        commandRegistry.loadBuiltins();
        
        const fireworksCmd = commandRegistry.getCommand("plugin-index.effect.fireworks");
        if (fireworksCmd) {
            fireworksCmd.dispatch.executor = triggerFireworks;
        }

        const showMsgCmd = commandRegistry.getCommand("siyuan.ui.toast");
        if (showMsgCmd) {
            showMsgCmd.dispatch.executor = triggerShowMessage;
        }

        const turnIntoTaskCmd = commandRegistry.getCommand("plugin-index.command.turnIntoTask");
        if (turnIntoTaskCmd) {
            turnIntoTaskCmd.dispatch.executor = triggerTurnIntoTask;
        }

        const safeUpdateCmd = commandRegistry.getCommand("plugin-index.command.safeUpdateBlock");
        if (safeUpdateCmd) {
            safeUpdateCmd.dispatch.executor = triggerSafeUpdateBlock;
        }



        this.init();
        await settings.initData();
        await initEntryConfig();
        addSlash(); // Rebuild slash items after settings are loaded
        await initTopbar();

        if (isDevInitSysEnabled()) {
            refreshSupertagRegistry();
            await refreshTopBarCommands();
        }
        //监听块菜单事件
        this.eventBus.on("click-blockicon", buildDocNew);
        this.eventBus.on("click-blockicon", addDataMenuItems);
        if (isDevInitSysEnabled()) {
            this.eventBus.on("click-blockicon", addCommandTestMenuItem);
            this.eventBus.on("click-blockicon", addBlockEntryMenuItems);
            this.eventBus.on("open-menu-doctree", addDoctreeMenuItems);
            this.eventBus.on("open-menu-doctree", addPageEntryMenuItems);
            this.eventBus.on("click-editortitleicon", addEditorTitleIconMenuItems);
            this.eventBus.on("click-editortitleicon", addEditorEntryMenuItems);
        }
        this.eventBus.on("open-menu-av", addAVMenuItems);
        //监听文档载入事件
        this.eventBus.on("loaded-protyle-static", updateIndex);
        this.eventBus.on("loaded-protyle-static", (event: any) => {
            const protyle = event.detail.protyle;
            if (protyle) {
                (window as any).activeProtyleInstance = protyle;
                SupertagRenderer.render(protyle);
            }
        });
        this.eventBus.on("loaded-protyle-dynamic", (event: any) => {
            const protyle = event.detail.protyle;
            if (protyle) {
                (window as any).activeProtyleInstance = protyle;
                SupertagRenderer.render(protyle);
            }
        });

        this.switchHandler = this.onTabSwitch.bind(this);
        this.eventBus.on("switch-protyle", this.switchHandler);

        initEmojiEvent();
        avEventHandler.init();
        supertagMonitor.init(this);
        supertagManager.updateState();
        SupertagRenderer.initAutoObserver();
        await initTagSuggestion(this);
        initTagMenuInterceptor();
        backgroundScheduler.init(this);

        // 监听设置变化事件，实现开发者模式开关实时刷新生效
        window.addEventListener("index-plugin-setting-changed", (e: CustomEvent) => {
            if (e.detail?.key === "devMode") {
                supertagManager.updateState();
                setTagSuggestionEnabled(!!e.detail.value);
            }
        });
        if (isDevInitSysEnabled()) {
            initInlineButtonListener();
            initCommandPalette();
            initButtonLinkListener();
            initHoverTooltipListener();
        }
        // paste 钩子始终激活：只对 siyuan-btn:// 链接生效，与实验模式无关
        this.eventBus.on("paste", handleBtnPaste);

        // 思源 3.7.3 官方 siyuan://plugins/siyuan-plugins-index/ 协议监听处理
        this.openUrlPluginHandler = (event: any) => {
            const url = event?.detail?.url || event?.url;
            if (url) {
                console.log("[IndexOS] Received open-siyuan-url-plugin event:", url);
                const payload = decodeBtnHref(url);
                if (payload && payload.command) {
                    const commandRef = COMMAND_BINDINGS[payload.command]?.commandRef || payload.command;
                    const activeProtyle = (window as any).activeProtyleInstance;
                    const blockEl = activeProtyle?.element?.querySelector(".protyle-wysiwyg--select") || document.activeElement;
                    const context: CommandContext = {
                        blockEl: blockEl as HTMLElement,
                        protyleEl: activeProtyle?.element || null
                    };
                    dispatchCommand(commandRef, payload.param, context);
                }
            }
        };
        this.eventBus.on("open-siyuan-url-plugin", this.openUrlPluginHandler);



        // SQLite Entry Point: Alt + Click on Native Search Button
        if (isDevInitSysEnabled()) {
            getSqliteEngine().then(async () => {
                console.log("[IndexOS] SQLite Engine Ready. Initializing builtin DB...");
                await initSystemTables();
                // Reload command registry from SQLite (Layer 1)
                await commandRegistry.loadFromDatabase();
                // Refresh registrations once DB is ready
                await refreshSupertagRegistry();
                await refreshTopBarCommands();
                await syncGlobalSupertagsCache();
                
                // 广播 indexos-ready 全局事件通知第三方插件
                window.dispatchEvent(new CustomEvent("indexos-ready", { detail: (window as any).indexOS }));
            }).catch(e => console.error("[SQLite] Preload failed", e));
            this.registerSqliteEntry();
        }
    }
    // onLayoutReady() {
    //     initObserver();
    // }

    onunload() {
        this.eventBus.off("click-blockicon", buildDocNew);
        this.eventBus.off("click-blockicon", addDataMenuItems);
        if (isDevInitSysEnabled()) {
            this.eventBus.off("click-blockicon", addCommandTestMenuItem);
            this.eventBus.off("click-blockicon", addBlockEntryMenuItems);
            this.eventBus.off("open-menu-doctree", addDoctreeMenuItems);
            this.eventBus.off("open-menu-doctree", addPageEntryMenuItems);
            this.eventBus.off("click-editortitleicon", addEditorTitleIconMenuItems);
            this.eventBus.off("click-editortitleicon", addEditorEntryMenuItems);
        }
        this.eventBus.off("open-menu-av", addAVMenuItems);
        this.eventBus.off("loaded-protyle-static", updateIndex);
        this.eventBus.off("switch-protyle", this.switchHandler);
        removeEmojiEvent();
        avEventHandler.destroy();
        supertagMonitor.destroy();
        supertagManager.destroy();
        if (isDevInitSysEnabled()) {
            destroyInlineButtonListener();
            destroyCommandPalette();
            destroyButtonLinkListener();
            destroyHoverTooltipListener();
            destroyTopBarCommands();
        }
        destroyTagSuggestion();
        backgroundScheduler.stop();
        this.eventBus.off("paste", handleBtnPaste);
        if (this.openUrlPluginHandler) {
            this.eventBus.off("open-siyuan-url-plugin", this.openUrlPluginHandler);
        }

        // Remove Search bar event listener to prevent hot reload leakage
        const btn = document.querySelector("#barSearch");
        if (btn) {
            btn.removeEventListener("mousedown", this.handleSearchMouseDown, true);
        }

        console.log("IndexPlugin onunload");
        
        // Clean up global API
        delete (window as any).indexOS;
    }

    private async onTabSwitch({ detail }: any) {
        // Trigger update for the PREVIOUS doc
        if (this.lastActiveDoc) {
            await execAutoUpdate(this.lastActiveDoc.rootId, this.lastActiveDoc.notebookId, this.lastActiveDoc.path);
        }

        // Update current
        if (detail && detail.protyle) {
            (window as any).activeProtyleInstance = detail.protyle;
            if (detail.protyle.block) {
                this.lastActiveDoc = {
                    rootId: detail.protyle.block.rootID,
                    notebookId: detail.protyle.notebookId,
                    path: detail.protyle.path
                };
            }
            SupertagRenderer.render(detail.protyle);
        }
    }

    uninstall() {
        this.removeData(CONFIG).catch(e => {
            console.error(`Uninstall [${this.name}] remove data [${CONFIG}] fail: ${e.message}`);
        });
    }

    async onDataChanged() {
        await settings.load();
        addSlash();
    }

    //获取i18n和插件类实例
    init() {
        setI18n(this.i18n);
        setPlugin(this);
        addSlash();
        // console.log(this.getOpenedTab());
    }

    //输出事件detail
    // private eventBusLog({detail}: any) {
    //     console.log(detail);
    // }
    async openSetting() {
        await createDialog();
    }

    private handleSearchMouseDown = (e: MouseEvent) => {
        if (e.altKey) {
            e.stopPropagation();
            e.preventDefault();
            
            this.openSqliteStatus();
        }
    }

    private registerSqliteEntry() {
        const addListener = () => {
            const btn = document.querySelector("#barSearch");
            if (btn) {
                btn.addEventListener("mousedown", this.handleSearchMouseDown, true);
                return true;
            }
            return false;
        };
        if (!addListener()) {
            const observer = new MutationObserver(() => {
                if (addListener()) observer.disconnect();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        // 全局快捷键监听: Cmd + Alt + S / Ctrl + Alt + S 呼出命令与数据库管理面板
        window.addEventListener("keydown", (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === "s" || e.key === "S")) {
                e.preventDefault();
                e.stopPropagation();
                this.openSqliteStatus();
            }
        }, true);
    }

    public openSqliteStatus() {
        const dialog = new Dialog({
            title: "数据库与命令管理",
            content: `<div id="sqlite-status-container" class="fn__flex-1" style="height: 100%;"></div>`,
            width: "850px",
            height: "650px",
        });
        dialog.element.classList.add("indexos-dialog");

        const container = dialog.element.querySelector("#sqlite-status-container");
        if (container) {
            new SQLiteStatus({
                target: container,
            });
        }
    }

}
