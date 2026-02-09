/**
 * 寻找并返回最外层列表块
 */
export function getOutermostList(element: HTMLElement) {
    let current = element;
    let outermostList: HTMLElement | null = null;

    // 向上寻找，直到到达 protyle-wysiwyg 或不再有父级
    while (current) {
        const type = current.getAttribute?.("data-type");
        if (type === "NodeList") {
            outermostList = current;
        }
        
        const parent = current.parentElement;
        if (!parent || parent.classList.contains("protyle-wysiwyg")) break;
        
        // 如果父级是 Embed，则停止，当前找到的即为该 Embed 内的最外层
        if (parent.getAttribute?.("data-type") === "NodeBlockQueryEmbed") break;
        
        current = parent;
    }
    return outermostList;
}

/**
 * 获取块的自定义属性（兼容 data- 前缀）
 */
export function getBlockAttribute(element: HTMLElement, attrName: string): string | null {
    if (!element) return null;
    return element.getAttribute(attrName) || element.getAttribute(`data-${attrName}`);
}
