# Menu

菜单：Liquid Glass 浮层，用于上下文菜单、下拉菜单与 PopUpButton 的列表。

**你需要提供**：`items` 数组，每项为 `{label, value?, shortcut?, icon?, checked?, disabled?, destructive?}`、`{separator: true}` 或 `{header: '分组名'}`；`onSelect(value)`；`activeValue` 可预置高亮项（演示用）。

- macOS 27 精简了菜单图标：只给最常用的几项加 `icon`，不要每项都加。
- 快捷键用系统符号：⌘ ⌥ ⇧ ⌃ ⌫。
- 悬停高亮 `menu-highlight`，文字切换 `on-accent`；破坏性项用 `system-red` 并放在最后一组。
