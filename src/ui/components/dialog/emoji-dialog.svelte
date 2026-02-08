<script lang="ts">
    import { onMount } from "svelte";
    import { i18n } from "../../../shared/utils";
    import { fetchSyncPost } from "siyuan";

    export let onSelect: (emoji: string) => void;
    
    // Data
    let emojis: any[] = [];
    let recentEmojis: any[] = [];
    let filteredEmojis: any[] = [];
    let searchText = "";
    let panelElement: HTMLElement;
    
    // State
    let activeTab = "emoji"; // 'emoji' | 'dynamic'
    
    onMount(() => {
        const siyuan = (window as any).siyuan;
        if (siyuan && siyuan.emojis) {
            // Filter out the "custom" category as it's not supported
            emojis = siyuan.emojis.filter(category => category.id !== "custom");
            
            // Load Recent Emojis
            const recentUnicodes = siyuan.config.editor.emoji || [];
            recentEmojis = [];
            const allItems = emojis.flatMap(cat => cat.items);
            
            for (const unicode of recentUnicodes) {
                const item = allItems.find(i => i.unicode === unicode);
                if (item) {
                    recentEmojis.push(item);
                }
            }
            
            filterEmoji();
        }
    });

    function unicode2Emoji(unicode: string) {
        if (!unicode) return "";
        
        // Custom emoji / image check
        if (unicode.includes(".") || unicode.includes("/")) {
            return `<img class="emoji" src="/emojis/${unicode}" alt="${unicode}" />`;
        }

        // Hex sequence regex (only hex chars and hyphens)
        const hexPattern = /^[0-9a-fA-F-]+$/;
        
        if (hexPattern.test(unicode)) {
            try {
                const result = unicode.split("-").map(item => String.fromCodePoint(parseInt(item, 16))).join("");
                return result;
            } catch (e) {
                return unicode;
            }
        }
        
        return unicode;
    }

    function filterEmoji() {
        const result = [];
        
        // Add Recent category if not searching
        if (!searchText && recentEmojis.length > 0) {
            result.push({
                title: i18n.recent || "Recent",
                id: "recent",
                items: recentEmojis
            });
        }

        if (!searchText) {
            filteredEmojis = [...result, ...emojis];
            return;
        }
        
        const lowerSearch = searchText.toLowerCase();
        
        for (const category of emojis) {
            const matchingItems = category.items.filter(item => 
                (item.description && item.description.toLowerCase().includes(lowerSearch)) || 
                (item.description_zh_cn && item.description_zh_cn.toLowerCase().includes(lowerSearch)) ||
                (item.keywords && item.keywords.toLowerCase().includes(lowerSearch)) ||
                (item.unicode && item.unicode.includes(lowerSearch))
            );
            
            if (matchingItems.length > 0) {
                result.push({
                    ...category,
                    items: matchingItems
                });
            }
        }
        filteredEmojis = result;
    }

    async function selectEmoji(emojiItem: any) {
        console.log("[EmojiDialog] selectEmoji triggered with:", emojiItem);
        const emojiHex = typeof emojiItem === 'string' ? emojiItem : emojiItem?.unicode;
        
        if (!emojiHex) {
            console.warn("[EmojiDialog] Invalid emoji item selected.");
            return;
        }

        let selectedValue = "";
        try {
            // Determine display character/img
            if (emojiHex.includes(".") || emojiHex.includes("/")) {
                selectedValue = emojiHex; // Keep path for images
            } else {
                try {
                    selectedValue = emojiHex.split("-").map(item => String.fromCodePoint(parseInt(item, 16))).join("");
                } catch (e) {
                    console.warn("[EmojiDialog] Unicode conversion failed, using raw hex:", e);
                    selectedValue = emojiHex;
                }
            }
            
            // Update Siyuan Recent List
            const siyuan = (window as any).siyuan;
            if (siyuan && emojiHex && emojiHex !== "📄") {
                console.log("[EmojiDialog] Updating Siyuan recent emojis list...");
                const recent = [...(siyuan.config.editor.emoji || [])];
                const index = recent.indexOf(emojiHex);
                if (index > -1) {
                    recent.splice(index, 1);
                }
                recent.unshift(emojiHex);
                if (recent.length > 32) {
                    recent.pop();
                }
                siyuan.config.editor.emoji = recent;
                
                try {
                    // SiYuan API setEditorConf might return empty response which fetchSyncPost fails to parse as JSON
                    await fetch("/api/system/setEditorConf", {
                        method: "POST",
                        body: JSON.stringify({
                            emoji: recent
                        })
                    });
                } catch (apiError) {
                    console.error("[EmojiDialog] Failed to update Siyuan configuration:", apiError);
                }
            }
        } catch (err) {
            console.error("[EmojiDialog] Error in selectEmoji logic:", err);
        } finally {
            if (onSelect) {
                console.log("[EmojiDialog] Calling onSelect with value:", selectedValue);
                onSelect(selectedValue);
            } else {
                console.error("[EmojiDialog] onSelect callback is missing!");
            }
        }
    }

    function pickRandom() {
        const allItems = emojis.flatMap(cat => cat.items);
        if (allItems.length > 0) {
            const randomItem = allItems[Math.floor(Math.random() * allItems.length)];
            selectEmoji(randomItem);
        }
    }

    function scrollToCategory(id: string) {
        if (panelElement) {
             const title = panelElement.querySelector(`[data-category-id="${id}"]`);
             if (title) title.scrollIntoView({ behavior: 'smooth' });
        }
    }
</script>

<div class="emojis">
    <!-- Tab Header -->
    <div class="emojis__tabheader">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="ariaLabel block__icon block__icon--show {activeTab === 'emoji' ? 'block__icon--active' : ''}" aria-label="Emoji" on:click={() => activeTab = 'emoji'}>
            <svg><use xlink:href="#iconEmoji"></use></svg>
        </div>
        <div class="fn__space"></div>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="ariaLabel block__icon block__icon--show {activeTab === 'dynamic' ? 'block__icon--active' : ''}" aria-label="Dynamic Icon" on:click={() => activeTab = 'dynamic'}>
            <svg><use xlink:href="#iconCalendar"></use></svg>
        </div>
        <div class="fn__flex-1"></div>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <span class="block__icon block__icon--show fn__flex-center ariaLabel" aria-label="Reset" on:click={() => selectEmoji("📄")}>
            <svg><use xlink:href="#iconUndo"></use></svg>
        </span>
    </div>

    <div class="emojis__tabbody">
        {#if activeTab === 'emoji'}
        <div data-type="tab-emoji">
             <div class="fn__hr"></div>
             <!-- Search Bar -->
             <div class="fn__flex">
                <span class="fn__space"></span>
                <label class="b3-form__icon fn__flex-1" style="overflow:initial;">
                    <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                    <input class="b3-form__icon-input b3-text-field fn__block" placeholder={i18n?.search || "Search"} bind:value={searchText} on:input={filterEmoji}>
                </label>
                <span class="fn__space"></span>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <span class="block__icon block__icon--show fn__flex-center ariaLabel" aria-label="Random" on:click={pickRandom}>
                    <svg><use xlink:href="#iconRefresh"></use></svg>
                </span>
                <span class="fn__space"></span>
            </div>

            <!-- Emoji Grid Panel -->
            <div class="emojis__panel" bind:this={panelElement}>
                {#each filteredEmojis as category}
                    <div class="emojis__title" data-category-id={category.id}>
                        {category.title}
                    </div>
                    <div class="emojis__content">
                        {#each category.items as item}
                            <button class="emojis__item ariaLabel" aria-label={item.description} on:click={() => selectEmoji(item)}>
                                {@html unicode2Emoji(item.unicode)}
                            </button>
                        {/each}
                    </div>
                {/each}
            </div>
            
             <!-- Category Bottom Bar -->
             <div class="fn__flex" style="overflow-x: auto; padding: 4px 0;">
                {#if !searchText && recentEmojis.length > 0}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="emojis__type ariaLabel" aria-label={i18n.recent} on:click={() => scrollToCategory("recent")}>
                        <svg><use xlink:href="#iconRefresh"></use></svg>
                    </div>
                {/if}
                {#each emojis as category}
                     <!-- svelte-ignore a11y-click-events-have-key-events -->
                     <!-- svelte-ignore a11y-no-static-element-interactions -->
                     <div class="emojis__type ariaLabel" aria-label={category.title} on:click={() => scrollToCategory(category.id)}>
                         {#if category.items[0]?.unicode}
                             {@html unicode2Emoji(category.items[0].unicode)}
                         {:else}
                             <svg><use xlink:href="#iconEmoji"></use></svg>
                         {/if}
                     </div>
                {/each}
             </div>
        </div>
        {:else}
        <!-- Dynamic Icon Tab Placeholder -->
        <div data-type="tab-dynamic">
            <div class="fn__hr"></div>
            <div style="padding: 20px; text-align: center; color: var(--b3-theme-on-surface-light);">
                Dynamic icons logic is not implemented in this plugin yet.
            </div>
        </div>
        {/if}
    </div>
</div>

<style>
.emojis {
  word-break: break-all;
  white-space: normal;
  display: flex;
  flex-direction: column;
  padding: 8px 0;
  height: 100%;
  box-sizing: border-box;
}

.emojis__tabheader {
    display: flex;
    border-bottom: 1px solid var(--b3-border-color);
    padding: 0 8px 8px;
}

.emojis__tabbody {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
}

div[data-type="tab-emoji"] {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.emojis__item {
    font-size: 19px;
    font-family: var(--b3-font-family-emoji);
    text-align: center;
    height: 32px;
    padding: 4px;
    cursor: pointer;
    display: inline-block;
    transition: var(--b3-transition);
    background-color: transparent;
    border: 0;
    margin: 1px;
    overflow: hidden;
    border-radius: var(--b3-border-radius);
    width: 32px;
}

.emojis__item :global(img), .emojis__item :global(svg) {
    height: 24px;
    display: block;
    width: 24px;
    margin: 0 auto;
}

.emojis__item:hover {
    background: var(--b3-list-hover);
}

.emojis__title {
    color: var(--b3-theme-on-surface);
    padding: 8px 4px 4px 4px;
    font-weight: bold;
}

.emojis__panel {
    flex: 1;
    overflow: auto;
    padding: 0 8px;
}

.emojis__content {
    display: flex;
    flex-wrap: wrap;
}

.emojis__type {
    cursor: pointer;
    flex: 1;
    min-width: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    line-height: 28px;
    transition: var(--b3-list-hover);
    font-size: 16px;
    background-color: transparent;
    border: 0;
    padding: 0;
    font-family: var(--b3-font-family-emoji);
}

.emojis__type:hover {
    background-color: var(--b3-theme-surface-lighter);
}

.emojis__type :global(svg), .emojis__type :global(img) {
    height: 16px;
    width: 16px;
}
</style>

