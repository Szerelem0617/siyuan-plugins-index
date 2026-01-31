import { plugin } from "../../shared/utils";

export const CONFIG = "config";

export class SettingsProperty {
    depth: number;
    listType: string;
    linkType: string;
    builderAutoUpdate: boolean;
    autoUpdate: boolean;
    col: number;
    fold: number;
    outlineAutoUpdate: boolean;
    outlineType: string;
    listTypeOutline: string;
    insertionMode: string;
    depthNotebook: number;
    listTypeNotebook: string;
    linkTypeNotebook: string;
    iconNotebook: boolean;
    icon: boolean;
    iconOutline: boolean;

    constructor(){
        this.depth = 0;
        this.listType = "unordered";
        this.linkType = "ref";
        this.builderAutoUpdate = true;
        this.autoUpdate = true;
        this.col = 1;
        this.fold = 0;
        this.outlineAutoUpdate = true;
        this.outlineType = "ref";
        this.listTypeOutline = "unordered";
        this.insertionMode = "index";
        this.depthNotebook = 3;
        this.listTypeNotebook = "unordered";
        this.linkTypeNotebook = "ref";
        this.iconNotebook = true;
        this.icon = false;
        this.iconOutline = false;
    }

    getAll(){
        // Usually called to sync local instance with global settings
        // But get() is static-like on the instance.
        // This method seems redundant if we use settings.get() directly, but kept for compatibility.
        this.depth = settings.get("depth");
        this.listType = settings.get("listType");
        this.linkType = settings.get("linkType");
        this.builderAutoUpdate = settings.get("builderAutoUpdate");
        this.autoUpdate = settings.get("autoUpdate");
        this.col = settings.get("col");
        this.fold = settings.get("fold");
        this.outlineAutoUpdate = settings.get("outlineAutoUpdate");
        this.outlineType = settings.get("outlineType");
        this.listTypeOutline = settings.get("listTypeOutline");
        this.insertionMode = settings.get("insertionMode");
        this.depthNotebook = settings.get("depthNotebook") ?? 3;
        this.listTypeNotebook = settings.get("listTypeNotebook") ?? "unordered";
        this.linkTypeNotebook = settings.get("linkTypeNotebook") ?? "ref";
        this.iconNotebook = settings.get("iconNotebook") ?? true;
        this.icon = settings.get("icon") ?? false;
        this.iconOutline = settings.get("iconOutline") ?? false;
    }
}

class Settings {
    async initData() {
        await this.load();
        if (plugin.data[CONFIG] === "" || plugin.data[CONFIG] === undefined || plugin.data[CONFIG] === null) {
            await plugin.saveData(CONFIG, new SettingsProperty());
        }
        await this.load();
    }

    set(key: any, value: any, config = CONFIG){
        plugin.data[config][key] = value;
    }

    get(key: any, config = CONFIG){
        return plugin.data[config]?.[key];
    }

    async load(config = CONFIG){
        await plugin.loadData(config);
    }

    async save(config = CONFIG){
        await plugin.saveData(config, plugin.data[config]);
    }

    loadSettings(data: any){
        const def = new SettingsProperty();
        this.set("depth", data.depth ?? def.depth);
        this.set("listType", data.listType ?? def.listType);
        this.set("linkType", data.linkType ?? def.linkType);
        this.set("fold", data.fold ?? def.fold);
        this.set("col", data.col ?? def.col);
        this.set("autoUpdate", data.autoUpdate ?? def.autoUpdate);
        this.set("insertionMode", data.insertionMode ?? def.insertionMode);
        this.set("icon", data.icon ?? def.icon);
        this.set("builderAutoUpdate", data.builderAutoUpdate ?? def.builderAutoUpdate);
    }

    loadSettingsforOutline(data: any){
        const def = new SettingsProperty();
        this.set("outlineType", data.outlineType ?? def.outlineType);
        this.set("outlineAutoUpdate", data.outlineAutoUpdate ?? def.outlineAutoUpdate);
        this.set("listTypeOutline", data.listTypeOutline ?? def.listTypeOutline);
        this.set("iconOutline", data.iconOutline ?? def.iconOutline);
    }
}

export const settings = new Settings();
