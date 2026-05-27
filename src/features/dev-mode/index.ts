import { settings } from "../../core/settings";
import { eventBus } from "../../shared/eventbus";

/**
 * Checks if Developer Mode is currently active.
 */
export function isDevModeActive(): boolean {
    return !!settings.get("devMode");
}

/**
 * Sets the Developer Mode active state and saves to configuration.
 */
export function setDevModeActive(active: boolean): void {
    settings.set("devMode", active);
    settings.save();
    eventBus.emit("updateSettings");
    eventBus.emit("devModeChanged", active);
}
