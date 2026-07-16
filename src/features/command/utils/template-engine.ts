/**
 * template-engine.ts
 *
 * Pure functions for parsing and rendering string templates with placeholders.
 * Completely independent of the SiYuan environment.
 */

/**
 * Renders a template by replacing placeholders like {{variable}} or {{attr:variable}}.
 * 
 * @param text The raw template string
 * @param variables A key-value map of variable names to their values
 * @param isClassMethodMode Whether to support and map custom attributes (e.g., attr:key)
 */
export function renderTemplate(
    text: string,
    variables: Record<string, string>,
    isClassMethodMode: boolean = false
): string {
    if (!text || !text.includes("{{")) {
        return text;
    }

    let result = text;

    // 1. Process explicit variable replacements (including key and attr:key if in Class Method Mode)
    for (const [key, value] of Object.entries(variables)) {
        result = result.replaceAll(`{{${key}}}`, value);
        if (isClassMethodMode) {
            result = result.replaceAll(`{{attr:${key}}}`, value);
        }
    }

    // 2. Resolve custom attributes if present (e.g. {{attr:KEY}})
    const attrMatches = result.match(/\{\{attr:([^}]+)\}\}/g);
    if (attrMatches) {
        for (const match of attrMatches) {
            const attrKey = match.slice(7, -2);
            // In Class Method mode, try matching from variables (handled above or fallback to variables[attrKey])
            const val = isClassMethodMode ? (variables[`attr:${attrKey}`] ?? variables[attrKey] ?? "") : "";
            result = result.replaceAll(match, val);
        }
    }

    return result;
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Format time to HH:mm:ss
 */
export function formatTime(d: Date): string {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
