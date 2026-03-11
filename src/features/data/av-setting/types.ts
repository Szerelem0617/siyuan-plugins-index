export interface InheritanceRule {
    colId: string;
    mode: "none" | "weak" | "strong"; // weak: fill if empty; strong: overwrite
}

export interface IDBTypeMapping {
    value: string;
    name: string;
    isSupertag?: boolean;
}

export interface DbConfig {
    avId?: string; // Add avId to config for easier lookup
    typeFieldId?: string; // Column ID used to determine type
    typeMappings?: IDBTypeMapping[]; // Mappings for values -> type names
    inheritanceRules?: InheritanceRule[];
    mode?: "single" | "multi"; // "single" is default: one table maps to one type
    singleClassName?: string; // Name of the single type
}

export interface TypeConfig {
    typeName: string;
    avId: string;
    blockId: string;
    typeFieldId?: string;
    mappedValue?: string;
    avName?: string;
}
