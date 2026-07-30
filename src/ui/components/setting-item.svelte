<script>
    import { openIndexDropdown } from "../components/index-dropdown";
    import { settings } from "../../core/settings";

    export let type; // 设置项目类型
    export let content; // 设置项目内部文本展示
    export let settingKey; // 设置项目 key
    export let settingValue; // 设置项目初始值
    export let onMyClick = function(){}; //点击事件
    export let disabled = null;

    function updateSetting() {
        settings.set(settingKey, settingValue);
        settings.save();
        window.dispatchEvent(new CustomEvent("index-plugin-setting-changed", {
            detail: { key: settingKey, value: settingValue }
        }));
    }

    $: dropdownOptions = Array.isArray(content.options)
        ? content.options.map(opt => ({ value: String(opt.value), label: opt.label }))
        : Object.entries(content.options || {}).map(([key, text]) => ({ value: key, label: String(text) }));

    $: selectedLabel = dropdownOptions.find(opt => opt.value === String(settingValue))?.label || settingValue;
</script>

<label class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        {@html content.title}
        <div class="b3-label__text">
            {@html content.content}
        </div>
    </div>
    <span class="fn__space" />
    {#if type === "range"}
        <div
            class="b3-tooltips b3-tooltips__n fn__flex-center"
            aria-label={settingValue}
        >
            <input
                class="b3-slider fn__size200"
                id={settingKey}
                type="range"
                min={content.min}
                max={content.max}
                step={content.step}
                bind:value={settingValue}
                on:change={updateSetting}
            />
        </div>
    {:else if type === "switch"}
        <input
            class="b3-switch fn__flex-center"
            id={settingKey}
            type="checkbox"
            bind:checked={settingValue}
            on:change={updateSetting}
        />
    {:else if type === "select"}
        <button
            class="b3-select fn__flex fn__size200 fn__flex-center"
            style="align-items: center; justify-content: space-between; height: 28px; padding: 4px 8px; border: 1px solid var(--indexos-border-light); background: var(--indexos-bg-container); border-radius: 3px; cursor: pointer; transition: all 0.15s ease;"
            id={settingKey}
            on:click={(e) => openIndexDropdown({
                event: e,
                options: dropdownOptions,
                selectedValue: String(settingValue),
                onSelect: (val) => {
                    settingValue = val;
                    updateSetting();
                }
            })}
        >
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {selectedLabel}
            </span>
            <svg class="dropdown-arrow" style="width: 10px; height: 10px; opacity: 0.5; flex-shrink: 0; margin-left: 4px;"><use xlink:href="#iconDown"></use></svg>
        </button>
    {:else if type === "button"}
        <button
            class="b3-button b3-button--outline fn__size200 fn__flex-center"
            id={settingKey}
            on:click={onMyClick}
            {disabled}
        >
            <svg><use xlink:href="{content.icon}" /></svg>
            {content.text}
        </button>
    {:else if type === "textarea"}
        <input
            class="b3-text-field fn__flex-center fn__size200"
            id={settingKey}
            bind:value={settingValue}
            on:change={updateSetting}
        >
    {/if}
</label>
