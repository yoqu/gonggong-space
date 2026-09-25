# Menu

菜单：Liquid Glass 浮层，用于上下文菜单、下拉菜单与 PopUpButton 的列表。

**你需要提供**：`items` 数组，每项为 `{label, value?, shortcut?, icon?, checked?, disabled?, destructive?}`、`{separator: true}` 或 `{header: '分组名'}`；`onSelect(value)`；`activeValue` 可预置高亮项（演示用）。

- macOS 27 精简了菜单图标：只给最常用的几项加 `icon`，不要每项都加。
- 快捷键用系统符号：⌘ ⌥ ⇧ ⌃ ⌫。
- 悬停高亮 `menu-highlight`，文字切换 `on-accent`；破坏性项用 `system-red` 并放在最后一组。

键盘：菜单获得焦点后 ↑↓ 移动高亮，Home/End 到首尾，Enter 或空格选中，Esc 调用 `onClose`，按字母跳到以它开头的项。鼠标悬停和键盘共用同一个高亮，任何时候只有一行高亮。弹出式用法传 `autoFocus`。

子菜单：菜单项带 `submenu`（同样的菜单项数组）时右侧显示 ›，悬停或按 → / Enter 展开到右侧，← 或 Esc 收回。子菜单只嵌一层，超过 7 项的子菜单考虑改成单独的弹出层。
