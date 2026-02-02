[中文](https://github.com/Szerelem0617/siyuan-plugins-index/blob/main/README_zh_CN.md)

# Index Plugin

After enabling the plugin, a plugin icon will be generated on the right side of the topbar

Left click on the plugin icon , insert a index list to current document

Right click on the plugin icon, show more actions

`CTRL + ALT + I` Insert Index (Content depends on 'Insertion Content' setting)

`CTRL + ALT + O` Insert current document outline

# Version 1.8.9

- **Builder Optimization**: Refactored the auto-update logic, significantly improving synchronization performance for large lists.
- **Auto-update Trigger**: Switching document tabs now automatically triggers all builder blocks marked for auto-update.
- **Notice**: **The Document Builder is currently in the testing phase. Please back up important data before use. The author is not responsible for any data loss or issues caused by this feature.**

# Version 1.8.0 (Major Update)

- **Removed Template Feature**: Legacy template system is removed. Now you can update configurations simply by re-inserting into an existing index/outline.
- **UI Overhaul**: Integrated "Notebook Index" and "Sub-page Index + Outline" into the main Index settings. Redesigned the settings panel with horizontal tabs (Index, Outline, Builder).
- **Icon System Optimization**: 
    - Added optional icons for Index and Outline (disabled by default).
    - For Outlines: Rich text sync is supported when icons are enabled; plain text sync is used when disabled to ensure link stability.
- **Emoji Picker**: Alt + Click on SiYuan's built-in emojis to pick and replace them.
- **Builder Improvements**: Removed the "Pull" functionality for a leaner experience.
- **Icon Support Optimization**: Non-built-in icons are now displayed as standard SiYuan icons to prevent mojibake.

# Changelog

[CHANGELOG](https://github.com/Szerelem0617/siyuan-plugins-index/blob/main/CHANGELOG.md)

# Acknowledgments

Special thanks to [TinkMingKing](https://github.com/TinkMingKing) for his previous maintenance of the plugin and for trusting me with the repository transfer.
