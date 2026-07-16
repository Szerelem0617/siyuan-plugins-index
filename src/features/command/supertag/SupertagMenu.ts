import { Dialog } from "siyuan";
import { getSqliteEngine } from "../../sqlite/sqlite-manager";
import SupertagManagerDialog from "./SupertagManagerDialog.svelte";
import { SupertagRenderer } from "./SupertagRenderer";

export async function openSupertagManagerDialog(blockId: string, blockEl: HTMLElement) {
    try {
        const { db } = await getSqliteEngine();
        
        // Fetch all available supertags from sys_type_db
        const res = db.exec(`SELECT supertag FROM sys_type_db`);
        let availableTags: string[] = [];
        if (res.length > 0 && res[0].values.length > 0) {
            availableTags = res[0].values
                .map((row: any) => String(row[0]).replace(/#/g, "").trim())
                .filter(Boolean);
        }

        const d = new Dialog({
            title: "管理超级标签 (Supertags)",
            content: `<div id="supertag-manager-mount" style="height: 100%;"></div>`,
            width: "400px",
            height: "350px",
            destroyCallback: () => {
                app.$destroy();
            }
        });

        const app = new SupertagManagerDialog({
            target: d.element.querySelector("#supertag-manager-mount")!,
            props: {
                dialog: d,
                blockId,
                availableTags,
                blockEl,
                onSaveComplete: () => {
                    // Instantly trigger re-render on the active editor
                    const activeProtyle = (window as any).activeProtyleInstance;
                    if (activeProtyle) {
                        SupertagRenderer.render(activeProtyle);
                    }
                }
            }
        });
    } catch (e) {
        console.error("[SupertagMenu] Failed to open dialog:", e);
    }
}
