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

    depthNotebook: number;
    listTypeNotebook: string;
    linkTypeNotebook: string;
    iconNotebook: boolean;
    icon: boolean;
    iconOutline: boolean;
    dbAddTemplateCols: boolean;

    constructor() {
        this.depth = 0;
        this.listType = "unordered";
        this.linkType = "link";
        this.builderAutoUpdate = true;
        this.autoUpdate = true;
        this.col = 1;
        this.fold = 0;
        this.outlineAutoUpdate = true;
        this.outlineType = "link";
        this.listTypeOutline = "unordered";

        this.depthNotebook = 3;
        this.listTypeNotebook = "unordered";
        this.linkTypeNotebook = "link";
        this.iconNotebook = true;
        this.icon = false;
        this.iconOutline = false;
        this.dbAddTemplateCols = true;
    }

    getAll() {
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

        this.depthNotebook = settings.get("depthNotebook") ?? 3;
        this.listTypeNotebook = settings.get("listTypeNotebook") ?? "unordered";
        this.linkTypeNotebook = settings.get("linkTypeNotebook") ?? "link";
        this.iconNotebook = settings.get("iconNotebook") ?? true;
        this.icon = settings.get("icon") ?? false;
        this.iconOutline = settings.get("iconOutline") ?? false;
        this.dbAddTemplateCols = settings.get("dbAddTemplateCols") ?? true;
    }
}

class Settings {
    async initData() {
        await this.load();
        if (plugin.data[CONFIG] === "" || plugin.data[CONFIG] === undefined || plugin.data[CONFIG] === null) {
            await plugin.saveData(CONFIG, new SettingsProperty());
        }
        await this.load();

        // Migrate old config values to new format
        let needsSave = false;
        const data = plugin.data[CONFIG];
        if (data) {
            if (data.linkType === "ref") { data.linkType = "link"; needsSave = true; }
            if (data.linkType === "embed") { data.linkType = "reference"; needsSave = true; }
            if (data.useDynamicAnchor === true && data.linkType !== "dynamic-ref") { data.linkType = "dynamic-ref"; needsSave = true; }
            if (data.outlineType === "ref") { data.outlineType = "link"; needsSave = true; }
            if (data.outlineType === "embed") { data.outlineType = "reference"; needsSave = true; }
            if (data.useDynamicAnchorOutline === true && data.outlineType !== "dynamic-ref") { data.outlineType = "dynamic-ref"; needsSave = true; }
            if (data.linkTypeNotebook === "ref") { data.linkTypeNotebook = "link"; needsSave = true; }
            if (data.useDynamicAnchor !== undefined) { delete data.useDynamicAnchor; needsSave = true; }
            if (data.useDynamicAnchorOutline !== undefined) { delete data.useDynamicAnchorOutline; needsSave = true; }
            if (needsSave) {
                console.log("[Settings] Migrated old config values to new format");
                await this.save();
            }
        }
    }

    set(key: any, value: any, config = CONFIG) {
        plugin.data[config][key] = value;
    }

    get(key: any, config = CONFIG) {
        return plugin.data[config]?.[key];
    }

    async load(config = CONFIG) {
        await plugin.loadData(config);
    }

    async save(config = CONFIG) {
        await plugin.saveData(config, plugin.data[config]);
    }

    getMergedConfig(localData: any) {
        const def = new SettingsProperty();
        const global = plugin.data[CONFIG] || {};

        let linkType = localData.linkType ?? global.linkType ?? def.linkType;
        if (linkType === "ref") linkType = "link";
        if (linkType === "embed") linkType = "reference";
        if (localData.useDynamicAnchor === true && linkType !== "dynamic-ref") linkType = "dynamic-ref";

        return {
            depth: localData.depth ?? global.depth ?? def.depth,
            listType: localData.listType ?? global.listType ?? def.listType,
            linkType: linkType,
            fold: localData.fold ?? global.fold ?? def.fold,
            col: localData.col ?? global.col ?? def.col,
            icon: localData.icon ?? global.icon ?? def.icon,
            autoUpdate: localData.autoUpdate ?? global.autoUpdate ?? def.autoUpdate,
        };
    }

    getMergedConfigForOutline(localData: any) {
        const def = new SettingsProperty();
        const global = plugin.data[CONFIG] || {};

        let outlineType = localData.outlineType ?? global.outlineType ?? def.outlineType;
        if (outlineType === "ref") outlineType = "link";
        if (outlineType === "embed") outlineType = "reference";
        if (localData.useDynamicAnchorOutline === true && outlineType !== "dynamic-ref") outlineType = "dynamic-ref";

        return {
            outlineType: outlineType,
            outlineAutoUpdate: localData.outlineAutoUpdate ?? global.outlineAutoUpdate ?? def.outlineAutoUpdate,
            listTypeOutline: localData.listTypeOutline ?? global.listTypeOutline ?? def.listTypeOutline,
            iconOutline: localData.iconOutline ?? global.iconOutline ?? def.iconOutline,
        };
    }

    loadSettings(data: any) {
        const merged = this.getMergedConfig(data);
        for (const [key, val] of Object.entries(merged)) {
            this.set(key, val);
        }
    }

    loadSettingsforOutline(data: any) {
        const merged = this.getMergedConfigForOutline(data);
        for (const [key, val] of Object.entries(merged)) {
            this.set(key, val);
        }
    }
}

export const settings = new Settings();
