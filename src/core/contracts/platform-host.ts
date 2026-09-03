/**
 * platform-host.ts
 * 
 * IndexOS DIP 宿主环境能力契约 (IPlatformHost)
 * 核心调度器、规则执行引擎与宿主 UI（思源、Obsidian、Web）解耦的适配门面。
 */

export interface SpatialGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

export interface DialogMountOptions {
    title: string;
    width?: string;
    height?: string;
    content?: string;
    destroyCallback?: () => void;
}

export interface IPlatformHost {
    /** 宿主弹出 Toast 消息 */
    notify(message: string, type?: "info" | "error" | "warn", timeout?: number): void;
    
    /** 获取目标实体在视口中的绝对物理几何边界（供特效、悬浮弹窗锚定） */
    getSpatialGeometry(targetId: string): SpatialGeometry | null;
    
    /** 宿主剪贴板访问 */
    clipboard: {
        writeText(text: string): Promise<void>;
        readText(): Promise<string>;
    };
    
    /** 打开外部或内置链接/导航 */
    openTarget(targetUri: string): Promise<void>;
}
