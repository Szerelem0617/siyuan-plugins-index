import { Plugin, Dialog } from "siyuan";
import { setI18n, setPlugin } from "./shared/utils";
import { createDialog, initTopbar } from "./ui/topbar";
import { settings, CONFIG } from "./core/settings";
import { buildDoc as buildDocNew } from "./features/builder/menu";
import { addDataMenuItems } from "./features/data/list/menu";
import { addAVMenuItems, avEventHandler } from "./features/data/attribute-view/events";
import { updateIndex, execAutoUpdate } from "./events/protyle-event";
import { initEmojiEvent, removeEmojiEvent } from "./events/emoji-event";
import { addSlash } from "./core/slash";
import { addCommandTestMenuItem, refreshSupertagRegistry, DEV_ENABLE_INIT_SYS } from "./features/command/registration";
import { commandRegistry } from "./features/command/registry/command-registry";
import { supertagMonitor } from "./features/command/supertag/supertag";
import { supertagManager } from "./features/command/supertag/supertag-manager";
import { initTagSuggestion, bindProtyleHintExtend } from "./features/command/supertag/tag-suggestion";
import { refreshTopBarCommands, handleTopBarEvents, destroyTopBarCommands } from "./features/command/global-registration/top-bar";
import { initInlineButtonListener, destroyInlineButtonListener, handleBtnPaste } from "./features/command/global-registration/inline-button";
import { initCommandPalette, destroyCommandPalette } from "./features/command/global-registration/command-palette";
import { initButtonLinkListener, destroyButtonLinkListener, initHoverTooltipListener, destroyHoverTooltipListener } from "./features/command/av-interaction";
import SQLiteStatus from "./features/sqlite/sqlite-status.svelte";
import { getSqliteEngine, runQuery, executeWritableSql, instantiateAV, registerFriendlyTableName } from "./features/sqlite/sqlite-manager";
import { version } from "../plugin.json";
import { initSystemTables } from "./features/command/indexos/command-sqlite";
import { canUseFeature } from "./features/dev-mode/policy-guard";
import { triggerFireworks } from "./features/command/effect/fireworks";
import { triggerShowMessage } from "./features/command/effect/show-message";
import { triggerTurnIntoTask } from "./features/command/effect/turn-into-task";
import { addSupertagMenuItems, openSupertagManagerDialog } from "./features/command/supertag/SupertagMenu";
import { SupertagRenderer } from "./features/command/supertag/SupertagRenderer";

export default class IndexPlugin extends Plugin {
    private switchHandler: any;
    private lastActiveDoc: { rootId: string, notebookId: string, path: string } | null = null;

    //加载插件
    async onload() {
        console.log(`IndexPlugin onload v${version}`);
        
        // Expose global database SQL API
        (window as any).indexOS = {
            db: {
                runQuery,
                executeWritableSql,
                instantiateAV,
                registerFriendlyTableName,
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

        if (DEV_ENABLE_INIT_SYS) {
            refreshSupertagRegistry();
            await refreshTopBarCommands();
        }
        this.init();
        await initTopbar();
        // await this.initSettings();
        await settings.initData();
        //监听块菜单事件
        this.eventBus.on("click-blockicon", buildDocNew);
        this.eventBus.on("click-blockicon", addDataMenuItems);
        this.eventBus.on("click-blockicon", addSupertagMenuItems);
        if (DEV_ENABLE_INIT_SYS) {
            this.eventBus.on("click-blockicon", addCommandTestMenuItem);
        }
        this.eventBus.on("open-menu-av", addAVMenuItems);
        //监听文档载入事件
        this.eventBus.on("loaded-protyle-static", updateIndex);
        this.eventBus.on("loaded-protyle-static", (event: any) => {
            const protyle = event.detail.protyle;
            if (protyle) {
                (window as any).activeProtyleInstance = protyle;
                bindProtyleHintExtend(protyle);
                SupertagRenderer.render(protyle);
            }
        });
        this.eventBus.on("loaded-protyle-dynamic", (event: any) => {
            const protyle = event.detail.protyle;
            if (protyle) {
                (window as any).activeProtyleInstance = protyle;
                bindProtyleHintExtend(protyle);
                SupertagRenderer.render(protyle);
            }
        });

        this.switchHandler = this.onTabSwitch.bind(this);
        this.eventBus.on("switch-protyle", this.switchHandler);

        if (DEV_ENABLE_INIT_SYS) {
            this.eventBus.on("ws-main", handleTopBarEvents);
        }

        initEmojiEvent();
        avEventHandler.init();
        supertagMonitor.init(this);
        supertagManager.init();
        await initTagSuggestion(this);
        if (DEV_ENABLE_INIT_SYS) {
            initInlineButtonListener();
            initCommandPalette();
            initButtonLinkListener();
            initHoverTooltipListener();
        }
        // paste 钩子始终激活：只对 siyuan-btn:// 链接生效，与实验模式无关
        this.eventBus.on("paste", handleBtnPaste);

        // Register global shortcut command for Alt + T to manage supertags
        this.addCommand({
            langKey: "manageSupertags",
            hotkey: "⌥T",
            customHotkey: "⌥t",
            callback: () => {
                const activeProtyle = (window as any).activeProtyleInstance;
                if (activeProtyle) {
                    const blockId = activeProtyle.block?.id || activeProtyle.blockId;
                    if (blockId) {
                        const blockEl = activeProtyle.element.querySelector(`[data-node-id="${blockId}"]`) || activeProtyle.element.querySelector(".protyle-title");
                        if (blockEl) {
                            openSupertagManagerDialog(blockId, blockEl);
                        }
                    }
                }
            }
        });

        // SQLite Entry Point: Alt + Click on Native Search Button
        if (DEV_ENABLE_INIT_SYS) {
            getSqliteEngine().then(async () => {
                console.log("[IndexOS] SQLite Engine Ready. Initializing builtin DB...");
                await initSystemTables();
                // Reload command registry from SQLite (Layer 1)
                await commandRegistry.loadFromDatabase();
                // Refresh registrations once DB is ready
                await refreshSupertagRegistry();
                await refreshTopBarCommands();
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
        if (DEV_ENABLE_INIT_SYS) {
            this.eventBus.off("click-blockicon", addCommandTestMenuItem);
        }
        this.eventBus.off("open-menu-av", addAVMenuItems);
        this.eventBus.off("loaded-protyle-static", updateIndex);
        this.eventBus.off("switch-protyle", this.switchHandler);
        if (DEV_ENABLE_INIT_SYS) {
            this.eventBus.off("ws-main", handleTopBarEvents);
        }

        removeEmojiEvent();
        avEventHandler.destroy();
        supertagMonitor.destroy();
        supertagManager.destroy();
        if (DEV_ENABLE_INIT_SYS) {
            destroyInlineButtonListener();
            destroyCommandPalette();
            destroyButtonLinkListener();
            destroyHoverTooltipListener();
            destroyTopBarCommands();
        }
        this.eventBus.off("paste", handleBtnPaste);

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

    onDataChanged() {
        settings.load();
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
            
            if (!canUseFeature("database.diagnose")) return;
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
    }

    private openSqliteStatus() {
        const dialog = new Dialog({
            title: "数据库管理",
            content: `<div id="sqlite-status-container" class="fn__flex-1" style="height: 100%;"></div>`,
            width: "850px",
            height: "650px",
        });

        const container = dialog.element.querySelector("#sqlite-status-container");
        if (container) {
            new SQLiteStatus({
                target: container,
            });
        }
    }

}