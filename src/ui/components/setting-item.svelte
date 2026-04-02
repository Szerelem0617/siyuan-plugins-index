<script>
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
    }
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
        <select
            class="b3-select fn__flex-center fn__size200"
            id={settingKey}
            bind:value={settingValue}
            on:change={updateSetting}
        >
            {#if Array.isArray(content.options)}
                {#each content.options as option}
                    <option value={option.value}>{option.label}</option>
                {/each}
            {:else}
                {#each Object.entries(content.options) as [key, text]}
                    <option value={key}>{text}</option>
                {/each}
            {/if}
        </select>
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
