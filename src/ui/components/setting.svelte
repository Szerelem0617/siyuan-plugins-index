<script lang="ts">
    import { onDestroy } from "svelte";
    import { settings, SettingsProperty } from "../../core/settings";
    import { i18n } from "../../shared/utils";
    import { eventBus } from "../../shared/eventbus";
    import IndexTab from "./tab/index-tab.svelte";
    import OutlineTab from "./tab/outline-tab.svelte";
    import BuilderTab from "./tab/builder-tab.svelte";
    import DataTab from "./tab/data-tab.svelte";

    let settingsStrings = new SettingsProperty();
    settingsStrings.getAll();

    let tabbarfocus = "index";

    function switchTab(tab: string) {
        tabbarfocus = tab;
    }

    eventBus.on("switchTab", switchTab);

    async function updateSettings() {
        settingsStrings.getAll();
        settingsStrings = settingsStrings; // Trigger reactivity
    }
    eventBus.on("updateSettings", updateSettings);

    onDestroy(() => {
        settings.save();
    });
</script>

<div class="fn__flex-1 fn__flex-column config__panel" style="height: 100%;">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="layout-tab-bar fn__flex">
        <!-- Index Tab -->
        <div 
            class={tabbarfocus === "index" ? "item item--full item--focus" : "item item--full"}
            on:click={() => { tabbarfocus = "index"; eventBus.emit("updateSettings"); }}
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"><svg><use xlink:href="#iconList" /></svg></span>
            <span class="item__text">{i18n.indexSettings}</span>
            <span class="fn__flex-1"></span>
        </div>
        <!-- Outline Tab -->
        <div 
            class={tabbarfocus === "outline" ? "item item--full item--focus" : "item item--full"}
            on:click={() => { tabbarfocus = "outline"; eventBus.emit("updateSettings"); }}
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"><svg><use xlink:href="#iconAlignCenter" /></svg></span>
            <span class="item__text">{i18n.outlineSettings}</span>
            <span class="fn__flex-1"></span>
        </div>
        <!-- Builder Tab -->
        <div 
            class={tabbarfocus === "builder" ? "item item--full item--focus" : "item item--full"}
            on:click={() => { tabbarfocus = "builder"; eventBus.emit("updateSettings"); }}
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"><svg><use xlink:href="#iconSQL" /></svg></span>
            <span class="item__text">{i18n.builderSettings}</span>
            <span class="fn__flex-1"></span>
        </div>
        <!-- Data Tab -->
        <div 
            class={tabbarfocus === "data" ? "item item--full item--focus" : "item item--full"}
            on:click={() => { tabbarfocus = "data"; eventBus.emit("updateSettings"); }}
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"><svg><use xlink:href="#iconDatabase" /></svg></span>
            <span class="item__text">数据库</span>
            <span class="fn__flex-1"></span>
        </div>
    </div>
    
    <div class="config__tab-wrap fn__flex-1" style="overflow-y: auto; padding: 16px;">
        <IndexTab tabbarfocus={tabbarfocus} settingsStrings={settingsStrings} />
        <OutlineTab tabbarfocus={tabbarfocus} settingsStrings={settingsStrings} />
        <BuilderTab tabbarfocus={tabbarfocus} settingsStrings={settingsStrings} />
        <DataTab tabbarfocus={tabbarfocus} settingsStrings={settingsStrings} />
    </div>
</div>