import { avEventHandler } from "./events";

/**
 * AV 菜单回调 (open-menu-av)
 */
export function addAVMenuItems({ detail }: any) {
    const { menu } = detail;
    const cell = avEventHandler.getLastClickedCell();
    
    if (cell && menu) {
        avEventHandler.showSyncMenu(menu, cell);
    }
}
