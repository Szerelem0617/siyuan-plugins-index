/**
 * supertag-binder.ts
 *
 * Layer 4 AV 数据库绑定与偏好配置管理模块
 */

import { post } from "../../../../shared/api-client/request";
import { getColIDMap } from "../../../../shared/utils/av-utils";
import { tableSyncTimes, instantiateAV } from "../../../sqlite/sqlite-manager";
import { formatDate } from "../../../../shared/utils";
import { showMessage } from "siyuan";
import type { TypeConfig } from "../../../av/av-setting/types";

export interface SupertagPrefs {
    [tag: string]: string; // tag -> avId preference
}

export class SupertagBinder {
    private prefs: SupertagPrefs = {};

    constructor() {
        this.loadPrefs();
    }

    public async loadPrefs() {
        try {
            const res = await post("/api/file/getFile", {
                path: "/data/storage/petal/siyuan-plugins-index/supertag-prefs.json"
            });
            if (res && typeof res === "object") {
                this.prefs = res;
            }
        } catch (_) {
            this.prefs = {};
        }
    }

    public async savePrefs() {
        try {
            await post("/api/file/putFile", {
                path: "/data/storage/petal/siyuan-plugins-index/supertag-prefs.json",
                isDir: false,
                file: new Blob([JSON.stringify(this.prefs, null, 2)], { type: "application/json" })
            });
        } catch (e) {
            console.error("[SupertagBinder] Failed to save supertag prefs:", e);
        }
    }

    public getPref(tag: string): string | undefined {
        return this.prefs[tag];
    }

    public setPref(tag: string, avId: string) {
        this.prefs[tag] = avId;
        this.savePrefs();
    }

    public async applySupertag(blockId: string, cleanTag: string, config: TypeConfig) {
        try {
            const avId = config.avId;
            console.log(`[Supertag-Binder] Applying supertag: "${cleanTag}" for block "${blockId}". Database: "${config.avName}" (${avId})`);

            // 1. Get current state of the AV
            const { blockToItem, idToType, keyValues } = await getColIDMap(avId);
            let itemId = blockToItem.get(blockId);

            if (!itemId) {
                // @ts-ignore
                itemId = window.Lute?.NewNodeID() || Date.now().toString();
                console.log(`[Supertag-Binder] Block not in database. Generating new itemId: "${itemId}"...`);

                await post("/api/av/addAttributeViewBlocks", {
                    avID: avId,
                    srcs: [{ itemID: itemId, id: blockId, isDetached: false }]
                });
                console.log(`[Supertag-Binder] Added block to AV database.`);

                if (config.typeFieldId && config.mappedValue !== undefined) {
                    const colKV = keyValues.find(kv => kv.key.id === config.typeFieldId);
                    if (colKV && colKV.values) {
                        const cell = colKV.values.find((v: any) => (v.itemID || v.itemId || v.id) === itemId);
                        if (cell) {
                            const currentVal = (cell.mSelect?.[0]?.content || cell.text?.content || cell.number?.content || cell.content || "").toString();
                            if (currentVal === config.mappedValue.toString()) {
                                return;
                            }
                        }
                    }
                }
            }

            if (config.typeFieldId && config.mappedValue !== undefined) {
                const colType = idToType[config.typeFieldId] || "text";
                const valuePayload = this.formatValue(String(config.mappedValue).trim(), colType);

                await post("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: avId,
                    values: [{
                        keyID: config.typeFieldId,
                        itemID: itemId,
                        value: valuePayload
                    }]
                });
            }

            tableSyncTimes.delete(avId);
            await instantiateAV(avId, true);

            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [{ action: "doUpdateUpdated", id: blockId, data: formatDate(new Date()) }] }]
            });

            showMessage(`✨ Supertag: 已自动同步至 "${config.avName || cleanTag}"`);
        } catch (e) {
            console.error("[Supertag-Binder] Failed to apply data sync:", e);
        }
    }

    private formatValue(val: string, colType: string) {
        if (colType === "number") {
            const numContent = Number(val);
            return {
                type: "number",
                number: { content: isNaN(numContent) ? 0 : numContent, isNotEmpty: true }
            };
        } else if (colType === "text" || colType === "block") {
            return {
                type: "text",
                text: { content: val }
            };
        } else {
            return {
                type: "mSelect",
                mSelect: [{ content: val, color: "" }]
            };
        }
    }
}

export const supertagBinder = new SupertagBinder();
