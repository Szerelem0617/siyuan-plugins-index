import { openEmoji } from "siyuan";
import { client } from "../shared/api-client";
import { hexToEmoji } from "../shared/utils/av-utils";

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
    try {
        if (typeof openEmoji === 'function') {
            openEmoji({
                position: {
                    x: x,
                    y: y
                },
                hideDynamicIcon: true,
                hideCustomIcon: true,
                selectedCB: (emoji: string) => {
                    if (blockId && emoji !== undefined) {
                        // If emoji is empty string, it means remove
                        if (emoji === "") {
                            replaceEmojiInBlock(blockId, oldEmoji, "");
                        } else {
                            const decodedEmoji = hexToEmoji(emoji);
                            replaceEmojiInBlock(blockId, oldEmoji, decodedEmoji);
                        }
                    }
                }
            });
        } else {
            console.warn("[Emoji-Event] SiYuan version does not support openEmoji API or it is not exported. Please update SiYuan.");
        }
    } catch (e) {
        console.error("Failed to show emoji menu via SiYuan API", e);
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
