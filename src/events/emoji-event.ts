import { Dialog } from "siyuan";
import EmojiDialog from "../ui/components/dialog/emoji-dialog.svelte";
import { client } from "../shared/api-client";

/**
 * Initialize the emoji event listener for Alt+Click
 */
export function initEmojiEvent() {
    window.addEventListener("click", handleAltClick, true);
}

export function removeEmojiEvent() {
    window.removeEventListener("click", handleAltClick, true);
}

async function handleAltClick(event: MouseEvent) {
    if (!event.altKey) return;

    const target = event.target as HTMLElement;
    const textContent = target.textContent?.trim() || "";

    // Ignore database cells (they have their own handling)
    if (target.closest(".av__cell")) return;
    
    // Ignore the fixed separator character
    if (textContent === "➖") return;

    console.log("handleAltClick - textContent:", textContent); // Debug log

    // Matches:
    // 1. Flags: \p{RI}\p{RI}
    // 2. Standard/Complex Emojis:
    //    Start with Extended_Pictographic or Emoji_Presentation (avoids matching digits/punctuation)
    //    Optional modifiers/VS16
    //    Optional ZWJ sequences followed by ANY Emoji + modifiers
    const emojiRegex = /^(?:(?:\p{RI}\p{RI})|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\p{Emoji_Modifier}|\uFE0F)?(?:\u200d\p{Emoji}(?:\p{Emoji_Modifier}|\uFE0F)?)*)$/u;

    if (textContent && emojiRegex.test(textContent)) {
        event.preventDefault();
        event.stopPropagation();
        
        const blockElement = target.closest('[data-node-id]');
        if (!blockElement) return;
        
        const blockId = blockElement.getAttribute('data-node-id');
        
        showEmojiMenu(event.clientX, event.clientY, blockId, textContent);
    }
}

function showEmojiMenu(x: number, y: number, blockId: string | null, oldEmoji: string) {
    const dialog = new Dialog({
        title: "",
        content: `<div class="emoji-dialog-content" style="height: 100%; display: flex; flex-direction: column;"></div>`,
        width: "360px",
        height: "460px",
    });
    
    const target = dialog.element.querySelector(".emoji-dialog-content");
    if (target) {
        new EmojiDialog({
            target: target,
            props: {
                onSelect: (emoji: string) => {
                    if (blockId && emoji !== undefined) {
                        // If emoji is empty string, it means remove
                        if (emoji === "") {
                             replaceEmojiInBlock(blockId, oldEmoji, "");
                        } else {
                             replaceEmojiInBlock(blockId, oldEmoji, emoji);
                        }
                    }
                    dialog.destroy();
                }
            }
        });
    }
}

async function replaceEmojiInBlock(blockId: string, oldEmoji: string, newEmoji: string) {
    try {
        const response = await client.getBlockKramdown({ id: blockId });
        if (!response.data) return;
        
        let kramdown = response.data.kramdown;

        // Simple text replacement for Unicode emojis
        if (kramdown.includes(oldEmoji)) {
            const newKramdown = kramdown.replace(oldEmoji, newEmoji);
            
            await client.updateBlock({
                id: blockId,
                data: newKramdown,
                dataType: "markdown"
            });
        } else {
             console.warn("Could not find old emoji in kramdown", oldEmoji);
        }

    } catch (e) {
        console.error("Failed to replace emoji", e);
    }
}
