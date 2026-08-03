import { Plugin } from "siyuan";
import { 
    initSupertagPalette, 
    destroySupertagPalette 
} from "./supertag-palette";

export async function initTagSuggestion(plugin: Plugin) {
    initSupertagPalette(plugin);
}

export function bindProtyleHintExtend(_protyle: any) {
    // 零侵入原生 protyle.options.hint.extend，彻底归还思源原生 # 标签功能
}

export function destroyTagSuggestion() {
    destroySupertagPalette();
}

export async function setTagSuggestionEnabled(_enabled: boolean) {
    // 保留向下兼容空函数
}
