import { Plugin } from "siyuan";
import { setI18n, setPlugin } from "./shared/utils";
import { createDialog, initTopbar } from "./ui/topbar";
import { settings, CONFIG } from "./core/settings";
import { buildDoc as buildDocNew } from "./features/builder/menu";
import { updateIndex } from "./events/protyle-event";
import { initEmojiEvent, removeEmojiEvent } from "./events/emoji-event";
import { addSlash } from "./core/slash";
import { version } from "../plugin.json";

export default class IndexPlugin extends Plugin {

    //加载插件
    async onload() {
        console.log(`IndexPlugin onload v${version}`);
        this.init();
        await initTopbar();
        // await this.initSettings();
        await settings.initData();
        //监听块菜单事件
        this.eventBus.on("click-blockicon", buildDocNew);
        //监听文档载入事件
        this.eventBus.on("loaded-protyle-static", updateIndex);
        // this.eventBus.on("ws-main",this.eventBusLog);
        initEmojiEvent();
    }
    // onLayoutReady() {
    //     initObserver();
    // }

    onunload() {
        this.eventBus.off("click-blockicon", buildDocNew);
        this.eventBus.off("loaded-protyle-static", updateIndex);
        removeEmojiEvent();
        console.log("IndexPlugin onunload");
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
    init(){
        setI18n(this.i18n);
        setPlugin(this);
        addSlash();
        // console.log(this.getOpenedTab());
    }

    //输出事件detail
    // private eventBusLog({detail}: any) {
    //     console.log(detail);
    // }
    async openSetting(){
        await createDialog();
    }

}