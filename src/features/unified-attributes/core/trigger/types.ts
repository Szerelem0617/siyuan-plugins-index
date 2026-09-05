/**
 * trigger/types.ts
 *
 * 超级标签条件触发器类型定义
 */

export interface TriggerCommandRef {
    labelOrId: string;
    args?: Record<string, any>;
}

export interface TriggerRule {
    event: string;
    condition: string;
    commands: TriggerCommandRef[];
}

export type TriggerEventName = 
    | "tag_created" 
    | "tag_removed" 
    | "block_created" 
    | "block_content_changed" 
    | "block_attribute_changed" 
    | "task_completed";

export interface TargetBlockInfo {
    id: string;
    root_id: string;
    parent_id: string;
    path: string;
    type: string;
    subType: string;
    markdown: string;
    tags: string[];
    isList: boolean;
    isTodo: boolean;
    isHeading: boolean;
    isParagraph: boolean;
    isDoc: boolean;
    isAv: boolean;
    actualTargetId: string;
    domEl: HTMLElement | null;
}

export interface HostCandidate {
    id: string;
    root_id: string;
    parent_id: string;
    path: string;
    tags: string[];
}
