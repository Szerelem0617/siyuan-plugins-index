/**
 * builtin/index.ts
 *
 * 模块化聚合导出所有内置命令
 * 每个命令独立维护单一 json 文件，具备明确的文件名与职责。
 */

import open from "./open.json";
import viewGraph from "./view-graph.json";
import viewInbox from "./view-inbox.json";
import uiToast from "./ui-toast.json";
import viewSplitRight from "./view-split-right.json";
import duplicateContent from "./duplicate-content.json";
import blockCopyRef from "./block-copy-ref.json";
import addSupertag from "./add-supertag.json";
import insertBlockBelow from "./insert-block-below.json";
import visualEffect from "./visual-effect.json";
import safeUpdateBlock from "./safe-update-block.json";
import setBlockAttribute from "./set-block-attribute.json";
import moveContent from "./move-content.json";

export const BUILTIN_COMMANDS = [
    open,
    viewGraph,
    viewInbox,
    uiToast,
    viewSplitRight,
    duplicateContent,
    blockCopyRef,
    addSupertag,
    insertBlockBelow,
    visualEffect,
    safeUpdateBlock,
    setBlockAttribute,
    moveContent
];

export const commandsData = {
    version: "1.0.0",
    commands: BUILTIN_COMMANDS
};

export default commandsData;
